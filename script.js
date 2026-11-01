
function toggleMenu(){document.getElementById('mobileNav')?.classList.toggle('open')}
function filterRoutes(type){document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x.dataset.filter===type));document.querySelectorAll('.route-row[data-type]').forEach(x=>x.style.display=(type==='all'||x.dataset.type===type)?'grid':'none')}
function showLang(lang){document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.lang===lang));document.querySelectorAll('.lang-panel').forEach(x=>x.style.display=x.dataset.lang===lang?'block':'none')}
function submitApplication(e){e.preventDefault();document.querySelector('.success').style.display='block';e.target.reset()}


/* Shared brand image: use the public Google-hosted logo and a local fallback. */
(() => {
    const logoUrl = "https://lh3.googleusercontent.com/d/1pPTawjq1pNmovHej7om3OaZUZgRXScBQ=w1920-h913";

    document.querySelectorAll(".brand-logo").forEach((image) => {
        image.alt = "Echo Air Group logo";
        image.style.width = "auto";
        image.style.height = "58px";
        image.style.maxWidth = "min(230px, 34vw)";
        image.style.display = "block";
        image.style.objectFit = "contain";
        image.style.objectPosition = "left center";
        image.style.borderRadius = "0";

        if (image.dataset.eagLogoFallbackBound !== "true") {
            image.dataset.eagLogoFallbackBound = "true";
            image.addEventListener("error", () => {
                if (image.dataset.eagLogoFallback === "true") return;
                image.dataset.eagLogoFallback = "true";
                image.src = "brand-mark.svg";
                image.style.width = "58px";
                image.style.height = "58px";
                image.style.maxWidth = "58px";
            }, { once: true });
        }

        if (image.src !== logoUrl) image.src = logoUrl;
    });
})();
