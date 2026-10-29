(() => {
  "use strict";
  const API=(window.ECHO_API_URL||"https://echo-air-group-api.onrender.com/api").replace(/\/$/,"");
  const $=s=>document.querySelector(s);
  const ranks=[["Cadet",0],["First Officer",1000],["Senior First Officer",2500],["Captain",5000],["Senior Captain",7500],["Commander",10000]];
  let flights=[],showAll=false;
  const num=v=>v===null||v===undefined||v===""?null:(Number.isFinite(Number(v))?Number(v):null);
  const fmt=(v,d=1)=>num(v)===null?"—":Number(v).toLocaleString("en-GB",{maximumFractionDigits:d});
  const text=(s,v)=>{const n=$(s);if(n)n.textContent=v===null||v===undefined?"—":String(v);};
  const el=(tag,cls,content)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(content!==undefined)n.textContent=String(content);return n;};
  const get=(o,keys)=>{for(const k of keys)if(o&&o[k]!==null&&o[k]!==undefined&&o[k]!=="")return o[k];return null;};
  const dateOf=f=>get(f,["depTime","dep_time","depTimeAct","departureTime","departureDate","date","flightDate"]);
  const dateText=v=>{if(!v)return "—";const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});};
  const initials=name=>String(name||"Pilot").trim().split(/\s+/).filter(Boolean).slice(0,2).map(v=>v.charAt(0).toUpperCase()).join("")||"P";
  const rankFor=stars=>{const total=num(stars)||0;let current=ranks[0],next=null;for(const r of ranks){if(total>=r[1])current=r;else{next=r;break;}}return{current,next};};
  const routeOf=f=>{const a=String(get(f,["depIcao","dep_icao","departure","origin"])||"").trim().toUpperCase(),b=String(get(f,["arrIcao","arr_icao","arrival","destination"])||"").trim().toUpperCase();return a&&b?a+" → "+b:(a||b||"Route unavailable");};
  const aircraftOf=f=>{const a=get(f,["aircraft","aircraftName","aircraftType"]);return a&&typeof a==="object"?String(get(a,["name","title","icao","type"])||"Aircraft unavailable"):String(a||"Aircraft unavailable");};
  const durationOf=f=>{const v=num(get(f,["duration","durationMinutes","flightDuration","minutes","flightTime"]));return v!==null&&v>0?v:null;};
  const distanceOf=f=>{const v=num(get(f,["distance","distanceKm","distance_km","routeDistanceKm"]));return v!==null&&v>0?v:null;};
  const ratingOf=f=>{const v=num(get(f,["rating","flightRating","score"]));return v!==null&&v>0?v:null;};
  const starsOf=f=>{const v=num(get(f,["stars","flightStars","echoStars"]));return v!==null&&v>=0?v:null;};
  async function api(path){const r=await fetch(API+path,{headers:{"Accept":"application/json"},cache:"no-store"});const raw=await r.text();let data={};try{data=raw?JSON.parse(raw):{};}catch(_){}if(!r.ok)throw new Error(data.error||("Request failed ("+r.status+")."));return data;}
  function metrics(p,rows){
    const durations=rows.map(durationOf).filter(v=>v!==null),distances=rows.map(distanceOf).filter(v=>v!==null),ratings=rows.map(ratingOf).filter(v=>v!==null),starsArr=rows.map(starsOf).filter(v=>v!==null);
    const aircraft=new Set(rows.map(aircraftOf).filter(v=>v!=="Aircraft unavailable").map(v=>v.toLowerCase()));
    const routes=new Set(rows.map(f=>{const a=String(get(f,["depIcao","dep_icao"])||"").trim().toUpperCase(),b=String(get(f,["arrIcao","arr_icao"])||"").trim().toUpperCase();return a&&b?a+"-"+b:"";}).filter(Boolean));
    const official=num(p.stars),sorted=rows.slice().sort((a,b)=>new Date(dateOf(b)||0).getTime()-new Date(dateOf(a)||0).getTime());
    const rh=num(p.flightHours),rr=num(p.averageRating),rd=num(p.distance);
    return {stars:official===null?starsArr.reduce((s,v)=>s+v,0):official,flights:num(p.flightCount)===null?rows.length:num(p.flightCount),
      hours:rh!==null&&rh>0?rh:(durations.length?durations.reduce((s,v)=>s+v,0)/60:null),
      distance:distances.length?distances.reduce((s,v)=>s+v,0):(rd!==null&&rd>0?rd:null),
      avgRating:ratings.length?ratings.reduce((s,v)=>s+v,0)/ratings.length:(rr!==null&&rr>0?rr:null),
      bestRating:ratings.length?Math.max.apply(null,ratings):null,
      avgStars:starsArr.length?starsArr.reduce((s,v)=>s+v,0)/starsArr.length:null,
      aircraft:aircraft.size,routes:routes.size,latest:sorted.length?sorted[0]:null};
  }
  function rankProgress(stars){
    const r=rankFor(stars),c=r.current,n=r.next,pct=n?Math.max(0,Math.min(100,((stars-c[1])/(n[1]-c[1]))*100)):100;
    $("#rankProgressFill").style.width=pct+"%";text("#rankProgressPercent",Math.round(pct)+"%");
    text("#rankProgressTitle",n?c[0]+" → "+n[0]:"Maximum rank reached");
    text("#rankProgressValue",fmt(stars,2)+" / "+fmt(n?n[1]:c[1],0)+" ⭐");
    text("#rankProgressNote",n?fmt(Math.max(0,n[1]-stars),2)+" more stars to reach "+n[0]+".":"This pilot has reached the highest rank in the current Echo Air Group system.");
  }
  function renderRecent(){
    const target=$("#recentActivity");target.replaceChildren();
    const rows=flights.slice().sort((a,b)=>new Date(dateOf(b)||0).getTime()-new Date(dateOf(a)||0).getTime()).slice(0,5);
    if(!rows.length){target.appendChild(el("div","profile-empty","No flight activity has been recorded yet."));return;}
    rows.forEach(f=>{const row=el("div","side-stat-row"),left=el("div","");left.appendChild(el("strong","",routeOf(f)));const date=el("div","",dateText(dateOf(f)));date.style.marginTop="4px";date.style.color="#85907c";date.style.fontSize="9px";left.appendChild(date);const stars=starsOf(f);row.append(left,el("strong","",stars===null?"—":fmt(stars,2)+" ⭐"));target.appendChild(row);});
  }
  function renderFlights(){
    const target=$("#pilotFlightRows"),q=($("#flightSearch").value||"").trim().toLowerCase();target.replaceChildren();
    const filtered=flights.filter(f=>[routeOf(f),aircraftOf(f),dateOf(f)].join(" ").toLowerCase().includes(q)),visible=showAll||q?filtered:filtered.slice(0,20);
    text("#flightHistoryCount",filtered.length.toLocaleString("en-GB")+" flight"+(filtered.length===1?"":"s")+(q?" matching this search":""));
    if(!visible.length){const row=el("tr",""),cell=el("td","profile-empty",flights.length?"No flights match your search.":"No flights have been synced for this pilot yet.");cell.colSpan=7;row.appendChild(cell);target.appendChild(row);}
    else visible.forEach(f=>{
      const row=el("tr","");row.appendChild(el("td","",dateText(dateOf(f))));
      const route=el("td","");route.appendChild(el("div","route-main",routeOf(f)));route.appendChild(el("div","route-sub","Recorded flight"));row.appendChild(route);
      row.appendChild(el("td","",aircraftOf(f)));const d=durationOf(f);row.appendChild(el("td","",d===null?"—":Math.floor(Math.round(d)/60)+"h "+(Math.round(d)%60)+"m"));
      const rating=ratingOf(f),rc=el("td","");if(rating===null)rc.textContent="—";else rc.appendChild(el("span","rating-value",fmt(rating,2)));row.appendChild(rc);
      const dist=distanceOf(f);row.appendChild(el("td","",dist===null?"—":fmt(dist,0)+" km"));const stars=starsOf(f);row.appendChild(el("td","flight-stars",stars===null?"—":fmt(stars,2)+" ⭐"));target.appendChild(row);
    });
    const old=$("#showAllFlightsButton");if(old)old.remove();
    if(!q&&filtered.length>20){const button=el("button","btn btn-secondary",showAll?"Show recent flights":"Show all "+filtered.length.toLocaleString("en-GB")+" flights");button.id="showAllFlightsButton";button.type="button";button.style.display="block";button.style.margin="16px 22px 20px";button.addEventListener("click",()=>{showAll=!showAll;renderFlights();});$("#flightHistoryFooter").insertAdjacentElement("beforebegin",button);}
  }
  async function load(){
    const id=new URLSearchParams(window.location.search).get("id");if(!id||!/^\d+$/.test(id))throw new Error("This profile link is missing a valid pilot ID. Open a pilot from the Pilot Dashboard.");
    const results=await Promise.allSettled([api("/pilots/"+encodeURIComponent(id)),api("/ranking")]);if(results[0].status!=="fulfilled")throw results[0].reason;
    const payload=results[0].value,p=payload.pilot||{};flights=Array.isArray(payload.flights)?payload.flights:[];
    const leaderboard=results[1].status==="fulfilled"&&Array.isArray(results[1].value.rankings)?results[1].value.rankings:[];
    const m=metrics(p,flights),r=rankFor(m.stars),positionEntry=leaderboard.find(v=>String(v.id??v.userId??v.user_id)===String(p.id));
    const position=positionEntry?(positionEntry.position||leaderboard.indexOf(positionEntry)+1):null,name=p.displayName||p.username||"Pilot",joined=dateText(p.createdAt),latest=m.latest?dateText(dateOf(m.latest)):"—",rank=p.rank||r.current[0];
    document.title=name+" — Pilot Profile | Echo Air Group";
    text("#heroPilotName",name+"'s flight profile");text("#heroPilotText","Career overview for "+name+", based on Echo Air Group's saved flight records.");
    text("#heroPosition",position?"#"+position:"Unranked");text("#heroRank",rank);text("#heroFlights",fmt(m.flights,0));
    text("#pilotDisplayName",name);text("#pilotAvatar",initials(name));text("#pilotMemberSince",(p.username?"@"+p.username+" · ":"")+"Member since "+joined);text("#pilotRankPill",rank);
    text("#statStars",fmt(m.stars,2)+" ⭐");text("#statFlights",fmt(m.flights,0));text("#statHours",m.hours===null?"—":fmt(m.hours,1)+" h");
    text("#statDistance",m.distance===null?"—":fmt(m.distance,0)+" km");text("#statAvgRating",m.avgRating===null?"—":fmt(m.avgRating,2));
    text("#statBestRating",m.bestRating===null?"—":fmt(m.bestRating,2));text("#statAircraft",fmt(m.aircraft,0));text("#statRoutes",fmt(m.routes,0));
    text("#sidePosition",position?"#"+position:"—");text("#sideRank",rank);text("#sideAvgStars",m.avgStars===null?"—":fmt(m.avgStars,2)+" ⭐");text("#sideLatestFlight",latest);text("#sideMemberSince",joined);
    rankProgress(m.stars);renderRecent();renderFlights();$("#profileLoading").hidden=true;$("#profileContent").hidden=false;
    if(results[1].status==="rejected")text("#flightHistoryFooter","Leaderboard position could not be loaded. Other figures come from the saved flight records.");
  }
  $("#flightSearch").addEventListener("input",renderFlights);
  load().catch(error=>{console.error("Pilot profile load failed:",error);$("#profileLoading").hidden=true;$("#profileError").hidden=false;text("#profileErrorText",error&&error.message?error.message:"We could not load this pilot profile.");});
})();