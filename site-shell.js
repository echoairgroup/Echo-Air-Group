/* Shared Echo Air Group navigation and page-shell behavior. */
(() => {
    "use strict";

    const siteHeader = document.getElementById("siteHeader");
    const mobileNav = document.getElementById("mobileNav");
    const menuButton = document.getElementById("menuButton");
    const pageName = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();

    // Use the logo file supplied by the site owner. Do not silently replace it
    // with the old placeholder mark when a remote image host has a transient error.
    const primaryBrandLogo = "https://lh3.googleusercontent.com/d/1pPTawjq1pNmovHej7om3OaZUZgRXScBQ=w1920-h913&v=20261101-5";
    const alternateBrandLogos = [
        "https://lh3.google.com/u/0/d/1pPTawjq1pNmovHej7om3OaZUZgRXScBQ=w1920-h913-iv1?auditContext=prefetch",
        "https://drive.google.com/uc?export=view&id=1pPTawjq1pNmovHej7om3OaZUZgRXScBQ"
    ];

    document.querySelectorAll("#siteHeader .brand-logo, footer .brand-logo").forEach((image) => {
        image.alt = "Echo Air Group logo";
        image.hidden = false;
        if (image.dataset.eagBrandManaged === "true") return;
        image.dataset.eagBrandManaged = "true";

        let alternateIndex = 0;
        image.addEventListener("error", () => {
            if (alternateIndex < alternateBrandLogos.length) {
                image.src = alternateBrandLogos[alternateIndex++];
            } else {
                // Keep the brand name text visible, but never show the obsolete placeholder logo.
                image.hidden = true;
            }
        });

        image.src = primaryBrandLogo;
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


/* Keep the browser-tab icon aligned with the supplied Echo Air Group logo. */
(() => {
    const faviconUrl = "https://lh3.googleusercontent.com/d/1pPTawjq1pNmovHej7om3OaZUZgRXScBQ=w192-h192&v=20261101-5";

    document.querySelectorAll('link[data-eag-favicon-fallback="true"]').forEach((link) => link.remove());
    document.querySelectorAll('link[rel~="icon"][type="image/svg+xml"]').forEach((link) => link.remove());

    let primary = document.querySelector('link[data-eag-favicon-primary="true"]');
    if (!primary) {
        primary = document.querySelector('link[rel~="icon"]') || document.createElement("link");
        primary.rel = "icon";
        primary.dataset.eagFaviconPrimary = "true";
        document.head.appendChild(primary);
    }
    primary.href = faviconUrl;
})();
