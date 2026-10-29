/* Public website content loaded from the Echo Air Group API. */
(() => {
    "use strict";

    const API_BASE = "https://echo-air-group-api.onrender.com/api";
    const pageName = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();

    function updateDiscordLinks(invite) {
        if (!invite) return;

        document.querySelectorAll("a[href]").forEach((anchor) => {
            try {
                const url = new URL(anchor.getAttribute("href"), window.location.href);
                const isInvite =
                    (url.hostname === "discord.gg" || url.hostname === "www.discord.gg") ||
                    ((url.hostname === "discord.com" || url.hostname === "www.discord.com") &&
                        url.pathname.startsWith("/invite/"));

                if (isInvite) anchor.href = invite;
            } catch {
                // Keep unrelated or malformed links unchanged.
            }
        });

        document.querySelectorAll('img[src*="api.qrserver.com/v1/create-qr-code"]').forEach((img) => {
            try {
                const url = new URL(img.src);
                url.searchParams.set("data", invite);
                img.src = url.toString();
            } catch {
                // Leave an image unchanged if its QR URL cannot be parsed.
            }
        });
    }

    function safeHref(value) {
        const raw = String(value || "").trim();
        if (!raw) return null;

        try {
            if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
                const url = new URL(raw);
                return ["https:", "http:"].includes(url.protocol) ? url.href : null;
            }

            if (raw.startsWith("//")) return null;
            return raw;
        } catch {
            return null;
        }
    }

    function makeItemCard(item) {
        const card = document.createElement("article");
        card.className = "site-added-card";

        if (item.image_url) {
            const image = document.createElement("img");
            image.className = "site-added-image";
            image.src = /^https?:\/\//i.test(item.image_url)
                ? item.image_url
                : API_BASE.replace(/\/api$/, "") + item.image_url;
            image.alt = item.title ? String(item.title) : "Website item";
            image.loading = "lazy";
            image.addEventListener("error", () => image.classList.add("site-added-image-error"), { once: true });
            card.appendChild(image);
        }

        const body = document.createElement("div");
        body.className = "site-added-card-body";

        const category = document.createElement("span");
        category.className = "site-added-category";
        category.textContent = String(item.category || "Update").replace(/[-_]/g, " ");
        body.appendChild(category);

        const title = document.createElement("h3");
        title.textContent = String(item.title || "Website item");
        body.appendChild(title);

        if (item.description) {
            const description = document.createElement("p");
            description.textContent = String(item.description);
            body.appendChild(description);
        }

        const href = safeHref(item.link_url);
        if (href) {
            const link = document.createElement("a");
            link.className = "site-added-link";
            link.href = href;
            link.textContent = "Learn more";
            if (/^https?:\/\//i.test(href) && new URL(href, window.location.href).origin !== window.location.origin) {
                link.target = "_blank";
                link.rel = "noopener noreferrer";
            }
            body.appendChild(link);
        }

        card.appendChild(body);
        return card;
    }

    async function loadPublicSettings() {
        try {
            const response = await fetch(API_BASE + "/site/settings", { cache: "no-store" });
            if (!response.ok) return;
            const settings = await response.json();
            if (settings && settings.discordInvite) updateDiscordLinks(settings.discordInvite);
        } catch {
            // Keep existing invite links if the API is temporarily unavailable.
        }
    }

    async function loadPublicItems() {
        if (pageName === "admin.html") return;

        try {
            const response = await fetch(
                API_BASE + "/site/items?page=" + encodeURIComponent(pageName),
                { cache: "no-store" }
            );
            if (!response.ok) return;

            const payload = await response.json();
            const items = Array.isArray(payload.items) ? payload.items : [];
            if (!items.length) return;

            const section = document.createElement("section");
            section.className = "site-added-items";
            section.setAttribute("aria-label", "Website updates");

            const container = document.createElement("div");
            container.className = "site-added-container";

            const heading = document.createElement("div");
            heading.className = "site-added-heading";

            const eyebrow = document.createElement("span");
            eyebrow.className = "site-added-eyebrow";
            eyebrow.textContent = "ECHO AIR GROUP";

            const title = document.createElement("h2");
            title.textContent = "More to discover";

            const subtitle = document.createElement("p");
            subtitle.textContent = "Updates, highlights and additions from our team.";

            heading.append(eyebrow, title, subtitle);

            const grid = document.createElement("div");
            grid.className = "site-added-grid";
            items.forEach((item) => grid.appendChild(makeItemCard(item)));

            container.append(heading, grid);
            section.appendChild(container);

            const footer = document.querySelector("footer");
            if (footer && footer.parentNode) {
                footer.parentNode.insertBefore(section, footer);
            } else {
                document.body.appendChild(section);
            }

            updateDiscordLinksFromCurrentSettings();
        } catch {
            // The original website remains usable when no items are configured.
        }
    }

    let currentInvite = null;
    function updateDiscordLinksFromCurrentSettings() {
        if (currentInvite) updateDiscordLinks(currentInvite);
    }

    loadPublicSettings().then(async () => {
        try {
            const response = await fetch(API_BASE + "/site/settings", { cache: "no-store" });
            if (response.ok) {
                const settings = await response.json();
                currentInvite = settings.discordInvite || null;
            }
        } catch {
            currentInvite = null;
        }
        await loadPublicItems();
    });
})();
