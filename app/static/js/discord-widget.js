const DISCORD_GUILD_ID = "828749346505490503";
const container = document.getElementById("discord-custom-widget");

// Локаль для виджета
const discordLocale = {
    ru: { online: "в сети", noMembers: "Нет видимых участников", offline: "Discord оффлайн" },
    ua: { online: "в мережі", noMembers: "Немає видимих учасників", offline: "Discord офлайн" },
    en: { online: "online", noMembers: "No members visible", offline: "Discord Offline" }
};

// Получаем текущий язык из селекта или localStorage
function getCurrentLang() {
    const saved = localStorage.getItem("lang");
    if(saved && discordLocale[saved]) return saved;
    const browser = navigator.language.slice(0,2);
    return discordLocale[browser] ? browser : "ru";
}

// Главная функция для загрузки и рендера виджета
async function loadDiscordWidget(lang = getCurrentLang()) {
    const locale = discordLocale[lang] || discordLocale["ru"];

    if (!container) return console.warn("Discord widget container not found");

    try {
        const response = await fetch(`https://discord.com/api/guilds/${DISCORD_GUILD_ID}/widget.json`);
        if (!response.ok) throw new Error("Discord API error");

        const data = await response.json();
        renderWidget(data, locale);
    } catch (err) {
        renderOffline(locale);
        console.error("Discord widget failed:", err);
    }
}

function renderWidget(data, locale) {
    const online = data.presence_count || 0;
    const pulseSpeed = Math.max(0.3, 2 - online / 50);

    container.innerHTML = `
        <div class="discord-card online">
            <div class="discord-header">
                <span class="status-dot" style="animation-duration: ${pulseSpeed}s;"></span>
                <span class="server-name">${data.name}</span>
            </div>
            <div class="discord-info">
                <div class="discord-stat">
                    <strong>${online}</strong>
                    <span>${locale.online}</span>
                </div>
            </div>
            <div class="discord-members">
                ${
                    data.members
                        ? data.members.map(member => `
                    <div class="member">
                        <img src="${member.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png'}" alt="${member.username}">
                        <span class="member-name">${member.username}</span>
                        <span class="member-status ${member.status}"></span>
                    </div>
                `).join("")
                        : `<span>${locale.noMembers}</span>`
                }
            </div>
        </div>
    `;
}

function renderOffline(locale) {
    container.innerHTML = `
        <div class="discord-card offline">
            <div class="discord-header">
                <span class="status-dot offline"></span>
                <span class="server-name">${locale.offline}</span>
            </div>
            <div class="discord-info">
                <div class="discord-stat">
                    <strong>0</strong>
                    <span>${locale.online}</span>
                </div>
            </div>
        </div>
    `;
}

// Первичная загрузка и обновление каждые 60 секунд
loadDiscordWidget();
setInterval(() => loadDiscordWidget(getCurrentLang()), 60000);

// Если меняем язык на сайте — перерисовать виджет
document.getElementById("langSelect").addEventListener("change", e => {
    const newLang = e.target.value;
    localStorage.setItem("lang", newLang);
    loadDiscordWidget(newLang);
});