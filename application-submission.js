/* Echo Air Group application intake — Forminit delivery + private dashboard copy. */
(() => {
  "use strict";
  const API_BASE = "https://echo-air-group-api.onrender.com/api";
  const FORM_ID = "lzhwmmwkoq5";
  let sdkPromise = null;

  function loadForminit() {
    if (window.Forminit) return Promise.resolve();
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://forminit.com/sdk/v1/forminit.js";
      script.async = true;
      script.onload = () => window.Forminit ? resolve() : reject(new Error("Forminit loaded without its browser SDK."));
      script.onerror = () => reject(new Error("The Forminit service could not be loaded. Please try again."));
      document.head.appendChild(script);
    });
    return sdkPromise;
  }

  function camelCase(value) {
    const words = String(value || "").replace(/[_-]+/g, " ").replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
    return words.map((word, index) => index === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1)).join("") || "field";
  }

  function formElement(form, name) {
    const field = form.elements.namedItem(name);
    if (field instanceof RadioNodeList) return field.length ? field[0] : null;
    return field || null;
  }

  function forminitFieldName(form, name) {
    const normalized = String(name).toLowerCase().replace(/[_-]+/g, " ").trim();
    if (/^first name$/.test(normalized)) return "fi-sender-firstName";
    if (/^last name$/.test(normalized)) return "fi-sender-lastName";
    if (normalized === "email" || normalized === "email address" || normalized.endsWith(" email")) return "fi-sender-email";

    const element = formElement(form, name);
    const type = String(element && (element.type || element.tagName) || "text").toLowerCase();
    const slug = camelCase(name);
    if (type === "radio") return "fi-radio-" + slug;
    if (type === "checkbox") return "fi-checkbox-" + slug;
    if (type === "select-one" || type === "select-multiple") return "fi-select-" + slug;
    if (type === "number") return "fi-number-" + slug;
    if (type === "range") return "fi-rating-" + slug;
    if (type === "date") return "fi-date-" + slug;
    if (type === "tel") return "fi-phone-" + slug;
    if (type === "url") return "fi-url-" + slug;
    if (type === "email") return "fi-email-" + slug;
    return "fi-text-" + slug;
  }

  function createForminitData(form, sourceData, answers) {
    const result = new FormData();
    for (const [key, value] of sourceData.entries()) {
      if (!key || key.startsWith("_") || key.toLowerCase() === "website" || value instanceof File) continue;
      const targetName = forminitFieldName(form, key);
      result.append(targetName, String(value).trim());
    }
    result.append("fi-text-applicationType", form.dataset.applicationType || "pilot");
    result.append("fi-text-source", "Echo Air Group Website");
    return result;
  }

  async function saveDashboardCopy(form, answers, trap) {
    const response = await fetch(API_BASE + "/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        applicationType: form.dataset.applicationType,
        answers,
        website: trap
      })
    });
    if (!response.ok) {
      let payload = {};
      try { payload = await response.json(); } catch (_) {}
      throw new Error(payload.error || "The private application inbox could not be updated.");
    }
    return true;
  }

  document.querySelectorAll("form[data-application-type]").forEach(form => {
    if (form.dataset.applicationIntakeBound === "true") return;
    form.dataset.applicationIntakeBound = "true";

    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (form.dataset.submitting === "true" || form.dataset.submitted === "true") return;

      const sourceData = new FormData(form);
      const trap = String(sourceData.get("website") || "").trim();
      const status = form.querySelector("[data-application-status]");
      const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');

      if (trap) {
        if (status) status.textContent = "Thank you. Your application has been received.";
        return;
      }

      const answers = {};
      for (const [key, value] of sourceData.entries()) {
        if (!key || key.startsWith("_") || key.toLowerCase() === "website" || value instanceof File) continue;
        answers[key] = String(value).trim();
      }

      form.dataset.submitting = "true";
      if (submitButton) submitButton.disabled = true;
      if (status) status.textContent = "Submitting your application…";

      try {
        await loadForminit();
        const client = new window.Forminit();
        const formData = createForminitData(form, sourceData, answers);
        const submission = await client.submit(FORM_ID, formData);
        if (submission && submission.error) throw new Error(submission.error.message || "Forminit rejected the application.");
        if (!submission || !submission.data) throw new Error("Forminit did not confirm receipt. Please try again.");

        let dashboardSaved = false;
        try {
          await saveDashboardCopy(form, answers, trap);
          dashboardSaved = true;
        } catch (error) {
          console.warn("Forminit received the application, but the private Echo inbox copy failed:", error);
        }

        form.dataset.submitted = "true";
        if (status) status.textContent = dashboardSaved
          ? "Your application has been submitted successfully. The Echo Air Group team has been notified."
          : "Your application was sent successfully. The private dashboard copy could not be saved; the team has still received your submission.";
        if (form.reset) form.reset();
      } catch (error) {
        console.error("Application submission failed:", error);
        if (status) status.textContent = "We could not send your application: " + error.message + " Please try again.";
        form.dataset.submitting = "false";
      } finally {
        if (submitButton) submitButton.disabled = form.dataset.submitted === "true";
      }
    });
  });
})();