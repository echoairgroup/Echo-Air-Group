
(() => {
  "use strict";
  const API = (window.ECHO_API_URL || "https://echo-air-group-api.onrender.com/api").replace(/\/$/, "");
  const root = document.getElementById("eagLiveStatus");
  if (!root) return;
  const labels = { backend:"Backend", database:"Database", discord:"Discord Bot", newsky:"NewSky" };
  const stateClass = value => value === "ok" ? "healthy" : value === "warning" ? "warning" : "error";
  const safe = value => String(value == null ? "" : value);
  function render(payload) {
    root.replaceChildren();
    const grid = document.createElement("div");
    grid.className = "eag-status-grid";
    Object.keys(labels).forEach(key => {
      const item = payload[key] || { status:"unknown", label:"Unknown" };
      const card = document.createElement("article");
      card.className = "eag-status-card";
      const top = document.createElement("div");
      top.className = "eag-status-top";
      const title = document.createElement("span");
      title.className = "eag-status-label";
      title.textContent = labels[key];
      const pill = document.createElement("span");
      pill.className = "eag-status-pill " + stateClass(item.status);
      pill.textContent = safe(item.label || "Unknown");
      top.append(title, pill);
      const detail = document.createElement("div");
      detail.className = "eag-status-detail";
      if (key === "newsky" && item.lastSync) detail.textContent = "Last successful sync: " + new Date(item.lastSync).toLocaleString();
      else if (item.detail) detail.textContent = item.detail;
      else if (key === "backend" && item.uptimeSeconds) detail.textContent = "Process uptime: " + Math.floor(item.uptimeSeconds / 3600) + "h " + Math.floor(item.uptimeSeconds % 3600 / 60) + "m";
      else detail.textContent = key === "discord" && item.status !== "ok" ? "The Discord bot is not currently connected." : "Live status from the Echo Air Group API.";
      card.append(top, detail);
      grid.appendChild(card);
    });
    const footer = document.createElement("div");
    footer.className = "eag-status-foot";
    const left = document.createElement("span");
    left.innerHTML = '<span class="eag-live-dot"></span> Live system check';
    const right = document.createElement("span");
    right.textContent = "Checked " + (payload.checkedAt ? new Date(payload.checkedAt).toLocaleTimeString() : "just now");
    footer.append(left, right);
    root.append(grid, footer);
  }
  async function load() {
    try {
      const response = await fetch(API + "/platform/status", { cache:"no-store", headers:{ Accept:"application/json" } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Status is unavailable.");
      render(data);
    } catch (error) {
      render({
        backend:{ status:"error", label:"Unavailable", detail:error.message },
        database:{ status:"warning", label:"Unknown" },
        discord:{ status:"warning", label:"Unknown" },
        newsky:{ status:"warning", label:"Unknown" },
        checkedAt:new Date().toISOString()
      });
    }
  }
  load();
  window.setInterval(load, 60000);
})();
