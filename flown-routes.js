(() => {
 "use strict";
 const API=(window.ECHO_API_URL||"https://echo-air-group-api.onrender.com/api").replace(/\/$/,"");
 const root=document.getElementById("eagRoutesPage");if(!root)return;
 const $=s=>root.querySelector(s);
 let routes=[],map=null,airportPromise=null,loading=false,routeLimit=18;
 const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const fmtDate=v=>{if(!v)return "—";const d=new Date(v);return Number.isNaN(d.getTime())?"—":d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});};
 const fmtTime=v=>{if(!v)return "not available";const d=new Date(v);return Number.isNaN(d.getTime())?"not available":d.toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});};
 function node(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e;}
 async function api(path){const r=await fetch(API+path,{cache:"no-store",headers:{Accept:"application/json"}});const d=await r.json();if(!r.ok)throw new Error(d.error||"Unable to load route data.");return d;}
 function renderStats(network,flightData){
  const values=[["Routes recorded",network.count??network.routes.length],["Active routes",network.activeCount??network.routes.filter(r=>!r.archived).length],["Archived routes",network.archivedCount??network.routes.filter(r=>r.archived).length],["Flights · last 30 days",flightData.count??flightData.flights.length]];
  const target=$("#eagRouteStats");target.replaceChildren();
  values.forEach(([label,value])=>{const card=node("div","route-stat");card.append(node("span","",label),node("strong","",Number(value||0).toLocaleString("en-GB")));target.appendChild(card);});
  const recentPairs=new Set(flightData.flights.map(f=>f.departure+"-"+f.arrival));
  const summary=$("#eagRecentSummary");summary.replaceChildren();
  [(flightData.count||0)+" completed flights",recentPairs.size+" routes flown",flightData.days+"-day activity window","Updates every 60 seconds"].forEach(s=>summary.appendChild(node("span","route-summary-chip",s)));
  $("#eagFlightCount").textContent=(flightData.count||0)+" flights";
  $("#eagRoutesUpdated").textContent="Updated "+fmtTime(new Date().toISOString())+" · NewSky sync "+fmtTime(network.lastSyncedAt);
 }
 function renderNetwork(){
  const target=$("#eagRouteCards"),search=($("#eagRouteSearch").value||"").trim().toUpperCase(),filter=$("#eagRouteFilter").value;
  const list=routes.filter(r=>(filter==="all"||(filter==="active"&&!r.archived)||(filter==="archived"&&r.archived))&&(!search||(r.departure+" "+r.arrival).includes(search)));
  list.sort((a,b)=>Number(a.archived)-Number(b.archived)||Number(b.flights30d)-Number(a.flights30d)||Number(b.totalFlights)-Number(a.totalFlights)||(a.departure+a.arrival).localeCompare(b.departure+b.arrival));
  $("#eagRouteCount").textContent=list.length+" of "+routes.length+" routes";target.replaceChildren();
  const more=$("#eagRouteMoreRoutes");
  if(more){more.hidden=list.length<=routeLimit;more.textContent="Show "+Math.min(18,list.length-routeLimit)+" more routes";}
  if(!list.length){target.appendChild(node("div","route-empty-state",routes.length?"No routes match this filter. Try another airport code or status.":"No completed NewSky routes have been imported yet. A route appears here once a linked pilot completes a flight."));return;}
  list.slice(0,routeLimit).forEach(r=>{
   const card=node("article","eag-route-card"),top=node("div","eag-route-card-top");
   top.append(node("div","eag-route-title",r.departure+" → "+r.arrival),node("span","eag-route-status"+(r.archived?" archived":""),r.archived?"Archived":"Active"));
   const meta=node("div","eag-route-meta");
   [r.totalFlights+" recorded flight(s)",r.flights30d+" in last 30 days",r.pilotCount+" pilot(s)","Last flown "+fmtDate(r.lastFlownAt)].forEach(t=>meta.appendChild(node("span","",t)));
   card.append(top,meta);
   if(r.archived&&(r.archiveReason||r.statusChangedAt))card.appendChild(node("div","eag-route-reason",(r.archiveReason?r.archiveReason+" · ":"")+"Status changed "+fmtDate(r.statusChangedAt)+(r.statusChangedBy?" by "+r.statusChangedBy:"")));
   target.appendChild(card);
  });
 }
 function csvLine(line){const a=[];let v="",q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'&&q&&line[i+1]==='"'){v+='"';i++;}else if(c==='"')q=!q;else if(c===","&&!q){a.push(v);v="";}else v+=c;}a.push(v);return a;}
 function loadAirports(){
  if(airportPromise)return airportPromise;
  airportPromise=fetch("https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat",{cache:"force-cache"}).then(r=>{if(!r.ok)throw new Error("Airport reference data is unavailable.");return r.text();}).then(csv=>{
   const data=new Map();csv.split(/\r?\n/).forEach(line=>{if(!line.trim())return;const f=csvLine(line),icao=String(f[5]||"").trim().toUpperCase(),lat=Number(f[6]),lon=Number(f[7]);if(icao&&icao!=="\\N"&&Number.isFinite(lat)&&Number.isFinite(lon))data.set(icao,{lat,lon});});return data;
  });return airportPromise;
 }
 function leaflet(){
  if(window.L)return Promise.resolve();
  return new Promise((resolve,reject)=>{
   const old=document.querySelector('script[data-eag-leaflet="true"]');
   if(old){old.addEventListener("load",resolve,{once:true});old.addEventListener("error",reject,{once:true});return;}
   const s=document.createElement("script");s.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";s.async=true;s.dataset.eagLeaflet="true";s.onload=resolve;s.onerror=()=>reject(new Error("Map library could not be loaded."));document.head.appendChild(s);
  });
 }
 async function renderMap(flights){
  const target=$("#eagFlownRoutesMap");if(map){map.remove();map=null;}target.replaceChildren();
  if(!flights.length){target.appendChild(node("div","route-map-loading","No completed flights with both airport codes were recorded during the last 30 days."));return;}
  await leaflet();const airports=await loadAirports();
  map=window.L.map(target,{scrollWheelZoom:false,worldCopyJump:true});
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:12,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  const bounds=[],markers=new Set(),pairs=new Map();
  flights.forEach(f=>{
   const dep=String(f.departure||"").toUpperCase(),arr=String(f.arrival||"").toUpperCase(),from=airports.get(dep),to=airports.get(arr);if(!from||!to)return;
   const key=dep+"|"+arr;pairs.set(key,(pairs.get(key)||0)+1);bounds.push([from.lat,from.lon],[to.lat,to.lon]);
   [[dep,from],[arr,to]].forEach(([code,p])=>{if(markers.has(code))return;markers.add(code);window.L.circleMarker([p.lat,p.lon],{radius:5,color:"#fff",weight:1.5,fillColor:"#8fca22",fillOpacity:.96}).addTo(map).bindPopup("<strong>"+esc(code)+"</strong>");});
  });
  pairs.forEach((count,key)=>{const [dep,arr]=key.split("|"),from=airports.get(dep),to=airports.get(arr);if(!from||!to)return;window.L.polyline([[from.lat,from.lon],[to.lat,to.lon]],{color:"#8fca22",weight:Math.min(5,2+Math.log2(count)),opacity:.78}).addTo(map).bindPopup("<strong>"+esc(dep)+" → "+esc(arr)+"</strong><br>"+count+" completed flight(s)");});
  if(bounds.length)map.fitBounds(bounds,{padding:[34,34],maxZoom:5});else map.setView([30,5],2);
  setTimeout(()=>map&&map.invalidateSize(),120);
 }
 function renderFlights(flights){
  const target=$("#eagRouteFlights");target.replaceChildren();
  if(!flights.length){target.appendChild(node("div","route-empty-state","No completed flights with known departure and arrival airports were found in the last 30 days."));return;}
  const table=node("table","route-flight-table"),head=node("thead"),hr=node("tr"),body=node("tbody");
  ["Date","Pilot","Route","Aircraft","Distance"].forEach(h=>hr.appendChild(node("th","",h)));head.appendChild(hr);
  flights.forEach(f=>{
   const row=node("tr");row.append(node("td","",fmtDate(f.date)),node("td","",f.pilot||"Unknown pilot"),node("td","route-flight-pair",f.departure+" → "+f.arrival),
   node("td","",f.registration?f.registration+" · "+(f.aircraft||"Aircraft not supplied"):(f.aircraft||"Aircraft not supplied")),
   node("td","",f.distanceKm?Math.round(Number(f.distanceKm)).toLocaleString("en-GB")+" km":"—"));body.appendChild(row);
  });
  table.append(head,body);target.appendChild(table);
 }
 async function load(){
  if(loading)return;loading=true;
  try{
   const [network,history]=await Promise.all([api("/platform/route-network"),api("/platform/routes?days=30")]);
   routes=Array.isArray(network.routes)?network.routes:[];
   const flights=Array.isArray(history.flights)?history.flights:[];
   renderStats(network,history);renderNetwork();renderFlights(flights);
   try{await renderMap(flights);}catch(e){$("#eagFlownRoutesMap").replaceChildren(node("div","route-map-loading","Recent flights loaded, but the map is unavailable: "+e.message));}
  }catch(e){
   $("#eagRoutesUpdated").textContent="Unable to update route data";
   $("#eagRouteCards").replaceChildren(node("div","route-empty-state",e.message));
   $("#eagFlownRoutesMap").replaceChildren(node("div","route-map-loading","Route map is unavailable while the NewSky data service is offline."));
  }finally{loading=false;}
 }
 const cssLink=document.createElement("link");cssLink.rel="stylesheet";cssLink.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";document.head.appendChild(cssLink);
 $("#eagRouteSearch").addEventListener("input",()=>{routeLimit=18;renderNetwork();});
 $("#eagRouteFilter").addEventListener("change",()=>{routeLimit=18;renderNetwork();});
 $("#eagRouteMoreRoutes").addEventListener("click",()=>{routeLimit+=18;renderNetwork();});
 load();window.setInterval(()=>{if(document.visibilityState==="visible")load();},60000);
})();