/* Shared navigation behavior matched to the Echo Air Group site shell. */
(() => {
    "use strict";
    const siteHeader = document.getElementById("siteHeader");
    const mobileNav = document.getElementById("mobileNav");
    const menuButton = document.getElementById("menuButton");
    const pageName = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();

    // Inserted after Routes; reverse order keeps the resulting navigation intuitive.
    const sharedLinks = [
        { href: "academy.html", label: "Aviation Academy", active: ["academy.html"] },
        { href: "community.html", label: "Community", active: ["community.html"] },
        { href: "operations-center.html", label: "Operations", active: ["operations-center.html"] }
    ];

    [document.querySelector(".navlinks"), mobileNav && mobileNav.querySelector(".container"), document.querySelector(".foot-links")].forEach((container) => {
        if (!container) return;
        sharedLinks.forEach((item) => {
            let link = container.querySelector('a[href="' + item.href + '"]');
            if (!link) {
                link = document.createElement("a");
                link.href = item.href;
                link.textContent = item.label;
                const routesLink = container.querySelector('a[href="routes.html"]');
                const teamLink = container.querySelector('a[href="team.html"]');
                if (routesLink && routesLink.parentNode === container) routesLink.after(link);
                else if (teamLink && teamLink.parentNode === container) container.insertBefore(link, teamLink);
                else container.appendChild(link);
            }
            if (item.active.includes(pageName) && container.classList.contains("navlinks")) link.classList.add("active");
        });
    });

    document.querySelectorAll('a[href="ranking.html"]').forEach((link) => {
        link.textContent = "Pilot Dashboard";
    });

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

    if (mobileNav) mobileNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));

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
})();

/* Shared brand image: use the current public Google-hosted logo. */
(() => {
    const logoUrl = "https://lh3.googleusercontent.com/d/1pPTawjq1pNmovHej7om3OaZUZgRXScBQ=w1920-h913";

    document.querySelectorAll(".brand-logo").forEach((image) => {
        if (image.dataset.eagLogoReady === "true") return;
        image.dataset.eagLogoReady = "true";
        image.alt = "Echo Air Group logo";
        image.style.width = "auto";
        image.style.height = "58px";
        image.style.maxWidth = "min(230px, 34vw)";
        image.style.display = "block";
        image.style.objectFit = "contain";
        image.style.objectPosition = "left center";
        image.style.borderRadius = "0";

        image.addEventListener("error", () => {
            if (image.dataset.eagLogoFallback === "true") return;
            image.dataset.eagLogoFallback = "true";
            image.src = "brand-mark.svg";
            image.style.width = "58px";
            image.style.height = "58px";
            image.style.maxWidth = "58px";
        }, { once: true });

        image.src = logoUrl;
    });
})();
