
(() => {
  "use strict";
  const API="https://echo-air-group-api.onrender.com/api";
  const TOKEN_KEY="eag_admin_token";
  const $=s=>document.querySelector(s);
  let session=null;
  function node(tag,cls,value){const el=document.createElement(tag);if(cls)el.className=cls;if(value!==undefined)el.textContent=String(value);return el;}
  function fmtDate(value){if(!value)return "—";const d=new Date(value);return Number.isNaN(d.getTime())?"—":d.toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"});}
  async function request(path,options={}){
    const headers={Accept:"application/json",...(options.headers||{})};
    if(options.body!==undefined)headers["Content-Type"]="application/json";
    const token=sessionStorage.getItem(TOKEN_KEY)||"";
    if(token)headers.Authorization="Bearer "+token;
    const response=await fetch(API+path,{...options,headers,cache:"no-store"});
    const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{data={error:raw};}
    if(!response.ok){const error=new Error(data.error||"Request failed ("+response.status+").");error.status=response.status;throw error;}
    return data;
  }
  function table(container,headers,rows){
    container.replaceChildren();
    const wrap=node("div","platform-admin-table-wrap"),t=node("table","platform-admin-table"),thead=node("thead"),tr=node("tr");
    headers.forEach(h=>tr.appendChild(node("th","",h)));thead.appendChild(tr);
    const tbody=node("tbody");
    if(!rows.length){const empty=node("tr");const td=node("td","platform-admin-muted","No records found.");td.colSpan=headers.length;empty.appendChild(td);tbody.appendChild(empty);}
    rows.forEach(row=>{const tr=node("tr");row.forEach(value=>tr.appendChild(node("td","",value)));tbody.appendChild(tr);});
    t.append(thead,tbody);wrap.appendChild(t);container.appendChild(wrap);
  }
  function statGrid(target,items){
    target.replaceChildren();const grid=node("div","platform-admin-grid");
    items.forEach(([label,value])=>{const card=node("div","platform-admin-stat");card.append(node("span","",label),node("strong","",value));grid.appendChild(card);});
    target.appendChild(grid);
  }
  function showError(target,error){target.replaceChildren(node("div","admin-empty",error.message));}
  async function loadOverview(){
    const root=$("#platformOverview");if(!root)return;
    try{
      const data=await request("/platform/admin/overview");
      statGrid(root,[
        ["Registered pilots",data.stats.pilots],["Imported flights",data.stats.flights],
        ["Active pilots · 30 days",data.stats.activePilots30d],["No flights · 30 days",data.stats.inactivePilots30d],
        ["Applications",data.stats.applications],["New applications",data.stats.newApplications],
        ["Academy courses",data.stats.courses],["Published courses",data.stats.publishedCourses]
      ]);
      const block=node("div","admin-panel");
      block.appendChild(node("h3","","Platform activity"));
      table(block,["Time","Administrator","Action","Target"],(data.recentAudit||[]).map(item=>[fmtDate(item.created_at),item.actor_username,item.action,item.target_type+(item.target_id?" #"+item.target_id:"")]));
      root.appendChild(block);
    }catch(error){showError(root,error);}
  }
  async function loadOperations(){
    const root=$("#platformOperations");if(!root)return;
    try{
      const data=await request("/platform/admin/operations");
      statGrid(root,[["Pilots",data.totals.pilots],["Flown · 30 days",data.totals.activePilots30d],["No flights · 30 days",data.totals.notFlown30d],["Flights · 30 days",data.totals.flights30d]]);
      const rows=data.pilots.map(p=>[p.displayName+" ("+p.username+")",p.newskyLinked?"Linked":"Not linked",p.totalFlights,p.flights30d,p.lastFlightAt?fmtDate(p.lastFlightAt):"Never",p.activity==="flown"?"Flown in last 30 days":"No flight in last 30 days"]);
      table(root,["Pilot","NewSky","All flights","30-day flights","Last flight","Activity"],rows);
    }catch(error){showError(root,error);}
  }
  async function loadFleet(){
    const root=$("#platformFleet");if(!root)return;
    try{
      const data=await request("/platform/admin/fleet");
      table(root,["Registration","Aircraft name","Type","All flights","30-day flights","Last flight"],(data.aircraft||[]).map(a=>[a.registration||"Unknown",a.name,a.type||"Not supplied",a.total,a.recent,fmtDate(a.last)]));
    }catch(error){showError(root,error);}
  }
  async function loadSystem(){
    const root=$("#platformSystem");if(!root)return;
    try{
      const [status,overview]=await Promise.all([request("/platform/status"),request("/platform/admin/overview")]);
      const items=[
        ["Backend",status.backend.label,status.backend.status],
        ["Database",status.database.label,status.database.status],
        ["Discord Bot",status.discord.label,status.discord.status],
        ["NewSky",status.newsky.label,status.newsky.status]
      ];
      const grid=node("div","platform-admin-grid");
      items.forEach(([name,label,state])=>{const card=node("div","platform-admin-stat");card.append(node("span","",name),node("strong","",label),node("small","platform-admin-state "+(state==="ok"?"ok":state==="warning"?"warning":"error"),state));grid.appendChild(card);});
      root.replaceChildren(grid,node("p","platform-admin-muted","Backend uptime: "+Math.floor(status.backend.uptimeSeconds/3600)+"h "+Math.floor(status.backend.uptimeSeconds%3600/60)+"m · Last sync: "+fmtDate(overview.sync&&overview.sync.last_completed_at)));
      if(status.newsky.detail)root.appendChild(node("p","platform-admin-muted",status.newsky.detail));
      if(overview.sync&&overview.sync.last_error)root.appendChild(node("p","platform-admin-muted","Last NewSky sync error: "+overview.sync.last_error));
    }catch(error){showError(root,error);}
  }
  async function loadRoles(){
    const root=$("#platformRoles");if(!root)return;
    try{
      const data=await request("/platform/admin/roles");
      const form=$("#platformRoleForm");const roleField=$("#platformNewRole");
      if(roleField&&!roleField.options.length)(data.availableRoles||[]).forEach(role=>{const option=document.createElement("option");option.value=role;const labels={academy_instructor:"Academy instructor — review practical flights",academy_examiner:"Academy examiner — verify theory exams",academy_manager:"Academy manager — manage courses and assessments",operations_manager:"Operations manager — manage flight operations",analyst:"Analyst — read-only operational access",viewer:"Viewer — limited read access",admin:"Administrator — manage platform features"};option.textContent=labels[role]||role.replace(/_/g," ");roleField.appendChild(option);});
      table(root,["Pilot account","Role","Assigned"],(data.roles||[]).map(role=>[role.display_name||role.username,role.role,fmtDate(role.created_at)]));
      root.querySelectorAll("table tbody tr").forEach((row,index)=>{
        const role=data.roles[index];if(!role)return;
        const button=node("button","admin-button danger","Remove role");button.type="button";button.addEventListener("click",async()=>{
          if(!window.confirm("Remove admin role from "+role.username+"?"))return;
          await request("/platform/admin/roles/"+role.user_id,{method:"DELETE"});loadRoles();
        });
        row.lastElementChild.appendChild(button);
      });
    }catch(error){showError(root,error);}
  }
  async function loadAudit(){
    const root=$("#platformAudit");if(!root)return;
    try{const data=await request("/platform/admin/audit?limit=150");table(root,["Time","Actor","Action","Target","Details"],(data.entries||[]).map(item=>[fmtDate(item.created_at),item.actor_username,item.action,item.target_type+(item.target_id?" #"+item.target_id:""),JSON.stringify(item.details||{})]));}
    catch(error){showError(root,error);}
  }
  async function loadNotifications(){
    const root=$("#platformNotifications");if(!root)return;
    try{
      const data=await request("/platform/admin/notifications");root.replaceChildren();
      (data.notifications||[]).forEach(item=>{
        const card=node("article","platform-admin-notification");card.append(node("h3","",item.title),node("p","",item.message));
        const foot=node("div","platform-admin-notification-footer");foot.append(node("span","",item.level.toUpperCase()+" · "+fmtDate(item.created_at)));
        const remove=node("button","admin-button danger","Delete");remove.type="button";remove.addEventListener("click",async()=>{await request("/platform/admin/notifications/"+item.id,{method:"DELETE"});loadNotifications();});
        foot.appendChild(remove);card.appendChild(foot);root.appendChild(card);
      });
      if(!data.notifications?.length)root.appendChild(node("div","admin-empty","No active notifications."));
    }catch(error){showError(root,error);}
  }
  async function loadRoutes(){
    const root=$("#platformRoutes");if(!root)return;
    try{
      const data=await request("/platform/route-network");
      const routes=data.routes||[];
      table(root,["Route","Flights","Last 30 days","Pilots","Last flown","Status","Action"],routes.map(route=>[
        route.departure+" → "+route.arrival,
        route.totalFlights,
        route.flights30d,
        route.pilotCount,
        fmtDate(route.lastFlownAt),
        route.archived?"Archived":"Active",
        route.archived?"Restore":"Archive"
      ]));
      root.querySelectorAll("tbody tr").forEach((row,index)=>{
        const route=routes[index];if(!route)return;
        const button=node("button","admin-button "+(route.archived?"secondary":"danger"),route.archived?"Restore route":"Archive route");
        button.type="button";
        button.addEventListener("click",async()=>{
          const action=route.archived?"restore":"archive";
          const promptText=route.archived
            ?"Restore "+route.departure+" → "+route.arrival+" to the active route list?"
            :"Archive "+route.departure+" → "+route.arrival+"? The completed flight history will remain available.";
          if(!window.confirm(promptText))return;
          button.disabled=true;
          try{
            await request("/platform/route-network/"+encodeURIComponent(route.departure)+"/"+encodeURIComponent(route.arrival),{
              method:"PUT",
              body:JSON.stringify({archived:!route.archived,reason:route.archived?"":"Archived from Admin Center"})
            });
            await loadRoutes();
          }catch(error){
            button.disabled=false;
            window.alert(error.message);
          }
        });
        row.lastElementChild.replaceChildren(button);
      });
      root.prepend(node("p","platform-admin-muted",(routes.length||0)+" routes found from actual NewSky-imported flights · Last sync: "+fmtDate(data.lastSyncedAt)));
    }catch(error){showError(root,error);}
  }
  async function loadAcademy(){
    const root=$("#platformAcademy");if(!root)return;
    try{const data=await request("/platform/admin/academy/courses");table(root,["Course","Category","Level","Lessons","Enrolled pilots","Visibility","Action"],(data.courses||[]).map(c=>[
      c.title,c.category,c.level,c.lesson_count,c.enrolled_pilots,c.published?"Published":"Hidden",c.published?"Unpublish":"Publish"
    ]));
    root.querySelectorAll("tbody tr").forEach((row,index)=>{const course=data.courses[index];if(!course)return;const button=node("button","admin-button secondary",course.published?"Unpublish":"Publish");button.type="button";button.addEventListener("click",async()=>{await request("/platform/admin/academy/courses/"+course.id,{method:"PATCH",body:JSON.stringify({published:!course.published})});loadAcademy();});row.lastElementChild.replaceChildren(button);});
    }catch(error){showError(root,error);}
  }
  async function loadView(name){
    if(name==="overview")return loadOverview();
    if(name==="operations")return loadOperations();
    if(name==="fleet")return loadFleet();
    if(name==="routes")return loadRoutes();
    if(name==="system")return loadSystem();
    if(name==="roles")return loadRoles();
    if(name==="audit")return loadAudit();
    if(name==="notifications")return loadNotifications();
    if(name==="academy")return loadAcademy();
  }
  const loadable=new Set(["overview","operations","routes","fleet","system","roles","audit","notifications","academy"]);
  document.addEventListener("click",event=>{
    const refresh=event.target.closest("[data-platform-refresh]");
    if(refresh&&loadable.has(refresh.dataset.platformRefresh))loadView(refresh.dataset.platformRefresh);
  });
  document.addEventListener("click",event=>{
    const tab=event.target.closest("[data-admin-tab]");if(!tab||!loadable.has(tab.dataset.adminTab))return;
    window.setTimeout(()=>loadView(tab.dataset.adminTab),0);
  });
  const dashboard=$("#adminDashboard");
  if(dashboard&&"MutationObserver"in window){
    const observer=new MutationObserver(()=>{
      if(!dashboard.hidden){
        session=window.EAGPlatformAdminSession||null;
        const active=document.querySelector("[data-admin-view]:not([hidden])");
        loadView(active?active.dataset.adminView:"overview");
      }
    });
    observer.observe(dashboard,{attributes:true,attributeFilter:["hidden"]});
  }
  $("#platformRoleForm")?.addEventListener("submit",async event=>{
    event.preventDefault();const status=$("#platformRoleStatus");status.textContent="";
    try{
      const result=await request("/platform/admin/roles",{method:"POST",body:JSON.stringify({username:$("#platformRoleUsername").value.trim(),role:$("#platformNewRole").value})});
      status.textContent=result.message;$("#platformRoleUsername").value="";await loadRoles();
    }catch(error){status.textContent=error.message;}
  });
  $("#platformNotificationForm")?.addEventListener("submit",async event=>{
    event.preventDefault();const status=$("#platformNotificationStatus");status.textContent="";
    try{
      const result=await request("/platform/admin/notifications",{method:"POST",body:JSON.stringify({title:$("#platformNotificationTitle").value,message:$("#platformNotificationMessage").value,level:$("#platformNotificationLevel").value})});
      status.textContent="Notification published.";event.target.reset();await loadNotifications();
    }catch(error){status.textContent=error.message;}
  });
  $("#platformCourseForm")?.addEventListener("submit",async event=>{
    event.preventDefault();const status=$("#platformCourseStatus");status.textContent="";
    try{
      const course=JSON.parse($("#platformCourseJson").value);
      const result=await request("/platform/admin/academy/courses",{method:"POST",body:JSON.stringify(course)});
      status.textContent=result.message||"Course created.";await loadAcademy();
    }catch(error){status.textContent=error instanceof SyntaxError?"The course JSON is not valid.":error.message;}
  });
})();
