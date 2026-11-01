/* Shared Echo Air Group navigation and page shell behavior.
   Header and footer markup are deliberately kept identical to index.html. */
(() => {
    "use strict";

    const siteHeader = document.getElementById("siteHeader");
    const mobileNav = document.getElementById("mobileNav");
    const menuButton = document.getElementById("menuButton");
    const pageName = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();

    // Keep the original homepage markup unchanged while highlighting the current page.
    const activePage = {
        "manager.html": "join.html",
        "pilot.html": "ranking.html",
        "server.html": "ranking.html"
    }[pageName] || pageName;

    document.querySelectorAll("#siteHeader .navlinks a").forEach((link) => {
        const href = (link.getAttribute("href") || "").split("#")[0];
        link.classList.toggle("active", href === activePage);
    });

    // Homepage section links must continue to work when clicked from inner pages.
    if (pageName !== "index.html") {
        document.querySelectorAll('a[href="#news"], a[href="#operations"], a[href="#faq"]').forEach((link) => {
            const section = link.getAttribute("href");
            link.setAttribute("href", "index.html" + section);
        });
    }

    function closeMenu() {
        if (mobileNav) mobileNav.classList.remove("open");
        if (menuButton) {
            menuButton.setAttribute("aria-expanded", "false");
            menuButton.textContent = "☰";
        }
        document.body.classList.remove("menu-open");
    }

    window.toggleMenu = function toggleMenu() {
        if (!mobileNav || !menuButton) return;
        const isOpen = mobileNav.classList.toggle("open");
        menuButton.setAttribute("aria-expanded", String(isOpen));
        menuButton.textContent = isOpen ? "×" : "☰";
        document.body.classList.toggle("menu-open", isOpen);
    };

    if (mobileNav) {
        mobileNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
    }

    let previousScrollY = window.scrollY;
    function updateHeader() {
        if (!siteHeader) return;
        const currentScrollY = window.scrollY;
        siteHeader.classList.toggle("scrolled", currentScrollY > 10);
        siteHeader.classList.toggle("hide-on-scroll", currentScrollY > previousScrollY && currentScrollY > 500);
        previousScrollY = currentScrollY;
    }
    window.addEventListener("scroll", updateHeader, { passive: true });
    updateHeader();

    // Load the shared privacy controls on every page that uses the site shell.
    if (!document.querySelector('link[data-eag-cookie-styles]')) {
        const consentStyles = document.createElement("link");
        consentStyles.rel = "stylesheet";
        consentStyles.href = "cookie-consent.css";
        consentStyles.dataset.eagCookieStyles = "true";
        document.head.appendChild(consentStyles);
    }
    if (!document.querySelector('script[data-eag-cookie-script]')) {
        const consentScript = document.createElement("script");
        consentScript.src = "cookie-consent.js";
        consentScript.dataset.eagCookieScript = "true";
        document.body.appendChild(consentScript);
    }
})();