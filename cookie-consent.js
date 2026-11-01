/* Echo Air Group — understated cookie and browser-storage preferences. */
(() => {
    "use strict";

    if (window.EAGCookieConsent) return;

    const API_BASE = (window.ECHO_API_URL || "https://echo-air-group-api.onrender.com/api").replace(/\/$/, "");
    const CONSENT_KEY = "eag_cookie_consent";
    const VISITOR_KEY = "eag_cookie_visitor_id";
    const PENDING_KEY = "eag_cookie_sync_pending";
    const POLICY_VERSION = "2026-11-01";

    function createUuid() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
            const random = Math.random() * 16 | 0;
            return (character === "x" ? random : (random & 3 | 8)).toString(16);
        });
    }

    function visitorId() {
        let value = "";
        try { value = localStorage.getItem(VISITOR_KEY) || ""; } catch (_) {}
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
            value = createUuid();
            try { localStorage.setItem(VISITOR_KEY, value); } catch (_) {}
        }
        return value;
    }

    function readConsent() {
        try {
            const value = JSON.parse(localStorage.getItem(CONSENT_KEY) || "null");
            return value && value.version === POLICY_VERSION ? value : null;
        } catch (_) {
            return null;
        }
    }

    function appendStyles() {
        if (document.querySelector('link[data-eag-cookie-styles]')) return;
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "cookie-consent.css";
        link.dataset.eagCookieStyles = "true";
        document.head.appendChild(link);
    }

    function appendFooterLinks() {
        const footerLinks = document.querySelector(".foot-links");
        if (!footerLinks) return;
        [
            { href: "privacy.html", label: "Privacy Policy" },
            { href: "cookies.html", label: "Cookie Policy" }
        ].forEach(item => {
            if (footerLinks.querySelector('a[href="' + item.href + '"]')) return;
            const link = document.createElement("a");
            link.href = item.href;
            link.textContent = item.label;
            footerLinks.appendChild(link);
        });

        if (!footerLinks.querySelector("[data-eag-cookie-settings]")) {
            const settingsLink = document.createElement("a");
            settingsLink.href = "#cookie-settings";
            settingsLink.textContent = "Cookie Settings";
            settingsLink.setAttribute("data-eag-cookie-settings", "");
            footerLinks.appendChild(settingsLink);
        }
    }

    function syncToServer(consent) {
        const headers = { "Content-Type": "application/json", "Accept": "application/json" };
        let token = "";
        try { token = localStorage.getItem("echo_token") || ""; } catch (_) {}
        if (token) headers.Authorization = "Bearer " + token;

        return fetch(API_BASE + "/cookie-consent", {
            method: "POST",
            headers,
            cache: "no-store",
            body: JSON.stringify({
                visitorId: visitorId(),
                choice: consent.choice,
                categories: {
                    analytics: consent.analytics === true,
                    marketing: consent.marketing === true
                }
            })
        }).then(response => {
            if (!response.ok) throw new Error("Consent record could not be synchronized.");
            try { localStorage.removeItem(PENDING_KEY); } catch (_) {}
            return true;
        }).catch(() => false);
    }

    function storeConsent(choice, analytics, marketing) {
        const consent = {
            version: POLICY_VERSION,
            choice,
            analytics: analytics === true,
            marketing: marketing === true,
            savedAt: new Date().toISOString()
        };
        try {
            localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
            localStorage.setItem(PENDING_KEY, "1");
        } catch (_) {
            // The interface still closes if browser storage is disabled; the
            // preference cannot persist in that browser session.
        }
        void syncToServer(consent);
        return consent;
    }

    function buildInterface() {
        const banner = document.createElement("aside");
        banner.id = "eagCookieBanner";
        banner.className = "eag-cookie-banner";
        banner.setAttribute("aria-label", "Cookie preferences");
        banner.innerHTML = `
            <div class="eag-cookie-copy">
                <span class="eag-cookie-eyebrow">Your privacy matters</span>
                <strong>Cookie preferences</strong>
                <p>Echo Air Group uses essential browser storage for sign-in and core features. Optional analytics and advertising cookies are currently not active. You can accept or reject optional technologies, or review your choices.</p>
                <p class="eag-cookie-links"><a href="privacy.html">Privacy Policy</a><span aria-hidden="true">·</span><a href="cookies.html">Cookie Policy</a></p>
            </div>
            <div class="eag-cookie-actions">
                <button type="button" class="eag-cookie-button eag-cookie-primary" data-cookie-action="accept">Accept all</button>
                <button type="button" class="eag-cookie-button eag-cookie-secondary" data-cookie-action="reject">Reject optional</button>
                <button type="button" class="eag-cookie-text-button" data-cookie-action="settings">Customise</button>
            </div>`;

        const backdrop = document.createElement("div");
        backdrop.id = "eagCookieSettings";
        backdrop.className = "eag-cookie-backdrop";
        backdrop.hidden = true;
        backdrop.innerHTML = `
            <section class="eag-cookie-dialog" role="dialog" aria-modal="true" aria-labelledby="eagCookieDialogTitle">
                <div class="eag-cookie-dialog-heading">
                    <div><span class="eag-cookie-eyebrow">Echo Air Group</span><h2 id="eagCookieDialogTitle">Privacy &amp; cookie settings</h2></div>
                    <button type="button" class="eag-cookie-close" aria-label="Close settings" data-cookie-action="close">×</button>
                </div>
                <p class="eag-cookie-dialog-intro">Choose which optional technologies you allow. Essential browser storage is always enabled because it is required for account sign-in, security and features you request.</p>
                <div class="eag-cookie-category">
                    <div><strong>Essential storage</strong><p>Account sign-in, security and remembering this choice. Always active.</p></div>
                    <span class="eag-cookie-always">Always active</span>
                </div>
                <label class="eag-cookie-category">
                    <span><strong>Analytics</strong><p>Would allow anonymous or aggregated measurement to improve the website. No analytics service is currently active.</p></span>
                    <input id="eagCookieAnalytics" type="checkbox">
                </label>
                <label class="eag-cookie-category">
                    <span><strong>Advertising &amp; marketing</strong><p>Would allow marketing or advertising technologies. No advertising or marketing trackers are currently active.</p></span>
                    <input id="eagCookieMarketing" type="checkbox">
                </label>
                <p class="eag-cookie-note">Your choice is saved with a random browser reference and, only when you are signed in, your Echo username. We do not store your IP address in the consent record. Read the <a href="cookies.html">Cookie Policy</a> for details.</p>
                <div class="eag-cookie-dialog-actions">
                    <button type="button" class="eag-cookie-button eag-cookie-secondary" data-cookie-action="reject">Reject optional</button>
                    <button type="button" class="eag-cookie-button eag-cookie-primary" data-cookie-action="save">Save preferences</button>
                </div>
            </section>`;

        document.body.append(banner, backdrop);
        return { banner, backdrop };
    }

    appendStyles();
    appendFooterLinks();
    const ui = buildInterface();
    const analyticsInput = document.getElementById("eagCookieAnalytics");
    const marketingInput = document.getElementById("eagCookieMarketing");

    function showBanner() {
        ui.banner.classList.add("is-visible");
    }

    function hideBanner() {
        ui.banner.classList.remove("is-visible");
    }

    let lastActiveElement = null;

    function openSettings() {
        lastActiveElement = document.activeElement;
        const current = readConsent();
        analyticsInput.checked = Boolean(current && current.analytics);
        marketingInput.checked = Boolean(current && current.marketing);
        ui.backdrop.hidden = false;
        document.body.classList.add("eag-cookie-dialog-open");
        const closeButton = ui.backdrop.querySelector("[data-cookie-action='close']");
        if (closeButton) closeButton.focus();
    }

    function closeSettings() {
        ui.backdrop.hidden = true;
        document.body.classList.remove("eag-cookie-dialog-open");
        if (lastActiveElement && typeof lastActiveElement.focus === "function") {
            lastActiveElement.focus({ preventScroll: true });
        }
        lastActiveElement = null;
    }

    function save(choice, analytics, marketing) {
        storeConsent(choice, analytics, marketing);
        hideBanner();
        closeSettings();
    }

    function handleAction(action) {
        if (action === "accept") save("accepted", true, true);
        if (action === "reject") save("rejected", false, false);
        if (action === "settings") openSettings();
        if (action === "close") closeSettings();
        if (action === "save") {
            const analytics = analyticsInput.checked;
            const marketing = marketingInput.checked;
            save("custom", analytics, marketing);
        }
    }

    document.addEventListener("click", event => {
        const actionButton = event.target.closest("[data-cookie-action]");
        if (actionButton) {
            handleAction(actionButton.dataset.cookieAction);
            return;
        }
        if (event.target.closest("[data-eag-cookie-settings]")) {
            event.preventDefault();
            openSettings();
            return;
        }
        if (event.target === ui.backdrop) closeSettings();
    });

    document.addEventListener("keydown", event => {
        if (ui.backdrop.hidden) return;
        if (event.key === "Escape") {
            closeSettings();
            return;
        }
        if (event.key === "Tab") {
            const focusable = Array.from(ui.backdrop.querySelectorAll("button, input, a[href]"))
                .filter(element => !element.disabled && element.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });

    const existing = readConsent();
    if (existing) {
        let pending = false;
        try { pending = localStorage.getItem(PENDING_KEY) === "1"; } catch (_) {}
        if (pending) void syncToServer(existing);
    } else {
        showBanner();
    }

    window.EAGCookieConsent = {
        hasConsent(category) {
            if (category === "essential") return true;
            const current = readConsent();
            if (!current) return false;
            if (category === "analytics") return current.analytics === true;
            if (category === "marketing") return current.marketing === true;
            return false;
        },
        openSettings,
        getPreferences: readConsent
    };
})();
