import os
import json
import time
import atexit
import logging
import secrets
import threading
from functools import wraps
from pathlib import Path

# --- Async-движок: подбираем доступный по приоритету ---
async_mode = "threading"
try:
    import gevent.monkey  # noqa
    gevent.monkey.patch_all()
    async_mode = "gevent"
except Exception:
    try:
        import eventlet  # noqa
        eventlet.monkey_patch()
        async_mode = "eventlet"
    except Exception:
        async_mode = "threading"

import requests
from dotenv import load_dotenv
from flask import (
    Flask, render_template, redirect, url_for,
    request, session, jsonify
)
from flask_socketio import SocketIO, emit, join_room, leave_room

load_dotenv()

# ---------- Логи ----------
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("lotd")


# ---------- Flask ----------
app = Flask(
    __name__,
    template_folder="app/templates",
    static_folder="app/static"
)

app.secret_key = os.getenv("SECRET_KEY", secrets.token_hex(32))

app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=bool(os.getenv("SESSION_COOKIE_SECURE", "")),
    MAX_CONTENT_LENGTH=4 * 1024 * 1024,
)


# ---------- SocketIO ----------
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode=async_mode,
    logger=False,
    engineio_logger=False,
)
log.info(f"[socketio] async_mode = {async_mode}")


# ---------- Discord OAuth2 ----------
DISCORD_CLIENT_ID     = os.getenv("DISCORD_CLIENT_ID")
DISCORD_CLIENT_SECRET = os.getenv("DISCORD_CLIENT_SECRET")
DISCORD_REDIRECT_URI  = os.getenv(
    "DISCORD_REDIRECT_URI",
    "http://127.0.0.1:5000/auth/discord/callback"
)

DISCORD_API             = "https://discord.com/api"
DISCORD_OAUTH_AUTHORIZE = "https://discord.com/oauth2/authorize"
DISCORD_OAUTH_TOKEN     = f"{DISCORD_API}/oauth2/token"
DISCORD_API_ME          = f"{DISCORD_API}/users/@me"

ADMIN_DISCORD_IDS = {
    x.strip() for x in os.getenv("ADMIN_DISCORD_IDS", "").split(",") if x.strip()
}


# ---------- Хранилище комнат ----------
MAP_ROOMS: dict = {}

USER_COLORS = [
    "#e94560", "#f39c12", "#16a085", "#2980b9", "#8e44ad",
    "#c0392b", "#27ae60", "#d35400", "#2c3e50", "#e67e22",
]

CHAT_HISTORY_LIMIT = 100
MAP_SAVE_DEBOUNCE  = 1.5
ROOM_IDLE_TIMEOUT  = 60 * 30

DATA_DIR = Path(__file__).parent / "data" / "maps"
DATA_DIR.mkdir(parents=True, exist_ok=True)


def _safe_map_id(map_id: str):
    if not isinstance(map_id, str):
        return None
    if len(map_id) > 120:
        return None
    if ".." in map_id:
        return None
    safe = "".join(c for c in map_id if c.isalnum() or c in "._-/")
    return safe or None


def _file_for(map_id: str) -> Path:
    slug = map_id.replace("/", "_").replace(".", "_")
    return DATA_DIR / f"{slug}.json"


def get_room(map_id: str):
    if map_id not in MAP_ROOMS:
        room = {
            "actions": [],
            "users": {},
            "chat": [],
            "dirty": False,
            "last_save": 0.0,
            "last_active": time.time(),
        }
        f = _file_for(map_id)
        if f.exists():
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                room["actions"] = data.get("actions", [])
                room["chat"] = data.get("chat", [])[-CHAT_HISTORY_LIMIT:]
                log.info(f"[maps] загружено {len(room['actions'])} действий из {f.name}")
            except Exception as e:
                log.warning(f"[maps] не удалось загрузить {f}: {e}")
        MAP_ROOMS[map_id] = room
    return MAP_ROOMS[map_id]


def save_room(map_id: str, force: bool = False):
    room = MAP_ROOMS.get(map_id)
    if not room:
        return
    now = time.time()
    if not force and (now - room["last_save"] < MAP_SAVE_DEBOUNCE):
        return
    if not room["dirty"] and not force:
        return

    f = _file_for(map_id)

    clean_actions = []
    for a in room["actions"]:
        a2 = {k: v for k, v in a.items() if k != "_author_id"}
        clean_actions.append(a2)

    payload = {
        "map_id": map_id,
        "actions": clean_actions,
        "chat": room["chat"][-CHAT_HISTORY_LIMIT:],
        "saved_at": now,
    }
    try:
        f.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        room["dirty"] = False
        room["last_save"] = now
    except Exception as e:
        log.warning(f"[maps] не удалось сохранить {f}: {e}")


def _bg_saver():
    while True:
        try:
            time.sleep(MAP_SAVE_DEBOUNCE)
            for map_id, room in list(MAP_ROOMS.items()):
                if room.get("dirty"):
                    save_room(map_id)
        except Exception as e:
            log.warning(f"[saver] {e}")

threading.Thread(target=_bg_saver, daemon=True).start()


def _cleanup_idle_rooms():
    while True:
        try:
            time.sleep(120)
            now = time.time()
            for map_id, room in list(MAP_ROOMS.items()):
                if not room["users"] and now - room.get("last_active", now) > ROOM_IDLE_TIMEOUT:
                    save_room(map_id, force=True)
                    MAP_ROOMS.pop(map_id, None)
                    log.info(f"[rooms] удалена неактивная комната {map_id}")
        except Exception as e:
            log.warning(f"[cleanup] {e}")

threading.Thread(target=_cleanup_idle_rooms, daemon=True).start()


@atexit.register
def _flush_on_exit():
    for map_id in list(MAP_ROOMS.keys()):
        save_room(map_id, force=True)


# ---------- Хелперы ----------

def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("user"):
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapped


def current_user():
    return session.get("user")


def _is_admin(user_id: str) -> bool:
    if not ADMIN_DISCORD_IDS:
        return True
    return str(user_id) in ADMIN_DISCORD_IDS


@app.context_processor
def inject_user():
    return {"user": current_user(), "ADMIN_DISCORD_IDS": ADMIN_DISCORD_IDS}


# ---------- Основные страницы ----------

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html")


@app.route("/kv-map")
@login_required
def kv_map():
    return render_template("kv-map.html")


@app.route("/about")
def about():
    return render_template("about.html")


@app.route("/legionbeacon")
def legion_beacon():
    return render_template("legion-beacon.html")


@app.route("/profile")
@login_required
def profile():
    return render_template("profile.html")


@app.route("/healthz")
def healthz():
    return jsonify(ok=True, async_mode=async_mode, rooms=len(MAP_ROOMS))


# ---------- Discord OAuth2 ----------

@app.route("/login")
def login():
    if session.get("user"):
        return redirect(url_for("home"))

    state = secrets.token_urlsafe(16)
    session["oauth_state"] = state

    params = {
        "client_id":     DISCORD_CLIENT_ID,
        "redirect_uri":  DISCORD_REDIRECT_URI,
        "response_type": "code",
        "scope":         "identify email guilds",
        "state":         state,
        "prompt":        "consent",
    }
    url = DISCORD_OAUTH_AUTHORIZE + "?" + "&".join(
        f"{k}={requests.utils.quote(str(v), safe='')}" for k, v in params.items()
    )
    return redirect(url)


@app.route("/auth/discord/callback")
def discord_callback():
    error = request.args.get("error")
    if error:
        return f"Discord OAuth error: {error}", 400

    state = request.args.get("state")
    if not state or state != session.pop("oauth_state", None):
        return "Invalid OAuth state (CSRF).", 400

    code = request.args.get("code")
    if not code:
        return "Missing code.", 400

    data = {
        "client_id":     DISCORD_CLIENT_ID,
        "client_secret": DISCORD_CLIENT_SECRET,
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  DISCORD_REDIRECT_URI,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    r = requests.post(DISCORD_OAUTH_TOKEN, data=data, headers=headers, timeout=10)
    if r.status_code != 200:
        return f"Token exchange failed: {r.status_code} {r.text}", 502

    token_data    = r.json()
    access_token  = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in    = token_data.get("expires_in", 604800)

    r = requests.get(
        DISCORD_API_ME,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    )
    if r.status_code != 200:
        return f"Failed to fetch user: {r.status_code} {r.text}", 502

    u = r.json()

    session["user"] = {
        "id":            u["id"],
        "username":      u["username"],
        "global_name":   u.get("global_name"),
        "discriminator": u.get("discriminator"),
        "avatar":        u.get("avatar"),
        "email":         u.get("email"),
    }
    session["discord_token"] = {
        "access_token":  access_token,
        "refresh_token": refresh_token,
        "expires_in":    expires_in,
    }

    return redirect(url_for("home"))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("home"))


@app.route("/api/me")
def api_me():
    u = current_user()
    if not u:
        return jsonify(ok=False), 401

    avatar_url = None
    if u.get("avatar"):
        ext = "gif" if str(u["avatar"]).startswith("a_") else "png"
        avatar_url = f"https://cdn.discordapp.com/avatars/{u['id']}/{u['avatar']}.{ext}?size=128"

    return jsonify(ok=True, user={**u, "avatar_url": avatar_url})


@app.route("/api/rooms")
@login_required
def api_rooms():
    out = {}
    for map_id, room in MAP_ROOMS.items():
        out[map_id] = {
            "actions": len(room["actions"]),
            "chat":    len(room["chat"]),
            "users":   [u["name"] for u in room["users"].values()],
        }
    return jsonify(ok=True, async_mode=async_mode, rooms=out)


# ============================================================
# НОВЫЙ МАРШРУТ: список редакторов по картам
# ============================================================
@app.route("/api/map-editors")
def api_map_editors():
    """
    Возвращает { map_id: [ {name, avatar, color}, ... ] }
    """
    snapshot = {}
    for map_id, room in MAP_ROOMS.items():
        users = room.get("users", {})
        if not users:
            continue

        seen = {}
        for u in users.values():
            key = u.get("id") or u.get("name")
            if key in seen:
                continue

            avatar_url = None
            if u.get("avatar"):
                ext = "gif" if str(u["avatar"]).startswith("a_") else "png"
                avatar_url = f"https://cdn.discordapp.com/avatars/{u['id']}/{u['avatar']}.{ext}?size=64"

            seen[key] = {
                "name":   u.get("name"),
                "avatar": avatar_url,
                "color":  u.get("color"),
            }
        snapshot[map_id] = list(seen.values())

    return jsonify(snapshot)


@app.route("/api/profile/stats")
@login_required
def api_profile_stats():
    u = current_user()
    uid = str(u.get("id") or "")
    is_admin = _is_admin(uid)

    seed = abs(hash(uid)) if uid else 0
    rank_idx = seed % 11

    branches = [
        {"id": "stalzone_main",  "game": "STALZONE",                     "name": "Legion Of The Damned", "type": "Подразделение", "role": "Боевой Брат"},
        {"id": "korps_of_death", "game": "STALZONE",                     "name": "Korps Of Death",       "type": "Подклан",       "role": "Неофит"},
        {"id": "wow_firestorm",  "game": "World Of Warcraft · Firestorm", "name": "Legion Of The Damned", "type": "Гильдия",       "role": "Боевой Брат"},
        {"id": "ec_resurr",      "game": "Eternal Crusade · Resurrections","name": "Legion Of The Damned","type": "Орден",        "role": "Боевой Брат"},
    ]

    return jsonify(
        ok=True,
        user={
            "id": uid,
            "username": u.get("username"),
            "global_name": u.get("global_name"),
            "is_admin": is_admin,
        },
        stats={
            "rank": rank_idx,
            "kills": 300 + seed % 700,
            "deaths": 120 + seed % 300,
            "kv_participation": 10 + seed % 40,
            "activity_hours_week": 6 + seed % 15,
            "joined_at": "2024-08-15",
        },
        branches=[{**b, "joined": True} for b in branches],
    )


# ============================================================
# Socket.IO — совместное редактирование карт
# ============================================================

def _sanitize_action(action: dict):
    if not isinstance(action, dict):
        return None
    tool = action.get("tool")
    allowed = {
        "pen", "line", "outlineLine", "arrow", "circle", "rectSelect",
        "text", "attack", "defense", "tent", "recon",
    }
    if tool not in allowed:
        return None

    col = action.get("color", "#ff1a1a")
    if not (isinstance(col, str) and len(col) == 7 and col.startswith("#")):
        col = "#ff1a1a"
    action["color"] = col

    if "width" in action and isinstance(action["width"], (int, float)):
        action["width"] = max(1, min(50, float(action["width"])))
    if "size" in action and isinstance(action["size"], (int, float)):
        action["size"] = max(8, min(200, float(action["size"])))

    if tool == "text":
        if not isinstance(action.get("text"), str):
            return None
        action["text"] = action["text"][:2000]

    if tool == "pen":
        path = action.get("path")
        if not isinstance(path, list) or len(path) < 2:
            return None
        if len(path) > 5000:
            action["path"] = path[:5000]

    return action


@socketio.on("join_map")
def handle_join_map(data):
    user = session.get("user")
    if not user:
        emit("error_msg", {"error": "not_authorized"})
        return

    map_id = _safe_map_id(data.get("map_id"))
    if not map_id:
        return

    room = get_room(map_id)
    room["last_active"] = time.time()

    try:
        color_idx = int(user["id"]) % len(USER_COLORS)
    except (TypeError, ValueError):
        color_idx = 0
    color = USER_COLORS[color_idx]

    user_info = {
        "id":     user["id"],
        "name":   user.get("global_name") or user.get("username") or "Гость",
        "avatar": user.get("avatar"),
        "color":  color,
        "cursor": None,
    }

    room["users"][request.sid] = user_info
    join_room(map_id)

    emit("map_state", {
        "actions": room["actions"],
        "users":   room["users"],
        "chat":    room["chat"][-CHAT_HISTORY_LIMIT:],
    })

    emit("user_joined", {
        "sid":  request.sid,
        "user": user_info,
    }, to=map_id, include_self=False)

    emit("users_update", {"users": room["users"]}, to=map_id)
    
    # Оповещаем всех, кто на экране выбора, об обновлении
    socketio.emit("map_editors_update", _build_editors_snapshot())


@socketio.on("leave_map")
def handle_leave_map(data):
    map_id = _safe_map_id(data.get("map_id"))
    if not map_id:
        return
    room = MAP_ROOMS.get(map_id)
    if not room:
        return
    room["users"].pop(request.sid, None)
    leave_room(map_id)

    emit("user_left", {"sid": request.sid}, to=map_id)
    emit("users_update", {"users": room["users"]}, to=map_id)
    
    # Оповещаем всех
    socketio.emit("map_editors_update", _build_editors_snapshot())


@socketio.on("disconnect")
def handle_disconnect():
    for map_id, room in list(MAP_ROOMS.items()):
        if request.sid in room["users"]:
            room["users"].pop(request.sid, None)
            emit("user_left", {"sid": request.sid}, to=map_id)
            emit("users_update", {"users": room["users"]}, to=map_id)
    
    # Оповещаем всех
    socketio.emit("map_editors_update", _build_editors_snapshot())


# Вспомогательная функция для сборки снапшота (используется в сокетах)
def _build_editors_snapshot():
    snapshot = {}
    for map_id, room in MAP_ROOMS.items():
        users = room.get("users", {})
        if not users:
            continue
        seen = {}
        for u in users.values():
            key = u.get("id") or u.get("name")
            if key in seen:
                continue
            avatar_url = None
            if u.get("avatar"):
                ext = "gif" if str(u["avatar"]).startswith("a_") else "png"
                avatar_url = f"https://cdn.discordapp.com/avatars/{u['id']}/{u['avatar']}.{ext}?size=64"
            seen[key] = {
                "name":   u.get("name"),
                "avatar": avatar_url,
                "color":  u.get("color"),
            }
        snapshot[map_id] = list(seen.values())
    return snapshot


@socketio.on("add_action")
def handle_add_action(data):
    user = session.get("user")
    if not user:
        return
    map_id = _safe_map_id(data.get("map_id"))
    if not map_id:
        return

    action = _sanitize_action(data.get("action") or {})
    if not action:
        return

    room = get_room(map_id)
    room["last_active"] = time.time()

    action["_author"] = user.get("global_name") or user.get("username") or "Гость"
    action["_author_id"] = user["id"]
    room["actions"].append(action)
    room["dirty"] = True

    emit("action_added", {"action": action}, to=map_id, include_self=False)


@socketio.on("remove_action")
def handle_remove_action(data):
    user = session.get("user")
    if not user:
        return
    map_id = _safe_map_id(data.get("map_id"))
    if not map_id:
        return

    try:
        index = int(data.get("index"))
    except (TypeError, ValueError):
        return

    room = get_room(map_id)
    if not (0 <= index < len(room["actions"])):
        return

    act = room["actions"][index]
    if not _is_admin(user["id"]) and act.get("_author_id") != user["id"]:
        return

    room["actions"].pop(index)
    room["dirty"] = True
    emit("action_removed", {"index": index}, to=map_id, include_self=False)


@socketio.on("clear_map")
def handle_clear_map(data):
    user = session.get("user")
    if not user:
        return
    map_id = _safe_map_id(data.get("map_id"))
    if not map_id:
        return

    if not _is_admin(user["id"]):
        emit("error_msg", {"error": "clear_not_allowed"})
        return

    room = get_room(map_id)
    room["actions"] = []
    room["dirty"] = True
    save_room(map_id, force=True)

    emit("map_cleared", {}, to=map_id)


@socketio.on("cursor_move")
def handle_cursor_move(data):
    user = session.get("user")
    if not user:
        return
    map_id = _safe_map_id(data.get("map_id"))
    if not map_id:
        return

    try:
        x = float(data.get("x"))
        y = float(data.get("y"))
    except (TypeError, ValueError):
        return

    room = get_room(map_id)
    if request.sid in room["users"]:
        room["users"][request.sid]["cursor"] = {"x": x, "y": y}
        emit("cursor_moved", {
            "sid": request.sid,
            "x":   x,
            "y":   y,
        }, to=map_id, include_self=False)


@socketio.on("undo_action")
def handle_undo_action(data):
    user = session.get("user")
    if not user:
        return
    map_id = _safe_map_id(data.get("map_id"))
    if not map_id:
        return

    room = get_room(map_id)
    uid = user["id"]

    for i in range(len(room["actions"]) - 1, -1, -1):
        if room["actions"][i].get("_author_id") == uid:
            room["actions"].pop(i)
            room["dirty"] = True
            emit("action_removed", {"index": i}, to=map_id)
            return


@socketio.on("chat_message")
def handle_chat_message(data):
    user = session.get("user")
    if not user:
        return
    map_id = _safe_map_id(data.get("map_id"))
    if not map_id:
        return

    text = (data.get("text") or "").strip()
    if not text:
        return
    text = text[:500]

    name = user.get("global_name") or user.get("username") or "Гость"
    msg = {"name": name, "text": text, "ts": time.time()}

    room = get_room(map_id)
    room["chat"].append(msg)
    if len(room["chat"]) > CHAT_HISTORY_LIMIT:
        room["chat"] = room["chat"][-CHAT_HISTORY_LIMIT:]
    room["dirty"] = True

    emit("chat_message", msg, to=map_id)


if __name__ == "__main__":
    socketio.run(app, debug=True, host="0.0.0.0", port=5000)