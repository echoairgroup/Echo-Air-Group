
(() => {
  "use strict";
  const API = (window.ECHO_API_URL || "https://echo-air-group-api.onrender.com/api").replace(/\/$/, "");
  const root = document.getElementById("eagFlownRoutes");
  if (!root) return;
  let map = null;
  let airportDataPromise = null;
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.L) return resolve();
      const existing = document.querySelector('script[data-leaflet="true"]');
      if (existing) { existing.addEventListener("load", resolve, { once:true }); existing.addEventListener("error", reject, { once:true }); return; }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.leaflet = "true";
      script.onload = resolve;
      script.onerror = () => reject(new Error("The map library could not be loaded."));
      document.head.appendChild(script);
    });
  }
  function parseCsvLine(line) {
    const result = [];
    let current = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && quoted && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { result.push(current); current = ""; }
      else current += ch;
    }
    result.push(current);
    return result;
  }
  function loadAirports() {
    if (airportDataPromise) return airportDataPromise;
    airportDataPromise = fetch("https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat", { cache:"force-cache" })
      .then(response => { if (!response.ok) throw new Error("Airport coordinate data is unavailable."); return response.text(); })
      .then(text => {
        const airports = new Map();
        text.split(/\r?\n/).forEach(line => {
          if (!line.trim()) return;
          const fields = parseCsvLine(line);
          const icao = String(fields[5] || "").trim().toUpperCase();
          const lat = Number(fields[6]), lon = Number(fields[7]);
          if (icao && icao !== "\\N" && Number.isFinite(lat) && Number.isFinite(lon)) airports.set(icao, { lat, lon });
        });
        return airports;
      });
    return airportDataPromise;
  }
  function makeNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function renderList(data) {
    const routes = new Map();
    data.flights.forEach(flight => {
      const key = flight.departure + "-" + flight.arrival;
      let item = routes.get(key);
      if (!item) item = { departure:flight.departure, arrival:flight.arrival, count:0, pilots:new Set(), aircraft:new Set(), latest:null };
      item.count++;
      if (flight.pilot) item.pilots.add(flight.pilot);
      if (flight.aircraft) item.aircraft.add(flight.aircraft);
      if (!item.latest || new Date(flight.date) > new Date(item.latest)) item.latest = flight.date;
      routes.set(key,item);
    });
    const summary = makeNode("div","eag-platform-counts");
    [
      data.count + " recorded flights",
      routes.size + " different routes",
      data.days + " day window"
    ].forEach(value => summary.appendChild(makeNode("span","eag-count-chip",value)));
    const list = makeNode("div","eag-routes-list");
    Array.from(routes.values()).sort((a,b)=>b.count-a.count).forEach(route => {
      const card = makeNode("article","eag-route-card");
      card.appendChild(makeNode("div","eag-route-title",route.departure + " → " + route.arrival));
      const meta = makeNode("div","eag-route-meta");
      meta.append(
        makeNode("span","",route.count + " flight(s)"),
        makeNode("span","",route.pilots.size + " pilot(s)"),
        makeNode("span","", "Last flown " + new Date(route.latest).toLocaleDateString("en-GB"))
      );
      card.appendChild(meta);
      list.appendChild(card);
    });
    const tableWrap = makeNode("div","eag-flight-table-wrap");
    const table = makeNode("table","eag-flight-table");
    const thead = makeNode("thead"), header = makeNode("tr");
    ["Date","Pilot","Route","Aircraft","Distance"].forEach(label => header.appendChild(makeNode("th","",label)));
    thead.appendChild(header);
    const tbody = makeNode("tbody");
    data.flights.forEach(flight => {
      const row = makeNode("tr");
      [
        flight.date ? new Date(flight.date).toLocaleDateString("en-GB") : "—",
        flight.pilot,
        flight.departure + " → " + flight.arrival,
        flight.registration ? flight.registration + " · " + flight.aircraft : flight.aircraft,
        flight.distanceKm ? Math.round(flight.distanceKm).toLocaleString("en-GB") + " km" : "—"
      ].forEach(value => row.appendChild(makeNode("td","",value)));
      tbody.appendChild(row);
    });
    table.append(thead,tbody); tableWrap.appendChild(table);
    root.querySelector("#eagRouteSummary")?.replaceChildren(summary,list);
    root.querySelector("#eagRouteFlights")?.replaceChildren(tableWrap);
    return routes;
  }
  async function renderMap(flights) {
    await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
    const mapNode = root.querySelector("#eagFlownRoutesMap");
    if (!mapNode) return;
    const airports = await loadAirports();
    mapNode.replaceChildren();
    map = window.L.map(mapNode, { scrollWheelZoom:false, worldCopyJump:true });
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 12,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    const bounds = [];
    const markers = new Set();
    flights.forEach(flight => {
      const from = airports.get(String(flight.departure || "").toUpperCase());
      const to = airports.get(String(flight.arrival || "").toUpperCase());
      if (!from || !to) return;
      const points = [[from.lat,from.lon],[to.lat,to.lon]];
      window.L.polyline(points, { color:"#9ccc52", weight:2.4, opacity:.48, smoothFactor:1 }).addTo(map);
      points.forEach(point => bounds.push(point));
      [flight.departure,flight.arrival].forEach(code => {
        if (markers.has(code)) return;
        markers.add(code);
        const location = airports.get(String(code).toUpperCase());
        if (!location) return;
        window.L.circleMarker([location.lat,location.lon], { radius:4, color:"#e4f2d3", fillColor:"#9ccc52", fillOpacity:.92, weight:1 }).addTo(map)
          .bindPopup("<strong>" + esc(code) + "</strong>");
      });
    });
    if (bounds.length) map.fitBounds(bounds, { padding:[28,28], maxZoom:5 });
    else map.setView([30,5],2);
    setTimeout(()=>map.invalidateSize(),100);
    return airports;
  }
  async function load() {
    root.querySelector("#eagRouteSummary").replaceChildren(makeNode("div","eag-empty-state","Loading NewSky flight history for the last 30 days…"));
    try {
      const response = await fetch(API + "/platform/routes?days=30",{cache:"no-store"});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load recent flights.");
      if (!data.flights.length) {
        root.querySelector("#eagRouteSummary").replaceChildren(makeNode("div","eag-empty-state","No completed flights with both departure and arrival airports were found in the last 30 days."));
        return;
      }
      renderList(data);
      try { await renderMap(data.flights); }
      catch (error) { root.querySelector("#eagFlownRoutesMap").replaceWith(makeNode("div","eag-load-error","The route list is available, but the map could not load: " + error.message)); }
    } catch (error) {
      root.replaceChildren(makeNode("div","eag-load-error",error.message));
    }
  }
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  document.head.appendChild(css);
  load();
})();
