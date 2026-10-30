
(() => {
  "use strict";
  const API = (window.ECHO_API_URL || "https://echo-air-group-api.onrender.com/api").replace(/\/$/, "");
  const root = document.getElementById("eagNewskyFleet");
  if (!root) return;
  const fmtDate = value => {
    if (!value) return "No recorded flight";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
  };
  function node(tag, className, value) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined) el.textContent = String(value);
    return el;
  }
  async function photo(registration, card) {
    if (!registration || !card || card.dataset.photoRequested === "true") return;
    card.dataset.photoRequested = "true";
    try {
      const response = await fetch(API + "/platform/fleet/" + encodeURIComponent(registration) + "/photo", { cache:"force-cache" });
      if (!response.ok) return;
      const photoData = await response.json();
      if (!photoData.thumbnail || !photoData.photoUrl) return;
      const frame = card.querySelector(".eag-aircraft-photo");
      if (!frame) return;
      const image = document.createElement("img");
      image.src = photoData.thumbnail;
      image.alt = "Aircraft " + registration;
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      frame.replaceChildren(image);
      const credit = node("span", "eag-photo-credit", "Photo: " + (photoData.photographer || "Photographer"));
      const link = document.createElement("a");
      link.href = photoData.photoUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = " · Planespotters";
      credit.appendChild(link);
      card.querySelector(".eag-aircraft-foot")?.appendChild(credit);
    } catch (_) {}
  }
  function render(data) {
    root.replaceChildren();
    const totals = node("div", "eag-platform-counts");
    [
      data.totals?.aircraftObserved + " aircraft observed",
      data.totals?.active30d + " flown in last 30 days",
      data.totals?.noFlights30d + " without 30-day activity",
      data.totals?.registrationsKnown + " registrations identified"
    ].forEach(value => totals.appendChild(node("span", "eag-count-chip", value)));
    const grid = node("div", "eag-fleet-grid");
    const aircraft = Array.isArray(data.aircraft) ? data.aircraft : [];
    if (!aircraft.length) {
      root.append(totals, node("div", "eag-empty-state", "No aircraft have been identified in the imported NewSky flight history yet."));
      return;
    }
    aircraft.forEach(item => {
      const card = node("article", "eag-aircraft-card");
      const frame = node("div", "eag-aircraft-photo");
      frame.appendChild(node("span", "eag-aircraft-placeholder", item.registration || "EAG"));
      const body = node("div", "eag-aircraft-content");
      body.append(
        node("div", "eag-aircraft-reg", item.registration || "Registration unavailable"),
        node("div", "eag-aircraft-name", item.name || "Aircraft name not supplied"),
      );
      const meta = node("div", "eag-aircraft-meta");
      [
        ["Aircraft type", item.aircraftType || "Not supplied"],
        ["Home base*", item.homeBase || "Not determined"],
        ["Flights · total", item.totalFlights || 0],
        ["Flights · 30 days", item.flights30d || 0]
      ].forEach(([label, value]) => {
        const cell = node("div");
        cell.append(node("small", "", label), node("strong", "", value));
        meta.appendChild(cell);
      });
      const foot = node("div", "eag-aircraft-foot");
      const active = node("span", "eag-status-pill " + (item.status === "active" ? "healthy" : "warning"), item.statusLabel || "Unknown");
      const last = node("span", "", "Last flown " + fmtDate(item.lastFlightAt));
      foot.append(active, last);
      body.append(meta, foot);
      card.append(frame, body);
      card.dataset.registration = item.registration || "";
      grid.appendChild(card);
    });
    root.append(totals, grid, node("p", "eag-map-note", "Automatically generated from imported NewSky flight records. *Home base is inferred from the most frequent departure airport in the last 180 days. Aircraft not present in imported flight history cannot be detected automatically."));
    const cards = Array.from(grid.querySelectorAll(".eag-aircraft-card[data-registration]")).filter(card => card.dataset.registration);
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) {
          observer.unobserve(entry.target);
          photo(entry.target.dataset.registration, entry.target);
        }
      }), { rootMargin:"180px" });
      cards.forEach(card => observer.observe(card));
    } else {
      cards.slice(0, 8).forEach(card => photo(card.dataset.registration, card));
    }
  }
  async function load() {
    root.replaceChildren(node("div", "eag-empty-state", "Loading aircraft from NewSky flight history…"));
    try {
      const response = await fetch(API + "/platform/fleet", { cache:"no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load fleet.");
      render(data);
    } catch (error) {
      root.replaceChildren(node("div", "eag-load-error", error.message));
    }
  }
  load();
})();
