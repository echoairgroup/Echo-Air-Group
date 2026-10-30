/* Shared navigation behavior matched to index.html. */
(() => {
    const siteHeader = document.getElementById("siteHeader");
    const mobileNav = document.getElementById("mobileNav");
    const menuButton = document.getElementById("menuButton");

    document.querySelectorAll('a[href="ranking.html"]').forEach((link) => {
        link.textContent = "Pilot Dashboard";
    });

    // Keep the Aviation Academy discoverable across the shared desktop, mobile and footer navigation.
    [document.querySelector(".navlinks"), mobileNav && mobileNav.querySelector(".container"), document.querySelector(".foot-links")].forEach((container) => {
        if (!container || container.querySelector('a[href="academy.html"]')) return;
        const link = document.createElement("a");
        link.href = "academy.html";
        link.textContent = "Aviation Academy";
        const dashboardLink = container.querySelector('a[href="ranking.html"]');
        if (dashboardLink) container.insertBefore(link, dashboardLink);
        else container.appendChild(link);
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

    if (mobileNav) {
        mobileNav.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", closeMenu);
        });
    }

    let previousScrollY = window.scrollY;
    function updateHeader() {
        if (!siteHeader) return;
        const currentScrollY = window.scrollY;
        siteHeader.classList.toggle("scrolled", currentScrollY > 10);
        siteHeader.classList.toggle(
            "hide-on-scroll",
            currentScrollY > previousScrollY && currentScrollY > 500
        );
        previousScrollY = currentScrollY;
    }
    window.addEventListener("scroll", updateHeader, { passive: true });
    updateHeader();
})();
