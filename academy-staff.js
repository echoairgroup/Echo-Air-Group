(() => {
  "use strict";
  const API=(window.ECHO_API_URL||"https://echo-air-group-api.onrender.com/api").replace(/\/$/,"");
  const $=s=>document.querySelector(s);
  const node=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value);return n;};
  async function api(path,options){
    const token=localStorage.getItem("echo_token");
    if(!token)throw new Error("No pilot session.");
    const opts=options||{},headers={Accept:"application/json",Authorization:"Bearer "+token,...(opts.body?{"Content-Type":"application/json"}:{})};
    const response=await fetch(API+path,{...opts,headers,cache:"no-store"});
    const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{};}catch(_){}
    if(!response.ok){const error=new Error(data.error||"Staff request failed ("+response.status+").");error.status=response.status;throw error;}
    return data;
  }
  function reviewCard(title,meta,details,feedback,buttons,onSubmit){
    const card=node("article","academy-staff-card");
    card.append(node("h4","",title),node("div","academy-staff-meta",meta));
    (details||[]).forEach(value=>card.appendChild(node("p","",value)));
    const label=node("label","","Review feedback");
    const textarea=document.createElement("textarea");textarea.maxLength=1200;textarea.placeholder="Add constructive feedback for the pilot…";textarea.value=feedback||"";
    const actions=node("div","academy-staff-actions");
    buttons.forEach(button=>{
      const b=node("button",button.secondary?"secondary":"",button.label);b.type="button";
      b.addEventListener("click",async()=>{b.disabled=true;actions.querySelectorAll("button").forEach(x=>x.disabled=true);try{await onSubmit(button.value,textarea.value);await loadQueues();}catch(error){card.appendChild(node("p","academy-staff-error",error.message));actions.querySelectorAll("button").forEach(x=>x.disabled=false);}});
      actions.appendChild(b);
    });
    card.append(label,textarea,actions);return card;
  }
  async function loadInstructor(){
    const root=$("#academyInstructorQueue");
    try{
      const data=await api("/platform/academy/instructor/queue");
      const section=node("section","academy-staff-section");section.appendChild(node("h3","","Practical flight assessments"));
      const items=data.assessments||[];
      if(!items.length)section.appendChild(node("div","academy-staff-empty","There are no practical training flights awaiting review."));
      const grid=node("div","academy-staff-queue");
      items.forEach(item=>{
        const route=(item.dep_icao||"Unknown")+" → "+(item.arr_icao||"Unknown");
        const details=[
          "Course: "+item.course_title,
          "Flight: "+route+" · "+(item.aircraft_registration?item.aircraft_registration+" · ":"")+(item.aircraft||"Aircraft not supplied"),
          "Date: "+(item.dep_time?new Date(item.dep_time).toLocaleDateString("en-GB"):"Unavailable")+" · Duration: "+(item.duration==null?"—":Math.round(Number(item.duration))+" min")+" · Distance: "+(item.distance==null?"—":Math.round(Number(item.distance))+" km"),
          "Training objective: "+(item.objective||"Not supplied"),
          "Pilot reflection: "+(item.reflection||"Not supplied")
        ];
        grid.appendChild(reviewCard(item.pilot_name||item.username,"Pilot @"+item.username+" · Submitted "+new Date(item.created_at).toLocaleDateString("en-GB"),details,item.review_feedback,[
          {label:"Approve practical",value:"approved"},
          {label:"More practice needed",value:"needs_practice",secondary:true}
        ],async(status,feedback)=>{
          await api("/platform/academy/instructor/queue/"+item.training_id,{method:"PATCH",body:JSON.stringify({status,feedback})});
        }));
      });
      if(items.length)section.appendChild(grid);
      root.replaceChildren(section);return true;
    }catch(error){if(error.status===403)return false;root.replaceChildren(node("div","academy-staff-error",error.message));return true;}
  }
  async function loadExaminer(){
    const root=$("#academyExaminerQueue");
    try{
      const data=await api("/platform/academy/examiner/queue");
      const section=node("section","academy-staff-section");section.appendChild(node("h3","","Theory exam reviews"));
      const items=data.attempts||[];
      if(!items.length)section.appendChild(node("div","academy-staff-empty","There are no theory attempts in the examiner review window."));
      const grid=node("div","academy-staff-queue");
      items.forEach(item=>{
        const decision=item.decision==="verified"?"Verified by examiner":item.decision==="retake_required"?"Retake required":"Awaiting examiner";
        const details=[
          "Course: "+item.course_title+" · "+item.quiz_title,
          "Score: "+item.score_percent+"% · "+item.correct_count+" of "+item.question_count+" correct · "+(item.passed?"Quiz pass mark reached":"Quiz pass mark not reached"),
          "Attempted: "+new Date(item.attempted_at).toLocaleString("en-GB"),
          "Current decision: "+decision+(item.feedback?" · "+item.feedback:"")
        ];
        grid.appendChild(reviewCard(item.pilot_name||item.username,"Pilot @"+item.username+" · "+item.course_title,details,item.feedback,[
          {label:"Verify exam",value:"verified"},
          {label:"Request retake",value:"retake_required",secondary:true}
        ],async(decisionValue,feedback)=>{
          await api("/platform/academy/examiner/queue/"+item.attempt_id,{method:"PATCH",body:JSON.stringify({decision:decisionValue,feedback})});
        }));
      });
      if(items.length)section.appendChild(grid);
      root.replaceChildren(section);return true;
    }catch(error){if(error.status===403)return false;root.replaceChildren(node("div","academy-staff-error",error.message));return true;}
  }
  let loading=false;
  async function loadQueues(){
    if(loading)return;loading=true;
    const panel=$("#academyStaffPanel");
    if(!panel){loading=false;return;}
    try{
      const results=await Promise.all([loadInstructor(),loadExaminer()]);
      panel.hidden=!results.some(Boolean);
    }finally{loading=false;}
  }
  window.addEventListener("eag:academy-portal-ready",()=>{void loadQueues();});
})();
