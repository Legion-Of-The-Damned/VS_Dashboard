/* ==========================================================================
   LEGION BEACON — вся логика страницы:
   - конструктор embeds (добавление, удаление, drag&drop, поля)
   - превью в стиле Discord
   - отправка вебхука
   - пресеты (сохранение/загрузка JSON)
   - очистка формы
   ========================================================================== */
(function () {
    "use strict";

    /* ---------- Хелперы ---------- */
    const $ = (id) => document.getElementById(id);

    function hexToInt(hex) {
        hex = (hex || "").replace("#", "").trim();
        if (hex.length !== 6) return 0;
        const n = parseInt(hex, 16);
        return isNaN(n) ? 0 : n;
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function renderDiscordMarkdown(text) {
        let t = escapeHtml(text);
        t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
        t = t.replace(/__(.+?)__/g, "<u>$1</u>");
        t = t.replace(/~~(.+?)~~/g, "<s>$1</s>");
        t = t.replace(/\*(.+?)\*/g, "<em>$1</em>");
        t = t.replace(/`(.+?)`/g, "<code>$1</code>");
        return t;
    }

    /* ---------- Инициализация после загрузки DOM ---------- */
    function initBeacon() {
        const embedsContainer = $("embedsContainer");
        const addEmbedBtnBottom = $("addEmbedBtnBottom");
        const previewBox = $("dcPreview");

        // Если разметки нет — выходим (страница не Beacon)
        if (!embedsContainer || !addEmbedBtnBottom || !previewBox) {
            console.warn("[beacon] Элементы формы не найдены. Скрипт остановлен.");
            return;
        }

        let embedCounter = 0;

        /* ---------- EMBEDS: конструктор ---------- */
        function createEmbedBlock(index) {
            const id = "embed-" + (++embedCounter);
            const block = document.createElement("div");
            block.className = "embed-block";
            block.dataset.embedId = id;
            block.draggable = false;

            block.innerHTML = `
                <div class="embed-block-header">
                    <span class="drag-handle" title="Перетащите, чтобы изменить порядок">⋮⋮</span>
                    <span class="title">Embed #${index}</span>
                    <button type="button" class="btn-move btn-move-up" title="Вверх">↑</button>
                    <button type="button" class="btn-move btn-move-down" title="Вниз">↓</button>
                    <button type="button" class="btn-remove" title="Удалить">×</button>
                </div>

                <div class="row">
                    <div class="col">
                        <label>Заголовок</label>
                        <input type="text" class="emb-title" maxlength="256" placeholder="Заголовок embed">
                    </div>
                    <div class="col">
                        <label>URL заголовка (гиперссылка)</label>
                        <input type="url" class="emb-title-url" placeholder="https://example.com">
                    </div>
                </div>

                <div class="row">
                    <div class="col col-color">
                        <label>Цвет</label>
                        <div class="color-row">
                            <input type="color" class="emb-color-picker" value="#b91c1c">
                            <input type="text" class="emb-color-text" value="#b91c1c" maxlength="7">
                        </div>
                    </div>
                </div>

                <label>Описание</label>
                <textarea class="emb-description" maxlength="4000" placeholder="Основной текст..."></textarea>

                <div class="row">
                    <div class="col">
                        <label>Автор (имя)</label>
                        <input type="text" class="emb-author-name" maxlength="256" placeholder="Магистр">
                    </div>
                    <div class="col">
                        <label>Автор (иконка URL)</label>
                        <input type="url" class="emb-author-icon" placeholder="https://...">
                    </div>
                </div>

                <div class="row">
                    <div class="col">
                        <label>Автор (ссылка URL)</label>
                        <input type="url" class="emb-author-url" placeholder="https://...">
                    </div>
                    <div class="col">
                        <label>Футер</label>
                        <input type="text" class="emb-footer" maxlength="2048" placeholder="Legion Of The Damned">
                    </div>
                </div>

                <div class="row">
                    <div class="col">
                        <label>Картинка (URL)</label>
                        <input type="url" class="emb-image" placeholder="https://example.com/image.png">
                    </div>
                    <div class="col">
                        <label>Миниатюра / thumbnail (URL)</label>
                        <input type="url" class="emb-thumbnail" placeholder="https://example.com/small.png">
                    </div>
                </div>

                <div class="fields-list">
                    <div class="embed-block-header fields-header">
                        <span class="title fields-title">Fields (поля)</span>
                    </div>
                    <div class="fields-container"></div>
                    <button type="button" class="btn-add-field">+ Добавить поле</button>
                </div>
            `;

            block.querySelector(".btn-remove").addEventListener("click", () => {
                block.remove();
                renumberEmbeds();
                updatePreview();
            });

            block.querySelector(".btn-move-up").addEventListener("click", () => {
                const prev = block.previousElementSibling;
                if (prev && prev.classList.contains("embed-block")) {
                    embedsContainer.insertBefore(block, prev);
                    renumberEmbeds();
                    updatePreview();
                }
            });
            block.querySelector(".btn-move-down").addEventListener("click", () => {
                const next = block.nextElementSibling;
                if (next && next.classList.contains("embed-block")) {
                    embedsContainer.insertBefore(next, block);
                    renumberEmbeds();
                    updatePreview();
                }
            });

            const handle = block.querySelector(".drag-handle");
            handle.addEventListener("mousedown", () => { block.draggable = true; });
            handle.addEventListener("mouseup",   () => { block.draggable = false; });
            block.addEventListener("dragstart", (e) => {
                block.classList.add("dragging");
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", id);
            });
            block.addEventListener("dragend", () => {
                block.classList.remove("dragging");
                block.draggable = false;
                embedsContainer.querySelectorAll(".embed-block")
                    .forEach((b) => b.classList.remove("drag-over"));
            });

            const colorPicker = block.querySelector(".emb-color-picker");
            const colorTextEl = block.querySelector(".emb-color-text");
            colorPicker.addEventListener("input", () => {
                colorTextEl.value = colorPicker.value;
                updatePreview();
            });
            colorTextEl.addEventListener("input", () => {
                if (/^#[0-9a-fA-F]{6}$/.test(colorTextEl.value)) {
                    colorPicker.value = colorTextEl.value;
                }
                updatePreview();
            });

            block.querySelector(".btn-add-field").addEventListener("click", () => {
                addFieldRow(block.querySelector(".fields-container"));
                updatePreview();
            });

            block.querySelectorAll("input, textarea, select").forEach((el) => {
                el.addEventListener("input", updatePreview);
                el.addEventListener("change", updatePreview);
            });

            return block;
        }

        function addFieldRow(container, data) {
            const row = document.createElement("div");
            row.className = "field-row";
            row.innerHTML = `
                <input type="text" class="field-name"  placeholder="Имя поля" maxlength="256">
                <input type="text" class="field-value" placeholder="Значение"  maxlength="1024">
                <label class="field-inline">
                    <input type="checkbox" class="field-inline-cb"> inline
                </label>
                <button type="button" class="btn-remove-field" title="Удалить поле">×</button>
            `;
            if (data) {
                row.querySelector(".field-name").value  = data.name  || "";
                row.querySelector(".field-value").value = data.value || "";
                row.querySelector(".field-inline-cb").checked = !!data.inline;
            }
            row.querySelector(".btn-remove-field").addEventListener("click", () => {
                row.remove();
                updatePreview();
            });
            container.appendChild(row);
        }

        function renumberEmbeds() {
            embedsContainer.querySelectorAll(".embed-block").forEach((b, i) => {
                b.querySelector(".title").textContent = "Embed #" + (i + 1);
            });
        }

        /* ---------- Drag & drop на контейнере ---------- */
        function getDragAfterElement(container, y) {
            const els = [...container.querySelectorAll(".embed-block:not(.dragging)")];
            return els.reduce((closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;
                if (offset < 0 && offset > closest.offset) {
                    return { offset, element: child };
                }
                return closest;
            }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
        }

        embedsContainer.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const dragging = embedsContainer.querySelector(".embed-block.dragging");
            if (!dragging) return;

            const after = getDragAfterElement(embedsContainer, e.clientY);
            if (after == null) {
                embedsContainer.appendChild(dragging);
            } else {
                embedsContainer.insertBefore(dragging, after);
            }
        });

        embedsContainer.addEventListener("drop", (e) => {
            e.preventDefault();
            renumberEmbeds();
            updatePreview();
        });

        /* ---------- Верхние поля ---------- */
        const mentionSelect = $("whMention");
        mentionSelect.addEventListener("change", (e) => {
            $("whMentionCustom").classList.toggle("hidden", e.target.value !== "custom");
            updatePreview();
        });

        ["whContent", "whUsername", "whAvatar", "whMention", "whMentionCustom", "whTts"]
            .forEach((id) => {
                const el = $(id);
                if (!el) return;
                el.addEventListener("input", updatePreview);
                el.addEventListener("change", updatePreview);
            });

        /* ---------- Сбор embeds ---------- */
        function collectEmbeds() {
            const result = [];
            embedsContainer.querySelectorAll(".embed-block").forEach((block) => {
                const emb = {};
                emb.id = block.dataset.embedId;

                const title     = block.querySelector(".emb-title").value.trim();
                const titleUrl  = block.querySelector(".emb-title-url").value.trim();
                const descr     = block.querySelector(".emb-description").value.trim();
                const colorHex  = block.querySelector(".emb-color-text").value.trim();
                const authorNm  = block.querySelector(".emb-author-name").value.trim();
                const authorIc  = block.querySelector(".emb-author-icon").value.trim();
                const authorUrl = block.querySelector(".emb-author-url").value.trim();
                const image     = block.querySelector(".emb-image").value.trim();
                const thumbnail = block.querySelector(".emb-thumbnail").value.trim();
                const footer    = block.querySelector(".emb-footer").value.trim();

                if (title)     emb.title = title;
                if (titleUrl)  emb.url = titleUrl;
                if (descr)     emb.description = descr;
                if (colorHex)  emb.color = hexToInt(colorHex);
                if (authorNm)  emb.author = { name: authorNm };
                if (authorIc && emb.author) emb.author.icon_url = authorIc;
                if (authorUrl && emb.author) emb.author.url = authorUrl;
                if (image)     emb.image = { url: image };
                if (thumbnail) emb.thumbnail = { url: thumbnail };
                if (footer)    emb.footer = { text: footer };

                const fields = [];
                block.querySelectorAll(".field-row").forEach((fr) => {
                    const name   = fr.querySelector(".field-name").value.trim();
                    const value  = fr.querySelector(".field-value").value.trim();
                    const inline = fr.querySelector(".field-inline-cb").checked;
                    if (name && value) fields.push({ name, value, inline });
                });
                if (fields.length) emb.fields = fields;

                if (Object.keys(emb).length > 0) result.push(emb);
            });
            return result;
        }

        /* ---------- Превью ---------- */
        function updatePreview() {
            const box = previewBox;

            const username      = $("whUsername").value.trim() || "Legion Beacon";
            const avatar        = $("whAvatar").value.trim();
            const content       = $("whContent").value.trim();
            const mention       = $("whMention").value;
            const mentionCustom = $("whMentionCustom").value.trim();
            const embeds        = collectEmbeds();

            if (!content && !avatar && embeds.length === 0 &&
                mention === "none" && !$("whUsername").value.trim()) {
                box.className = "dc-empty";
                box.textContent = "Начните заполнять форму — здесь появится предпросмотр сообщения";
                return;
            }

            let finalContent = content;
            if (mention === "@here" || mention === "@everyone") {
                finalContent = (finalContent ? finalContent + "\n" : "") + mention;
            } else if (mention === "custom" && mentionCustom) {
                finalContent = (finalContent ? finalContent + "\n" : "") + mentionCustom;
            }

            const initial = escapeHtml((username[0] || "?").toUpperCase());
            let avatarHtml;
            if (avatar) {
                avatarHtml = `<img src="${escapeHtml(avatar)}" alt=""
                                  onerror="this.style.display='none';this.parentNode.textContent='${initial}';">`;
            } else {
                avatarHtml = initial;
            }

            let embedsHtml = "";
            embeds.forEach((emb) => {
                const colorInput = document.querySelector(
                    `.embed-block[data-embed-id="${emb.id}"] .emb-color-text`
                );
                let colorHex = colorInput ? colorInput.value : "#b91c1c";
                if (!colorHex.startsWith("#")) colorHex = "#" + colorHex;

                const authorHtml = emb.author ? `
                    <div class="dc-embed-author">
                        ${emb.author.icon_url ? `<img src="${escapeHtml(emb.author.icon_url)}" alt="" onerror="this.style.display='none';">` : ""}
                        <span>${escapeHtml(emb.author.name)}</span>
                    </div>` : "";

                const fieldsHtml = emb.fields ? `
                    <div class="dc-embed-fields">
                        ${emb.fields.map((f) => `
                            <div class="dc-embed-field ${f.inline ? "inline" : "full"}">
                                <div class="dc-embed-field-name">${escapeHtml(f.name)}</div>
                                <div class="dc-embed-field-value">${renderDiscordMarkdown(f.value)}</div>
                            </div>
                        `).join("")}
                    </div>` : "";

                const thumbHtml = emb.thumbnail
                    ? `<img class="dc-embed-thumb" src="${escapeHtml(emb.thumbnail.url)}" alt=""
                            onerror="this.style.display='none';">`
                    : "";

                const titleHtml = emb.title
                    ? `<div class="dc-embed-title">${
                          emb.url
                              ? `<a href="${escapeHtml(emb.url)}" target="_blank" rel="noopener">${escapeHtml(emb.title)}</a>`
                              : escapeHtml(emb.title)
                      }</div>`
                    : "";

                const mainHtml = `
                    ${authorHtml}
                    ${titleHtml}
                    ${emb.description ? `<div class="dc-embed-description">${renderDiscordMarkdown(emb.description)}</div>` : ""}
                    ${fieldsHtml}
                    ${emb.image ? `<img class="dc-embed-image" src="${escapeHtml(emb.image.url)}" alt=""
                                      onerror="this.style.display='none';">` : ""}
                    ${emb.footer ? `<div class="dc-embed-footer">${escapeHtml(emb.footer.text)}</div>` : ""}
                `;

                embedsHtml += `
                    <div class="dc-embed" style="border-left-color:${colorHex};">
                        ${thumbHtml
                            ? `<div class="dc-embed-with-thumb">
                                    <div class="dc-embed-main">${mainHtml}</div>
                                    ${thumbHtml}
                                </div>`
                            : mainHtml}
                    </div>`;
            });

            box.className = "dc-message-wrapper";
            box.innerHTML = `
                <div class="dc-message">
                    <div class="dc-avatar">${avatarHtml}</div>
                    <div class="dc-body">
                        <div class="dc-header">
                            <span class="dc-username">${escapeHtml(username)}</span>
                            <span class="dc-bot-tag">Webhook</span>
                            <span class="dc-timestamp">сегодня в ${new Date().toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"})}</span>
                        </div>
                        ${finalContent ? `<div class="dc-content">${renderDiscordMarkdown(finalContent)}</div>` : ""}
                        ${embedsHtml}
                    </div>
                </div>`;
        }

        /* ---------- Отправка ---------- */
        $("webhookForm").addEventListener("submit", async (e) => {
            e.preventDefault();

            const status = $("whStatus");
            const submit = $("whSubmit");

            const url           = $("whUrl").value.trim();
            const username      = $("whUsername").value.trim();
            const avatar        = $("whAvatar").value.trim();
            const content       = $("whContent").value.trim();
            const mention       = $("whMention").value;
            const mentionCustom = $("whMentionCustom").value.trim();
            const tts           = $("whTts").checked;
            const embeds        = collectEmbeds();

            status.className = "beacon-status";
            status.textContent = "";

            if (!url || !url.startsWith("https://discord.com/api/webhooks/")) {
                status.className = "beacon-status err";
                status.textContent = "❌ Укажите корректный URL вебхука Discord (он должен начинаться с https://discord.com/api/webhooks/).";
                return;
            }
            if (!content && embeds.length === 0) {
                status.className = "beacon-status err";
                status.textContent = "❌ Заполните текст или хотя бы один embed.";
                return;
            }
            if (embeds.length > 10) {
                status.className = "beacon-status err";
                status.textContent = "❌ Discord разрешает максимум 10 embeds в одном сообщении.";
                return;
            }

            const payload = {};
            if (username) payload.username = username;
            if (avatar)   payload.avatar_url = avatar;
            if (tts)      payload.tts = true;

            let finalContent = content;
            if (mention === "@here" || mention === "@everyone") {
                finalContent = (finalContent ? finalContent + "\n" : "") + mention;
            } else if (mention === "custom" && mentionCustom) {
                finalContent = (finalContent ? finalContent + "\n" : "") + mentionCustom;
            }
            if (finalContent) payload.content = finalContent;
            if (embeds.length) payload.embeds = embeds;

            submit.disabled = true;
            submit.textContent = "Отправка...";

            try {
                const res = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });

                if (res.status === 204 || res.ok) {
                    status.className = "beacon-status ok";
                    status.textContent = "✅ Сообщение успешно отправлено в Discord!";
                } else if (res.status === 429) {
                    const data = await res.json().catch(() => ({}));
                    const wait = data.retry_after ? (data.retry_after / 1000).toFixed(1) : "несколько";
                    status.className = "beacon-status err";
                    status.textContent = `⏳ Rate limit. Повторите через ${wait} сек.`;
                } else if (res.status === 404) {
                    status.className = "beacon-status err";
                    status.textContent = "❌ Вебхук не найден (404). Проверьте URL.";
                } else if (res.status === 401 || res.status === 403) {
                    status.className = "beacon-status err";
                    status.textContent = "❌ Вебхук недействителен или удалён.";
                } else {
                    const text = await res.text().catch(() => "");
                    status.className = "beacon-status err";
                    status.textContent = `❌ Ошибка ${res.status}: ${text.slice(0, 200)}`;
                }
            } catch (err) {
                status.className = "beacon-status err";
                status.textContent = "❌ Не удалось отправить: " + err.message;
            } finally {
                submit.disabled = false;
                submit.textContent = "Отправить в Discord";
            }
        });

        /* ---------- Пресеты ---------- */
        const PRESET_FILENAME_DEFAULT = "legion-beacon-preset.json";

        function gatherFormState() {
            const embeds = [];
            embedsContainer.querySelectorAll(".embed-block").forEach((block) => {
                const fields = [];
                block.querySelectorAll(".field-row").forEach((fr) => {
                    fields.push({
                        name:  fr.querySelector(".field-name").value,
                        value: fr.querySelector(".field-value").value,
                        inline: fr.querySelector(".field-inline-cb").checked,
                    });
                });
                embeds.push({
                    title:       block.querySelector(".emb-title").value,
                    titleUrl:    block.querySelector(".emb-title-url").value,
                    color:       block.querySelector(".emb-color-text").value,
                    description: block.querySelector(".emb-description").value,
                    authorName:  block.querySelector(".emb-author-name").value,
                    authorIcon:  block.querySelector(".emb-author-icon").value,
                    authorUrl:   block.querySelector(".emb-author-url").value,
                    image:       block.querySelector(".emb-image").value,
                    thumbnail:   block.querySelector(".emb-thumbnail").value,
                    footer:      block.querySelector(".emb-footer").value,
                    fields,
                });
            });

            return {
                version: 1,
                savedAt: new Date().toISOString(),
                whUrl:           $("whUrl").value,
                whUsername:      $("whUsername").value,
                whAvatar:        $("whAvatar").value,
                whContent:       $("whContent").value,
                whMention:       $("whMention").value,
                whMentionCustom: $("whMentionCustom").value,
                whTts:           $("whTts").checked,
                embeds,
            };
        }

        function applyFormState(state) {
            $("whUrl").value           = state.whUrl || "";
            $("whUsername").value      = state.whUsername || "";
            $("whAvatar").value        = state.whAvatar || "";
            $("whContent").value       = state.whContent || "";
            $("whMention").value       = state.whMention || "none";
            $("whMentionCustom").value = state.whMentionCustom || "";
            $("whMentionCustom").classList.toggle("hidden", $("whMention").value !== "custom");
            $("whTts").checked         = !!state.whTts;

            embedsContainer.innerHTML = "";
            embedCounter = 0;

            if (Array.isArray(state.embeds) && state.embeds.length) {
                state.embeds.forEach((data, i) => {
                    const block = createEmbedBlock(i + 1);
                    block.querySelector(".emb-title").value        = data.title || "";
                    block.querySelector(".emb-title-url").value    = data.titleUrl || "";
                    block.querySelector(".emb-color-text").value   = data.color || "#b91c1c";
                    block.querySelector(".emb-color-picker").value = data.color || "#b91c1c";
                    block.querySelector(".emb-description").value  = data.description || "";
                    block.querySelector(".emb-author-name").value  = data.authorName || "";
                    block.querySelector(".emb-author-icon").value  = data.authorIcon || "";
                    block.querySelector(".emb-author-url").value   = data.authorUrl || "";
                    block.querySelector(".emb-image").value        = data.image || "";
                    block.querySelector(".emb-thumbnail").value    = data.thumbnail || "";
                    block.querySelector(".emb-footer").value       = data.footer || "";

                    const fieldsContainer = block.querySelector(".fields-container");
                    if (Array.isArray(data.fields)) {
                        data.fields.forEach((f) => addFieldRow(fieldsContainer, f));
                    }

                    embedsContainer.appendChild(block);
                });
            } else {
                addDefaultEmbed();
            }

            updatePreview();
        }

        $("presetSaveBtn").addEventListener("click", () => {
            const data = gatherFormState();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });

            const fname = prompt("Имя файла пресета:", PRESET_FILENAME_DEFAULT);
            if (fname === null) return;

            const safeName = (fname.trim() || PRESET_FILENAME_DEFAULT)
                .replace(/[\\/:*?"<>|]+/g, "_")
                .replace(/\.json$/i, "") + ".json";

            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = safeName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            $("presetFileName").textContent = "Сохранён: " + safeName;
        });

        $("presetLoadBtn").addEventListener("click", () => {
            $("presetFileInput").click();
        });

        $("presetFileInput").addEventListener("change", (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const data = JSON.parse(reader.result);
                    applyFormState(data);
                    $("presetFileName").textContent = "Загружен: " + file.name;
                } catch (err) {
                    alert("Не удалось прочитать пресет: " + err.message);
                } finally {
                    e.target.value = "";
                }
            };
            reader.onerror = () => {
                alert("Ошибка чтения файла.");
                e.target.value = "";
            };
            reader.readAsText(file, "utf-8");
        });

        /* ---------- Очистка ---------- */
        $("whClear").addEventListener("click", () => {
            $("webhookForm").reset();
            $("whMentionCustom").classList.add("hidden");
            embedsContainer.innerHTML = "";
            embedCounter = 0;
            addDefaultEmbed();
            $("whStatus").className  = "beacon-status";
            $("whStatus").textContent = "";
            $("presetFileName").textContent = "";
            updatePreview();
        });

        /* ---------- Кнопка "Добавить embed" ---------- */
        addEmbedBtnBottom.addEventListener("click", () => {
            const index = embedsContainer.querySelectorAll(".embed-block").length + 1;
            embedsContainer.appendChild(createEmbedBlock(index));
            updatePreview();
        });

        /* ---------- Инициализация ---------- */
        function addDefaultEmbed() {
            embedsContainer.appendChild(createEmbedBlock(1));
        }

        addDefaultEmbed();
        updatePreview();
    }

    /* Запускаем когда DOM готов */
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initBeacon);
    } else {
        initBeacon();
    }
})();