
(() => {
  "use strict";
  const API = (window.ECHO_API_URL || "https://echo-air-group-api.onrender.com/api").replace(/\/$/, "");
  const TOKEN_KEY = "echo_token";
  const $ = selector => document.querySelector(selector);
  let token = localStorage.getItem(TOKEN_KEY) || "";
  let activeCourse = null;
  let coursePayload = null;
  function node(tag, className, value) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined) el.textContent = String(value);
    return el;
  }
  async function api(path, options = {}, auth = true) {
    const headers = { Accept:"application/json", ...(options.headers || {}) };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && token) headers.Authorization = "Bearer " + token;
    const response = await fetch(API + path, { ...options, headers, cache:"no-store" });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error:raw }; }
    if (!response.ok) {
      const error = new Error(data.error || "Request failed (" + response.status + ").");
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function showLogin(message) {
    $("#academyLogin").hidden = false;
    $("#academyWorkspace").hidden = true;
    $("#academyLoginStatus").textContent = message || "";
  }
  function showWorkspace() {
    $("#academyLogin").hidden = true;
    $("#academyWorkspace").hidden = false;
  }
  function renderProgress(data) {
    const target = $("#academyMyProgress");
    target.replaceChildren();
    const enrollments = data.enrollments || [];
    if (!enrollments.length) {
      target.textContent = "You have not enrolled in a course yet. Choose a course below to get started.";
    } else {
      const total = enrollments.length;
      const completed = enrollments.filter(item => item.status === "completed").length;
      target.appendChild(node("p","",completed + " of " + total + " enrolled courses completed."));
      enrollments.slice(0,6).forEach(item => {
        const row = node("div","academy-lesson");
        row.append(node("strong","",item.title),node("div","academy-muted",item.progress_percent + "% · " + (item.status === "completed" ? "Completed" : "In progress")));
        const bar = node("div","academy-progress"); const fill = node("span"); fill.style.width = item.progress_percent + "%"; bar.appendChild(fill); row.appendChild(bar);
        target.appendChild(row);
      });
    }
    const certs = $("#academyCertificates"); certs.replaceChildren();
    (data.certificates || []).forEach(certificate => {
      const card = node("div","academy-certificate");
      card.append(node("strong","",certificate.course_title),node("span","", "Certificate " + certificate.certificate_code + " · issued " + new Date(certificate.issued_at).toLocaleDateString("en-GB")));
      const link = node("a","academy-button secondary","Verify certificate");
      link.href = "academy.html?certificate=" + encodeURIComponent(certificate.certificate_code);
      card.appendChild(link); certs.appendChild(card);
    });
  }
  function renderCourses(courses) {
    const grid = $("#academyCourseGrid"); grid.replaceChildren();
    (courses || []).forEach(course => {
      const card = node("article","academy-course-card");
      card.append(node("span","academy-kicker",course.category),node("h3","",course.title),node("p","",course.description));
      const meta = node("div","academy-course-meta");
      [course.level,course.lesson_count + " lessons",course.duration_minutes + " min"].forEach(value => meta.appendChild(node("span","academy-chip",value)));
      card.appendChild(meta);
      const percent = Number(course.progress_percent || 0);
      if (course.enrollment_status) {
        const progress = node("div","academy-progress");const fill=node("span");fill.style.width=percent+"%";progress.appendChild(fill);card.appendChild(progress);
        card.appendChild(node("span","academy-muted",percent+"% complete · "+(course.enrollment_status==="completed"?"Certificate earned":"In progress")));
      } else card.appendChild(node("span","academy-muted","Not started"));
      const button = node("button","academy-button primary",course.enrollment_status ? "Open course" : "Start course");
      button.type = "button"; button.addEventListener("click",()=>openCourse(course.slug,course.id));
      card.appendChild(button); grid.appendChild(card);
    });
  }
  async function loadPortal() {
    try {
      const [catalog, progress] = await Promise.all([api("/platform/academy/catalog"),api("/platform/academy/me")]);
      $("#academyWelcome").textContent = "Welcome, " + (window.ECHO_PILOT_NAME || "Pilot");
      renderProgress(progress);
      renderCourses(catalog.courses || []);
      showWorkspace();
    } catch (error) {
      if (error.status === 401) {
        localStorage.removeItem(TOKEN_KEY); token = ""; showLogin("Your pilot session expired. Sign in again with your Pilot Dashboard credentials.");
      } else showLogin(error.message);
    }
  }
  async function openCourse(slug, courseId) {
    const detail = $("#academyCourseDetail");
    detail.hidden = false;
    detail.replaceChildren(node("p","academy-muted","Loading course…"));
    activeCourse = slug;
    try {
      const data = await api("/platform/academy/courses/" + encodeURIComponent(slug));
      coursePayload = data;
      renderCourseDetail(data,courseId);
      detail.scrollIntoView({ behavior:"smooth", block:"start" });
    } catch(error) {
      detail.replaceChildren(node("div","academy-notice",error.message));
    }
  }
  function renderCourseDetail(data,courseId) {
    const target=$("#academyCourseDetail");target.replaceChildren();
    const course=data.course;
    target.append(node("span","academy-kicker",course.category),node("h2","",course.title),node("p","academy-muted",course.description));
    const started = document.createElement("button");
    started.className="academy-button secondary";started.type="button";started.textContent="Enrol in this course";
    started.addEventListener("click",async()=>{
      try{await api("/platform/academy/courses/"+courseId+"/enroll",{method:"POST",body:"{}"});await loadPortal();await openCourse(course.slug,courseId);}
      catch(error){target.prepend(node("p","academy-notice",error.message));}
    });
    if (!data.certificate) target.appendChild(started);
    target.appendChild(node("h3","","Lessons"));
    const completed=new Set((data.completedLessonIds||[]).map(Number));
    (data.lessons||[]).forEach(lesson=>{
      const card=node("article","academy-lesson");
      card.append(node("h3","",lesson.sort_order+". "+lesson.title),node("div","academy-lesson-body",lesson.lesson_body));
      const action=node("button","academy-button "+(completed.has(Number(lesson.id))?"secondary":"primary"),completed.has(Number(lesson.id))?"Lesson completed":"Mark lesson completed");
      action.type="button";action.disabled=completed.has(Number(lesson.id));
      action.addEventListener("click",async()=>{
        action.disabled=true;
        try{await api("/platform/academy/lessons/"+lesson.id+"/complete",{method:"POST",body:"{}"});await openCourse(course.slug,courseId);await loadPortal();}
        catch(error){action.disabled=false;card.appendChild(node("p","academy-notice",error.message));}
      });
      card.appendChild(action);target.appendChild(card);
    });
    if (data.quiz) {
      const quizBox=node("div","academy-lesson");
      quizBox.append(node("h3","",data.quiz.title),node("p","academy-muted","Pass mark: "+data.quiz.pass_percent+"%. Select one answer for each question."));
      const form=document.createElement("form");
      (data.quiz.questions||[]).forEach((question,index)=>{
        const block=node("div","academy-quiz-question");
        block.appendChild(node("h4","", (index+1)+". "+question.prompt));
        (question.options||[]).forEach((option,optionIndex)=>{
          const label=node("label","academy-option");
          const radio=document.createElement("input");radio.type="radio";radio.name="question-"+question.id;radio.value=String(optionIndex);radio.required=true;
          label.append(radio,node("span","",option));block.appendChild(label);
        });
        form.appendChild(block);
      });
      const button=node("button","academy-button primary","Submit knowledge check");button.type="submit";
      form.appendChild(button);
      const resultBox=node("div","academy-result");resultBox.hidden=true;
      form.addEventListener("submit",async event=>{
        event.preventDefault();button.disabled=true;
        const answers={};
        (data.quiz.questions||[]).forEach(question=>{
          const selected=form.querySelector('input[name="question-'+question.id+'"]:checked');
          if(selected)answers[question.id]=Number(selected.value);
        });
        try{
          const result=await api("/platform/academy/quizzes/"+data.quiz.id+"/attempt",{method:"POST",body:JSON.stringify({answers})});
          resultBox.hidden=false;
          resultBox.replaceChildren(node("strong","",result.passed?"Knowledge check passed":"Knowledge check not passed yet"),node("p","",result.scorePercent+"% · "+result.correctCount+" of "+result.questionCount+" correct. Pass mark: "+result.passPercent+"%."));
          if(result.review){result.review.forEach(item=>{const question=(data.quiz.questions||[]).find(q=>Number(q.id)===Number(item.questionId));const line=node("p","", (item.correct?"✓ ":"✕ ")+(question?question.prompt:"Question")+" — "+item.explanation);resultBox.appendChild(line);});}
          if(result.certificate) resultBox.appendChild(node("p","","Certificate earned: "+result.certificate.certificate_code));
          await loadPortal();
          await openCourse(course.slug,courseId);
          target.querySelector(".academy-result")?.replaceWith(resultBox);
        }catch(error){resultBox.hidden=false;resultBox.textContent=error.message;}
        finally{button.disabled=false;}
      });
      quizBox.appendChild(form);quizBox.appendChild(resultBox);target.appendChild(quizBox);
    }
    if (data.certificate) {
      const cert=node("div","academy-certificate");
      cert.append(node("strong","", "Course certificate awarded"),node("span","",data.certificate.certificate_code));
      const link=node("a","academy-button secondary","Verify certificate");link.href="academy.html?certificate="+encodeURIComponent(data.certificate.certificate_code);
      cert.appendChild(link);target.appendChild(cert);
    }
  }
  async function verifyCertificate(code) {
    const panel=$("#academyCertificateVerification");panel.hidden=false;
    try{
      const result=await api("/platform/academy/certificates/"+encodeURIComponent(code),{},false);
      panel.replaceChildren(node("span","academy-kicker","Certificate verification"),node("h2","",result.valid?"Valid Echo Air Group certificate":"Certificate not found"),node("p","academy-muted",result.certificate.course+" · "+result.certificate.pilot+" · issued "+new Date(result.certificate.issuedAt).toLocaleDateString("en-GB")),node("p","academy-chip",result.certificate.code));
    }catch(error){panel.replaceChildren(node("h2","", "Certificate could not be verified"),node("p","academy-muted",error.message));}
  }
  $("#academyLoginForm").addEventListener("submit",async event=>{
    event.preventDefault();
    const button=$("#academyLoginButton");button.disabled=true;$("#academyLoginStatus").textContent="Signing in…";
    try{
      const result=await api("/auth/login",{method:"POST",body:JSON.stringify({username:$("#academyUsername").value.trim(),password:$("#academyPassword").value})},false);
      if(!result.token)throw new Error("The login response did not include a session token.");
      token=result.token;localStorage.setItem(TOKEN_KEY,token);$("#academyPassword").value="";await loadPortal();
    }catch(error){$("#academyLoginStatus").textContent=error.message;}
    finally{button.disabled=false;}
  });
  $("#academyLogout").addEventListener("click",()=>{localStorage.removeItem(TOKEN_KEY);token="";activeCourse=null;coursePayload=null;showLogin("You have signed out of the Aviation Academy.");});
  const certificateCode=new URLSearchParams(window.location.search).get("certificate");
  if(certificateCode)verifyCertificate(certificateCode);
  if(token)loadPortal();else showLogin();
})();
