(() => {
  "use strict";
  const API=(window.ECHO_API_URL||"https://echo-air-group-api.onrender.com/api").replace(/\/$/,"");
  const TOKEN_KEY="echo_token";
  const $=s=>document.querySelector(s);
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
  let mountStarted=false,avatarData=null,removeAvatar=false,profile=null;
  async function request(path,options){
    const token=localStorage.getItem(TOKEN_KEY);
    if(!token)throw new Error("Sign in to your Pilot Dashboard to edit your profile.");
    const headers={Accept:"application/json",Authorization:"Bearer "+token,...((options&&options.body)?{"Content-Type":"application/json"}:{})};
    const response=await fetch(API+path,{...(options||{}),headers,cache:"no-store"});
    const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{};}catch(_){}
    if(!response.ok)throw new Error(data.error||"Profile request failed ("+response.status+").");
    return data;
  }
  function makeField(labelText,control,full){
    const wrapper=node("div",full?"full":"");const label=node("label","",labelText);wrapper.append(label,control);return wrapper;
  }
  function compressImage(file){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error("Could not read the selected image."));
      reader.onload=()=>{
        const image=new Image();
        image.onerror=()=>reject(new Error("The selected file is not a valid image."));
        image.onload=()=>{
          const scale=Math.min(1,512/Math.max(image.width,image.height));
          const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
          const ctx=canvas.getContext("2d");if(!ctx)return reject(new Error("Image editing is not available in this browser."));
          ctx.fillStyle="#ffffff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
          const data=canvas.toDataURL("image/jpeg",.82);
          if(data.length>1400000)return reject(new Error("This photo is still too large. Please choose a smaller image."));
          resolve(data);
        };
        image.src=String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }
  async function mount(){
    if(mountStarted)return;mountStarted=true;
    const dashboard=$("#dashboard");if(!dashboard)return;
    const section=node("section","pilot-profile-settings");
    section.appendChild(node("div","pilot-profile-settings-head"));
    const head=section.querySelector(".pilot-profile-settings-head");
    const intro=node("div","");
    intro.append(node("h2","","Your pilot profile"),node("p","","Personalise your profile with a photo and a short introduction. Flight totals and rank are calculated automatically from verified NewSky records."));
    const publicLink=node("a","pilot-profile-settings-link","View public profile ↗");publicLink.href="pilot.html";publicLink.target="_blank";publicLink.rel="noopener";
    head.append(intro,publicLink);
    const form=document.createElement("form");form.className="pilot-profile-settings-grid";
    const photoBox=node("div","pilot-profile-photo-box");
    const preview=node("div","pilot-profile-photo-preview","✈");preview.setAttribute("aria-label","Profile photo preview");
    const file=document.createElement("input");file.type="file";file.accept="image/jpeg,image/png,image/webp";file.hidden=true;
    const choose=node("button","secondary","Choose photo");choose.type="button";choose.addEventListener("click",()=>file.click());
    photoBox.append(preview,choose,file);
    const fields=node("div","pilot-profile-settings-fields");
    const name=document.createElement("input");name.type="text";name.maxLength=60;name.required=true;name.autocomplete="nickname";
    const bio=document.createElement("textarea");bio.maxLength=400;bio.rows=4;bio.placeholder="Tell other Echo pilots a little about yourself…";
    const status=node("p","pilot-profile-settings-status");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
    const actions=node("div","pilot-profile-settings-actions");
    const save=node("button","","Save profile");save.type="submit";
    const remove=node("button","secondary","Remove photo");remove.type="button";
    const note=node("p","pilot-profile-settings-note full","Your flight history, stars, achievements and rank cannot be edited here. They are based on flights imported from your linked NewSky account.");
    fields.append(makeField("Display name",name,false),makeField("Profile photo",file,false),makeField("About you",bio,true),note,status,actions);
    actions.append(save,remove);
    form.append(photoBox,fields);
    section.appendChild(form);
    dashboard.appendChild(section);
    file.addEventListener("change",async()=>{
      const selected=file.files&&file.files[0];if(!selected)return;
      if(!["image/jpeg","image/png","image/webp"].includes(selected.type)){status.textContent="Choose a JPG, PNG or WebP image.";file.value="";return;}
      try{
        status.textContent="Preparing photo…";avatarData=await compressImage(selected);removeAvatar=false;preview.replaceChildren();
        const image=document.createElement("img");image.src=avatarData;image.alt="Selected profile photo";preview.appendChild(image);status.textContent="Photo ready to save.";
      }catch(error){status.textContent=error.message;file.value="";}
    });
    remove.addEventListener("click",()=>{
      avatarData=null;removeAvatar=true;file.value="";preview.textContent=profile&&profile.username?profile.username.slice(0,2).toUpperCase():"✈";preview.style.backgroundImage="none";status.textContent="Photo will be removed when you save.";
    });
    form.addEventListener("submit",async event=>{
      event.preventDefault();save.disabled=true;status.textContent="Saving profile…";
      try{
        const payload={displayName:name.value.trim(),bio:bio.value,removeAvatar};
        if(avatarData)payload.avatarData=avatarData;
        const result=await request("/platform/pilot/profile",{method:"PATCH",body:JSON.stringify(payload)});
        profile=result.pilot||profile;avatarData=null;removeAvatar=false;
        status.textContent="Profile saved. Public profile updated.";
        await loadProfile(false);
      }catch(error){status.textContent=error.message;}
      finally{save.disabled=false;}
    });
    async function loadProfile(showErrors=true){
      try{
        const data=await request("/platform/pilot/profile");profile=data.pilot||{};
        name.value=profile.displayName||"";bio.value=profile.bio||"";
        if(profile.avatarUrl){
          preview.replaceChildren();const image=document.createElement("img");image.src=API+profile.avatarUrl+"?v="+Date.now();image.alt="Your current profile photo";preview.appendChild(image);
        }else{preview.textContent=(profile.displayName||profile.username||"P").slice(0,2).toUpperCase();preview.style.backgroundImage="none";}
        publicLink.href="pilot.html?id="+encodeURIComponent(profile.id);
        remove.hidden=!profile.hasAvatar;
      }catch(error){if(showErrors)status.textContent=error.message;}
    }
    await loadProfile();
  }
  function maybeMount(){
    const dashboard=$("#dashboard");
    if(!dashboard||mountStarted)return;
    if(dashboard.style.display==="block"||(!dashboard.style.display&&getComputedStyle(dashboard).display!=="none"))void mount();
  }
  const dashboard=$("#dashboard");
  if(dashboard){
    const observer=new MutationObserver(maybeMount);observer.observe(dashboard,{attributes:true,attributeFilter:["style","class"]});
    maybeMount();
  }
  document.addEventListener("visibilitychange",maybeMount);
})();
