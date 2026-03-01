const DISCORD_GUILD_ID = "828749346505490503";
const container = document.getElementById("discord-custom-widget");

if (!container) {
    console.warn("Discord widget container not found");
} else {
    async function loadDiscordWidget() {
        try {
            const response = await fetch(
                `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/widget.json`
            );

            if (!response.ok) throw new Error("Discord API error");

            const data = await response.json();
            renderWidget(data);
        } catch (err) {
            renderOffline();
            console.error("Discord widget failed:", err);
        }
    }

    function renderWidget(data) {
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
                        <span>online</span>
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
                            : '<span>No members visible</span>'
                    }
                </div>
            </div>
        `;
    }

    function renderOffline() {
        container.innerHTML = `
            <div class="discord-card offline">
                <div class="discord-header">
                    <span class="status-dot offline"></span>
                    <span class="server-name">Discord Offline</span>
                </div>
                <div class="discord-info">
                    <div class="discord-stat">
                        <strong>${online}</strong>
                        <span>online</span>
                    </div>
                </div>
            </div>
        `;
    }

    loadDiscordWidget();
    setInterval(loadDiscordWidget, 60000);
}
