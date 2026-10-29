/* Echo Air Group application intake
   Save a private admin copy first, then continue to FormSubmit for email delivery.
   If the API is temporarily unavailable, FormSubmit remains the fallback. */
(() => {
    "use strict";

    const API_BASE = "https://echo-air-group-api.onrender.com/api";

    document.querySelectorAll("form[data-application-type]").forEach((form) => {
        if (form.dataset.applicationIntakeBound === "true") return;
        form.dataset.applicationIntakeBound = "true";

        form.addEventListener("submit", async (event) => {
            if (form.dataset.submitting === "true") {
                event.preventDefault();
                return;
            }

            const data = new FormData(form);
            const trap = String(data.get("website") || "").trim();
            const status = form.querySelector("[data-application-status]");
            const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');

            // Simple bots are quietly stopped by the hidden honeypot field.
            if (trap) {
                event.preventDefault();
                if (status) status.textContent = "Thank you. Your application has been received.";
                return;
            }

            event.preventDefault();
            form.dataset.submitting = "true";
            if (submitButton) submitButton.disabled = true;
            if (status) status.textContent = "Submitting your application…";

            const answers = {};
            for (const [key, value] of data.entries()) {
                if (!key || key.startsWith("_") || key.toLowerCase() === "website" || value instanceof File) continue;
                answers[key] = String(value).trim();
            }

            let saved = false;
            try {
                const response = await fetch(API_BASE + "/applications", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Accept": "application/json" },
                    body: JSON.stringify({
                        applicationType: form.dataset.applicationType,
                        answers,
                        website: trap
                    })
                });
                saved = response.ok;
            } catch (error) {
                console.warn("Application tracker unavailable; continuing with FormSubmit email delivery.", error);
            }

            if (status) {
                status.textContent = saved
                    ? "Application received. Sending the email confirmation…"
                    : "The tracking dashboard is temporarily unavailable. Your application will still be emailed to the team.";
            }

            // Preserve the existing FormSubmit workflow and email notification.
            // Calling the native method bypasses this submit listener.
            HTMLFormElement.prototype.submit.call(form);
        });
    });
})();
