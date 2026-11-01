/* Shared Echo Air Group navigation and page-shell behavior. */
(() => {
    "use strict";

    const siteHeader = document.getElementById("siteHeader");
    const mobileNav = document.getElementById("mobileNav");
    const menuButton = document.getElementById("menuButton");
    const pageName = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();

    // Some older Discord-hosted logo URLs have expiring signatures.
    // Use a local brand mark when a signature has expired or the image fails.
    function useLocalBrandMark(image) {
        if (image.dataset.eagBrandFallback === "true") return;
        image.dataset.eagBrandFallback = "true";
        image.src = "brand-mark.svg";
        image.alt = "Echo Air Group logo";
    }

    document.querySelectorAll("#siteHeader .brand-logo, footer .brand-logo").forEach((image) => {
        let expired = false;

        try {
            const expiry = new URL(image.src, window.location.href).searchParams.get("ex");
            const expiryTime = expiry ? Number.parseInt(expiry, 16) * 1000 : NaN;
            expired = Number.isFinite(expiryTime) && expiryTime <= Date.now();
        } catch {
            // The error handler below remains the fallback for unparseable URLs.
        }

        if (expired) {
            useLocalBrandMark(image);
        } else {
            image.addEventListener("error", () => useLocalBrandMark(image), { once: true });
        }
    });

    const activePage = {
        "manager.html": "join.html",
        "pilot.html": "ranking.html",
        "server.html": "ranking.html"
    }[pageName] || pageName;

    // Homepage section links should work from every page.
    if (pageName !== "index.html") {
        document.querySelectorAll('a[href="#news"], a[href="#operations"], a[href="#faq"]').forEach((link) => {
            link.setAttribute("href", "index.html" + link.getAttribute("href"));
        });
    }

    // Keep desktop and mobile navigation in sync, including assistive technology.
    document.querySelectorAll("#siteHeader .navlinks a, #siteHeader #mobileNav a").forEach((link) => {
        const rawHref = link.getAttribute("href") || "";
        const pageHref = rawHref.split("#")[0];
        const targetPage = pageHref.split("/").pop().toLowerCase() || "index.html";
        const isActive = !rawHref.includes("#") && targetPage === activePage;

        link.classList.toggle("active", isActive);

        if (isActive) {
            link.setAttribute("aria-current", "page");
        } else {
            link.removeAttribute("aria-current");
        }
    });

    function closeMenu(restoreFocus = false) {
        if (mobileNav) mobileNav.classList.remove("open");

        if (menuButton) {
            menuButton.setAttribute("aria-expanded", "false");
            menuButton.setAttribute("aria-label", "Open navigation menu");
            menuButton.textContent = "☰";

            if (restoreFocus) menuButton.focus();
        }

        document.body.classList.remove("menu-open");
    }

    window.toggleMenu = function toggleMenu() {
        if (!mobileNav || !menuButton) return;

        const isOpen = mobileNav.classList.toggle("open");
        menuButton.setAttribute("aria-expanded", String(isOpen));
        menuButton.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
        menuButton.textContent = isOpen ? "×" : "☰";
        document.body.classList.toggle("menu-open", isOpen);
    };

    if (mobileNav) {
        mobileNav.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", () => closeMenu());
        });
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && mobileNav?.classList.contains("open")) {
            closeMenu(true);
        }
    });

    // Keep the navigation available while scrolling; never hide it on downward scroll.
    function updateHeader() {
        if (!siteHeader) return;
        siteHeader.classList.toggle("scrolled", window.scrollY > 10);
        siteHeader.classList.remove("hide-on-scroll");
    }

    window.addEventListener("scroll", updateHeader, { passive: true });
    window.addEventListener("resize", () => {
        if (window.innerWidth > 1320) closeMenu();
    }, { passive: true });
    updateHeader();

    // Load shared privacy controls only when they are not already present on the page.
    if (!document.querySelector('link[data-eag-cookie-styles], link[href$="cookie-consent.css"]')) {
        const consentStyles = document.createElement("link");
        consentStyles.rel = "stylesheet";
        consentStyles.href = "cookie-consent.css";
        consentStyles.dataset.eagCookieStyles = "true";
        document.head.appendChild(consentStyles);
    }

    if (!document.querySelector('script[data-eag-cookie-script], script[src$="cookie-consent.js"]')) {
        const consentScript = document.createElement("script");
        consentScript.src = "cookie-consent.js";
        consentScript.dataset.eagCookieScript = "true";
        document.body.appendChild(consentScript);
    }
})();
