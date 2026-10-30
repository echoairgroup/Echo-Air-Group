
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
      const summary=node("div","academy-progress-overview");
      const attempts=data.recentAttempts||[];
      const passed=attempts.filter(item=>item.passed&&item.examiner_decision==="verified").length;
      const pending=attempts.filter(item=>!item.examiner_decision).length;
      [[completed+" / "+total,"Courses completed"],[(data.certificates||[]).length,"Certificates"],[passed,"Verified exams"],[pending,"Awaiting examiner"]].forEach(item=>{const tile=node("div","academy-progress-stat");tile.append(node("strong","",item[0]),node("span","",item[1]));summary.appendChild(tile);});
      target.appendChild(summary);
      target.appendChild(node("p","",completed + " of " + total + " enrolled courses completed."));
      enrollments.slice(0,6).forEach(item => {
        const row = node("div","academy-lesson");
        row.append(node("strong","",item.title),node("div","academy-muted",item.progress_percent + "% · " + (item.status === "completed" ? "Completed" : "In progress")));
        const bar = node("div","academy-progress"); const fill = node("span"); fill.style.width = item.progress_percent + "%"; bar.appendChild(fill); row.appendChild(bar);
        target.appendChild(row);
      });
    }
    const attempts=data.recentAttempts||[];
    if(attempts.length){
      const examPanel=node("div","academy-exam-history");
      examPanel.appendChild(node("h3","","Recent theory exam results"));
      attempts.slice(0,8).forEach(attempt=>{
        const item=node("div","academy-exam-history-row");
        const title=node("strong","",attempt.course_title+" · "+attempt.quiz_title);
        const score=node("span","academy-chip",attempt.score_percent+"% · "+(attempt.passed?"Quiz passed":"Retake quiz"));
        const decision=attempt.examiner_decision==="verified"?" · Examiner verified":attempt.examiner_decision==="retake_required"?" · Retake required":" · Awaiting examiner";
        item.append(title,score,node("p","academy-muted",new Date(attempt.attempted_at).toLocaleDateString("en-GB")+decision));
        if(attempt.examiner_feedback)item.appendChild(node("p","academy-notice","Examiner feedback: "+attempt.examiner_feedback));
        examPanel.appendChild(item);
      });
      target.appendChild(examPanel);
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
      const [catalog, progress, training] = await Promise.all([
        api("/platform/academy/catalog"),
        api("/platform/academy/me"),
        api("/platform/academy/training-flights")
      ]);
      $("#academyWelcome").textContent = "Welcome, " + (window.ECHO_PILOT_NAME || "Pilot");
      renderProgress(progress);
      renderCourses(catalog.courses || []);
      renderTrainingFlights(training, catalog.courses || []);
      showWorkspace();
      window.dispatchEvent(new CustomEvent("eag:academy-portal-ready",{detail:{catalog,progress,training}}));
    } catch (error) {
      if (error.status === 401) {
        localStorage.removeItem(TOKEN_KEY); token = ""; showLogin("Your pilot session expired. Sign in again with your Pilot Dashboard credentials.");
      } else showLogin(error.message);
    }
  }
  function renderTrainingFlights(data, courses) {
    const root = $("#academyTrainingFlights");
    if (!root) return;
    root.replaceChildren();
    const recent = Array.isArray(data.recentFlights) ? data.recentFlights : [];
    const recorded = Array.isArray(data.recordedTrainingFlights) ? data.recordedTrainingFlights : [];
    root.appendChild(node("p", "academy-muted", recorded.length + " training flight(s) recorded · " + recent.length + " recent NewSky flight(s) available."));
    if (recorded.length) {
      const history = node("div", "academy-training-history");
      history.appendChild(node("h3", "", "Recorded training flights"));
      recorded.forEach(item => {
        const card = node("article", "academy-training-record");
        const route = (item.dep_icao || "Unknown") + " → " + (item.arr_icao || "Unknown");
        card.append(
          node("strong", "", route),
          node("span", "academy-chip", item.course_title || "General simulator practice"),
          node("p", "academy-muted", (item.aircraft_registration ? item.aircraft_registration + " · " : "") + (item.aircraft || "Aircraft not supplied") + " · " + (item.dep_time ? new Date(item.dep_time).toLocaleDateString("en-GB") : "Date unavailable"))
        );
        if (item.objective) card.appendChild(node("p", "", "Objective: " + item.objective));
        if (item.reflection) card.appendChild(node("p", "academy-muted", "Reflection: " + item.reflection));
        const status=item.review_status||"pending";
        card.appendChild(node("span","academy-review-chip "+status,status==="approved"?"Instructor approved":status==="needs_practice"?"More practice requested":"Awaiting instructor review"));
        if(item.review_feedback)card.appendChild(node("p","academy-notice","Instructor feedback: "+item.review_feedback));
        history.appendChild(card);
      });
      root.appendChild(history);
    }
    const heading = node("h3", "", "Recent flights from NewSky");
    root.appendChild(heading);
    if (!recent.length) {
      root.appendChild(node("p", "academy-muted", "No imported NewSky flights were found for this pilot yet. Link your NewSky pilot ID in the Pilot Dashboard and complete a flight to populate this list."));
      return;
    }
    const grid = node("div", "academy-training-grid");
    recent.forEach(flight => {
      const card = node("article", "academy-training-card");
      const route = (flight.dep_icao || "Unknown") + " → " + (flight.arr_icao || "Unknown");
      const alreadyLogged = Boolean(flight.training_record_id);
      card.append(
        node("div", "academy-training-route", route),
        node("p", "academy-muted", (flight.aircraft_registration ? flight.aircraft_registration + " · " : "") + (flight.aircraft || "Aircraft not supplied")),
        node("p", "academy-muted", (flight.dep_time ? new Date(flight.dep_time).toLocaleDateString("en-GB") : "Date unavailable") +
          (flight.duration != null ? " · " + Math.round(Number(flight.duration)) + " min" : "") +
          (flight.distance != null ? " · " + Math.round(Number(flight.distance)) + " km" : ""))
      );
      const form = document.createElement("form");
      form.className = "academy-training-form";
      const courseField = node("div", "academy-field");
      const courseLabel = document.createElement("label");
      courseLabel.textContent = "Link to an Academy course";
      const courseSelect = document.createElement("select");
      courseSelect.name = "courseId";
      const noCourse = document.createElement("option");
      noCourse.value = "";
      noCourse.textContent = "General practice";
      courseSelect.appendChild(noCourse);
      (courses || []).forEach(course => {
        const option = document.createElement("option");
        option.value = String(course.id);
        option.textContent = course.title;
        if (String(course.id) === String(flight.course_id || "")) option.selected = true;
        courseSelect.appendChild(option);
      });
      courseLabel.appendChild(courseSelect);
      courseField.appendChild(courseLabel);
      const objectiveField = node("div", "academy-field");
      const objectiveLabel = document.createElement("label");
      objectiveLabel.textContent = "Training objective";
      const objective = document.createElement("input");
      objective.type = "text";
      objective.maxLength = 240;
      objective.placeholder = "e.g. practice a stabilized ILS approach";
      objective.value = flight.objective || "";
      objectiveLabel.appendChild(objective);
      objectiveField.appendChild(objectiveLabel);
      const reflectionField = node("div", "academy-field academy-training-reflection");
      const reflectionLabel = document.createElement("label");
      reflectionLabel.textContent = "Post-flight reflection";
      const reflection = document.createElement("textarea");
      reflection.rows = 3;
      reflection.maxLength = 3000;
      reflection.placeholder = "What went well? What would you improve next time?";
      reflection.value = flight.reflection || "";
      reflectionLabel.appendChild(reflection);
      reflectionField.appendChild(reflectionLabel);
      const actionRow = node("div", "academy-actions");
      const save = node("button", "academy-button primary", alreadyLogged ? "Update training record" : "Record as training flight");
      save.type = "submit";
      actionRow.appendChild(save);
      if (alreadyLogged) {
        const remove = node("button", "academy-button secondary", "Remove training mark");
        remove.type = "button";
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          try {
            await api("/platform/academy/training-flights/" + flight.training_record_id, { method:"DELETE" });
            const refreshed = await api("/platform/academy/training-flights");
            renderTrainingFlights(refreshed, courses);
          } catch (error) {
            remove.disabled = false;
            card.appendChild(node("p", "academy-notice", error.message));
          }
        });
        actionRow.appendChild(remove);
      }
      const status = node("p", "academy-notice", "");
      form.append(courseField, objectiveField, reflectionField, actionRow, status);
      form.addEventListener("submit", async event => {
        event.preventDefault();
        save.disabled = true;
        status.textContent = "Saving training record…";
        try {
          await api("/platform/academy/training-flights", {
            method:"POST",
            body:JSON.stringify({
              flightId:flight.id,
              courseId:courseSelect.value || null,
              objective:objective.value,
              reflection:reflection.value
            })
          });
          const refreshed = await api("/platform/academy/training-flights");
          renderTrainingFlights(refreshed, courses);
        } catch (error) {
          status.textContent = error.message;
          save.disabled = false;
        }
      });
      card.appendChild(form);
      grid.appendChild(card);
    });
    root.appendChild(grid);
    root.appendChild(node("p", "academy-notice", "Flight details are imported from your linked NewSky account. This log adds a personal training purpose and reflection; it does not change the original NewSky flight."));
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
