(() => {
  "use strict";
  const API=(window.ECHO_API_URL||"https://echo-air-group-api.onrender.com/api").replace(/\/$/,"");
  const $=s=>document.querySelector(s);
  const el=(tag,cls,content)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(content!==undefined)n.textContent=String(content);return n;};
  const number=value=>Number.isFinite(Number(value))?Number(value):0;
  const initials=name=>String(name||"Pilot").trim().split(/\s+/).filter(Boolean).slice(0,2).map(v=>v[0].toUpperCase()).join("")||"P";
  const achievements=[
    {title:"First Flight",description:"Complete your first recorded Echo flight.",icon:"✈",threshold:1,field:"flights"},
    {title:"Frequent Flyer",description:"Complete 10 recorded flights.",icon:"↗",threshold:10,field:"flights"},
    {title:"Airline Regular",description:"Complete 50 recorded flights.",icon:"★",threshold:50,field:"flights"},
    {title:"Century Pilot",description:"Complete 100 recorded flights.",icon:"🏅",threshold:100,field:"flights"},
    {title:"Time Builder",description:"Log 25 hours in the simulator.",icon:"◷",threshold:25,field:"hours"},
    {title:"Long Haul",description:"Fly 25,000 recorded kilometres.",icon:"🌍",threshold:25000,field:"distance"},
    {title:"Route Explorer",description:"Fly 10 different airport pairs.",icon:"⌁",threshold:10,field:"routes"},
    {title:"Airport Collector",description:"Visit 15 different airports.",icon:"◎",threshold:15,field:"airports"},
    {title:"Fleet Explorer",description:"Fly 5 different aircraft types.",icon:"▣",threshold:5,field:"aircraft"},
    {title:"Five-Star Performance",description:"Average a flight rating of 90 or higher over 10 rated flights.",icon:"✦",threshold:90,field:"avgRating",requires:"ratedFlights"}
  ];
  function renderAchievements(detail){
    const root=$("#pilotAchievements");if(!root)return;
    const m=detail.metrics||{},flights=detail.flights||[];
    const airports=new Set();
    flights.forEach(f=>[f.depIcao||f.dep_icao,f.arrIcao||f.arr_icao].filter(Boolean).forEach(v=>airports.add(String(v).trim().toUpperCase())));
    const ratedFlights=flights.filter(f=>Number(f.rating)>0).length;
    const values={flights:number(m.flights),hours:number(m.hours),distance:number(m.distance),routes:number(m.routes),airports:airports.size,aircraft:number(m.aircraft),avgRating:number(m.avgRating),ratedFlights};
    let earned=0;root.replaceChildren();
    achievements.forEach(item=>{
      const value=values[item.field]||0;
      const complete=item.field==="avgRating"?value>=item.threshold&&ratedFlights>=10:value>=item.threshold;
      if(complete)earned++;
      const progress=item.field==="avgRating"?(ratedFlights>=10?Math.min(100,value/item.threshold*100):Math.min(100,ratedFlights/10*100)):Math.min(100,value/item.threshold*100);
      const card=el("article","profile-achievement "+(complete?"earned":"locked"));
      const icon=el("span","profile-achievement-icon",item.icon);icon.setAttribute("aria-hidden","true");
      const copy=el("div","profile-achievement-copy");
      const label=item.field==="avgRating"&&ratedFlights<10?String(ratedFlights)+"/10 rated flights":(item.field==="hours"?value.toFixed(1):Math.round(value).toLocaleString("en-GB"))+" / "+item.threshold.toLocaleString("en-GB");
      copy.append(el("strong","",item.title),el("p","",item.description),el("small","",complete?"Achievement earned":label));
      const track=el("div","profile-achievement-track"),fill=el("span");fill.style.width=progress+"%";track.appendChild(fill);copy.appendChild(track);
      card.append(icon,copy);root.appendChild(card);
    });
    const count=$("#pilotAchievementCount");if(count)count.textContent=earned+" / "+achievements.length+" earned";
  }
  function renderPeers(detail){
    const root=$("#pilotPeerCompare");if(!root)return;
    const all=Array.isArray(detail.leaderboard)?detail.leaderboard.slice():[];
    const currentId=String((detail.pilot||{}).id);
    const currentIndex=all.findIndex(v=>String(v.id??v.userId??v.user_id)===currentId);
    if(currentIndex<0||!all.length){root.replaceChildren(el("p","profile-empty","No comparable leaderboard entries are available yet."));return;}
    const nearby=all.slice(Math.max(0,currentIndex-2),Math.min(all.length,currentIndex+3));
    root.replaceChildren();
    nearby.forEach(pilot=>{
      const id=pilot.id??pilot.userId??pilot.user_id;
      const rank=Number(pilot.position)||all.findIndex(v=>String(v.id??v.userId??v.user_id)===String(id))+1;
      const name=pilot.name||pilot.displayName||pilot.username||"Pilot";
      const row=document.createElement("a");row.className="profile-peer-row"+(String(id)===currentId?" current":"");row.href="pilot.html?id="+encodeURIComponent(id);
      const pos=el("span","profile-peer-position","#"+rank);
      const avatar=el("span","profile-peer-avatar");
      if(pilot.avatarUrl){const img=document.createElement("img");img.src=API+pilot.avatarUrl;img.alt="";img.loading="lazy";avatar.appendChild(img);}else avatar.textContent=initials(name);
      const copy=el("span","profile-peer-name");copy.append(el("strong","",name),el("small","",pilot.rank||"Pilot rank"));
      const score=el("span","profile-peer-score",number(pilot.stars).toLocaleString("en-GB",{maximumFractionDigits:1})+" ⭐");
      score.appendChild(el("small","",number(pilot.flightCount??pilot.flights).toLocaleString("en-GB")+" flights"));
      row.append(pos,avatar,copy,score);root.appendChild(row);
    });
  }
  window.addEventListener("eag:pilot-profile-loaded",event=>{
    const detail=event.detail||{},pilot=detail.pilot||{};
    const avatar=$("#pilotAvatar");
    if(avatar&&pilot.avatarUrl){
      avatar.textContent="";
      avatar.style.backgroundImage="url(\""+API+pilot.avatarUrl+"\")";
      avatar.classList.add("has-photo");
    }
    const bio=$("#pilotBio");if(bio){bio.textContent=pilot.bio||"";bio.hidden=!pilot.bio;}
    renderAchievements(detail);renderPeers(detail);
  });
})();
