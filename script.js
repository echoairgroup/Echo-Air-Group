function initEchoAirGroupShell() {
  if (window.__eagSiteShellLoaded || !document.body) return;
  window.__eagSiteShellLoaded = true;

  var mainLinks = [
    { href: "index.html", label: "Home", file: "index.html" },
    { href: "about.html", label: "About", file: "about.html" },
    { href: "fleet.html", label: "Fleet", file: "fleet.html" },
    { href: "routes.html", label: "Routes", file: "routes.html" },
    { href: "team.html", label: "Team", file: "team.html" },
    { href: "manual.html", label: "Pilot manual", file: "manual.html" },
    { href: "ranking.html", label: "Ranking", file: "ranking.html" },
    { href: "booking.html", label: "Book a flight", file: "booking.html" },
    { href: "contact.html", label: "Contact", file: "contact.html" }
  ];
  var exploreLinks = [
    { href: "about.html", label: "About" },
    { href: "fleet.html", label: "Fleet" },
    { href: "routes.html", label: "Route network" },
    { href: "team.html", label: "Our team" },
    { href: "index.html#news", label: "Latest news" }
  ];
  var pilotLinks = [
    { href: "join.html", label: "Join the airline" },
    { href: "booking.html", label: "Virtual bookings" },
    { href: "ranking.html", label: "Pilot ranking" },
    { href: "manual.html", label: "Pilot manual" },
    { href: "contact.html", label: "Get in touch" }
  ];
  var currentPage = window.location.pathname.split("/").pop() || "index.html";
  if (currentPage.indexOf(".") === -1) currentPage = "index.html";

  function brandMarkup() {
    return '<a class="site-brand" href="index.html" aria-label="Echo Air Group home">' +
      '<span class="site-brand-mark" aria-hidden="true">EAG<span></span></span>' +
      '<span class="site-brand-copy"><strong>ECHO AIR GROUP</strong>' +
      '<small>VIRTUAL AIRLINE <i aria-hidden="true"></i> ECV</small></span></a>';
  }
  function renderLinks(items, extraClass) {
    return items.map(function (item) {
      var active = item.file === currentPage;
      return '<a class="site-nav-link' + (active ? ' is-active' : '') +
        (extraClass ? ' ' + extraClass : '') + '" href="' + item.href + '"' +
        (active ? ' aria-current="page"' : '') + '>' + item.label + '</a>';
    }).join("");
  }
  var headerHtml =
    '<header id="siteHeader" class="site-header">' +
      '<div class="site-header-inner">' + brandMarkup() +
        '<nav class="site-navlinks" aria-label="Main navigation">' + renderLinks(mainLinks, "") + '</nav>' +
        '<div class="site-header-actions">' +
          '<a class="site-join" href="join.html">Join the airline <span aria-hidden="true">↗</span></a>' +
          '<button class="site-menu-toggle" id="menuButton" type="button" aria-label="Open navigation menu" ' +
            'aria-expanded="false" aria-controls="mobileNav" onclick="toggleSiteMenu()">' +
            '<span class="site-menu-glyph" aria-hidden="true"><i></i><i></i><i></i></span></button>' +
        '</div>' +
      '</div>' +
      '<div class="site-mobile-nav" id="mobileNav" aria-label="Mobile navigation" aria-hidden="true">' +
        '<div class="site-mobile-inner"><p class="site-mobile-kicker">Explore Echo Air Group</p>' +
          '<nav class="site-mobile-grid" aria-label="Mobile navigation links">' +
            renderLinks(mainLinks, "site-mobile-link") +
            '<a class="site-mobile-link site-mobile-join" href="join.html">Join the airline <span aria-hidden="true">↗</span></a>' +
          '</nav><p class="site-mobile-note">Fly beyond the ordinary. <span>6L · ECV · CLOVER</span></p>' +
        '</div>' +
      '</div>' +
    '</header>';
  var footerHtml =
    '<footer class="site-footer"><div class="site-footer-glow" aria-hidden="true"></div>' +
      '<div class="site-footer-inner"><div class="site-footer-main">' +
        '<div class="site-footer-intro">' + brandMarkup() +
          '<p>Virtual aviation. Real passion. A community built for pilots who love the world of flight simulation.</p>' +
          '<a class="site-discord-link" href="https://discord.gg/e7ePxYA24" target="_blank" rel="noopener noreferrer">' +
            '<span class="site-discord-icon" aria-hidden="true">↗</span> Join our Discord community</a>' +
        '</div>' +
        '<div class="site-footer-column"><h2>Explore</h2>' +
          exploreLinks.map(function (x) { return '<a href="' + x.href + '">' + x.label + '</a>'; }).join("") +
        '</div>' +
        '<div class="site-footer-column"><h2>For pilots</h2>' +
          pilotLinks.map(function (x) { return '<a href="' + x.href + '">' + x.label + '</a>'; }).join("") +
        '</div>' +
      '</div><div class="site-footer-bottom">' +
        '<span>© ' + new Date().getFullYear() + ' Echo Air Group. Virtual airline.</span>' +
        '<span class="site-footer-legal"><a href="privacy.html">Privacy</a><a href="legal.html">Legal notice</a></span>' +
        '<span>Not affiliated with any real-world airline.</span>' +
      '</div></div></footer>';

  function replaceOrInsert(selector, html, atStart) {
    var current = document.querySelector(selector);
    var template = document.createElement("template");
    template.innerHTML = html;
    var replacement = template.content.firstElementChild;
    if (current) current.replaceWith(replacement);
    else if (atStart) document.body.insertBefore(replacement, document.body.firstChild);
    else document.body.appendChild(replacement);
  }
  replaceOrInsert("body > header, body header", headerHtml, true);
  replaceOrInsert("body > footer, body footer", footerHtml, false);

  function setMenuOpen(open) {
    var menu = document.getElementById("mobileNav");
    var button = document.getElementById("menuButton");
    if (!menu || !button) return;
    menu.classList.toggle("open", Boolean(open));
    menu.setAttribute("aria-hidden", String(!open));
    button.setAttribute("aria-expanded", String(Boolean(open)));
    button.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
  }
  window.toggleSiteMenu = function () {
    var menu = document.getElementById("mobileNav");
    setMenuOpen(!(menu && menu.classList.contains("open")));
  };
  document.addEventListener("click", function (event) {
    var link = event.target.closest("#mobileNav a");
    if (link) setMenuOpen(false);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") setMenuOpen(false);
  });
  window.addEventListener("resize", function () {
    if (window.innerWidth > 1120) setMenuOpen(false);
  });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initEchoAirGroupShell, { once: true });
} else {
  initEchoAirGroupShell();
}

function toggleMenu(){document.getElementById('mobileNav')?.classList.toggle('open')}
function filterRoutes(type){document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x.dataset.filter===type));document.querySelectorAll('.route-row[data-type]').forEach(x=>x.style.display=(type==='all'||x.dataset.type===type)?'grid':'none')}
function showLang(lang){document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.lang===lang));document.querySelectorAll('.lang-panel').forEach(x=>x.style.display=x.dataset.lang===lang?'block':'none')}

const ECHO_API_BASE = (window.ECHO_API_URL || 'https://echo-air-group-api.onrender.com/api').replace(/\/+$/, '');

function setApplicationStatus(message, isError = false) {
  const status = document.getElementById('applicationStatus');
  if (!status) return;
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('error', isError);
}

async function submitApplication(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"], input[type="submit"]');
  const originalLabel = submit ? (submit.textContent || submit.value || 'Submit Pilot Application') : '';
  if (submit) {
    submit.disabled = true;
    if (submit.tagName === 'INPUT') submit.value = 'Submitting…';
    else submit.textContent = 'Submitting…';
  }

  const value = (id) => document.getElementById(id)?.value?.trim() || '';
  const payload = {
    firstName: value('first_name'),
    lastName: value('last_name'),
    age: Number(value('age')),
    country: value('country'),
    email: value('email'),
    discord: value('discord'),
    simulator: value('simulator'),
    experience: value('experience'),
    flightHours: Number(value('flight_hours')),
    network: value('network'),
    reason: value('reason'),
    privacyAcknowledged: Boolean(document.getElementById('privacyAcknowledged')?.checked)
  };

  try {
    const response = await fetch(ECHO_API_BASE + '/applications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({ error: 'The service returned an invalid response.' }));
    if (!response.ok) throw new Error(result.error || 'The application could not be submitted.');

    form.reset();
    setApplicationStatus('Thank you! Your application was received. Reference: #' + result.application.id + '. The recruitment team can now review it.');
  } catch (error) {
    setApplicationStatus(error.message || 'We could not confirm that your application was saved. Please try again or contact recruitment.', true);
  } finally {
    if (submit) {
      submit.disabled = false;
      if (submit.tagName === 'INPUT') submit.value = originalLabel;
      else submit.textContent = originalLabel;
    }
  }
}


function setFormStatus(elementId, message, isError = false) {
  const status = document.getElementById(elementId);
  if (!status) return;
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('error', isError);
}

function formValue(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

async function submitContactMessage(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"], input[type="submit"]');
  const originalLabel = submit ? (submit.textContent || submit.value || 'Send Message') : '';
  if (submit) {
    submit.disabled = true;
    if (submit.tagName === 'INPUT') submit.value = 'Sending…';
    else submit.textContent = 'Sending…';
  }

  const payload = {
    name: formValue('name'),
    email: formValue('email'),
    subject: formValue('subject'),
    message: formValue('message'),
    privacyAcknowledged: Boolean(document.getElementById('contactPrivacyAcknowledged')?.checked)
  };

  try {
    const response = await fetch(ECHO_API_BASE + '/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({ error: 'The service returned an invalid response.' }));
    if (!response.ok) throw new Error(result.error || 'Your message could not be submitted.');
    form.reset();
    setFormStatus('contactStatus', 'Your message has been received. Reference: #' + result.submission.id + '.');
  } catch (error) {
    setFormStatus('contactStatus', error.message || 'We could not confirm that your message was saved. Please try again.', true);
  } finally {
    if (submit) {
      submit.disabled = false;
      if (submit.tagName === 'INPUT') submit.value = originalLabel;
      else submit.textContent = originalLabel;
    }
  }
}

async function submitManagerApplication(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"], input[type="submit"]');
  const originalLabel = submit ? (submit.textContent || submit.value || 'Submit Manager Application') : '';
  if (submit) {
    submit.disabled = true;
    if (submit.tagName === 'INPUT') submit.value = 'Submitting…';
    else submit.textContent = 'Submitting…';
  }

  const rawHours = formValue('flight_hours');
  const payload = {
    firstName: formValue('first_name'),
    lastName: formValue('last_name'),
    age: Number(formValue('age')),
    country: formValue('country'),
    email: formValue('email'),
    discord: formValue('discord'),
    newSkyUsername: formValue('newsky'),
    currentPosition: formValue('current_position'),
    preferredManagerType: formValue('manager_type'),
    secondaryArea: formValue('secondary_role'),
    managementExperience: formValue('management_experience'),
    flightHours: rawHours === '' ? null : Number(rawHours),
    simulator: formValue('simulator'),
    network: formValue('network'),
    availability: formValue('availability'),
    timezone: formValue('timezone'),
    motivation: formValue('reason'),
    roleReason: formValue('role_reason'),
    previousExperience: formValue('experience'),
    improvements: formValue('improvements'),
    suitability: formValue('strengths'),
    communityExperience: formValue('discord_experience'),
    additionalInfo: formValue('additional'),
    privacyAcknowledged: Boolean(document.getElementById('managerPrivacyAcknowledged')?.checked)
  };

  try {
    const response = await fetch(ECHO_API_BASE + '/manager-applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({ error: 'The service returned an invalid response.' }));
    if (!response.ok) throw new Error(result.error || 'Your management application could not be submitted.');
    form.reset();
    setFormStatus('managerApplicationStatus', 'Thank you! Your management application was received. Reference: #' + result.submission.id + '.');
  } catch (error) {
    setFormStatus('managerApplicationStatus', error.message || 'We could not confirm that your application was saved. Please try again.', true);
  } finally {
    if (submit) {
      submit.disabled = false;
      if (submit.tagName === 'INPUT') submit.value = originalLabel;
      else submit.textContent = originalLabel;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const pilotForm = document.getElementById('pilotApplicationForm');
  if (pilotForm) pilotForm.addEventListener('submit', submitApplication);

  const contactForm = document.getElementById('contactForm');
  if (contactForm) contactForm.addEventListener('submit', submitContactMessage);

  const managerForm = document.getElementById('managerApplicationForm');
  if (managerForm) managerForm.addEventListener('submit', submitManagerApplication);

  const query = new URLSearchParams(window.location.search);
  const applicationResult = query.get('application');
  if (applicationResult === 'received') {
    if (managerForm) setFormStatus('managerApplicationStatus', 'Your management application was received. The recruitment team will review it.');
    else setApplicationStatus('Your application was received. The recruitment team will review it.');
  } else if (applicationResult === 'invalid') {
    if (managerForm) setFormStatus('managerApplicationStatus', 'Some management application details could not be validated. Please review the required fields and try again.', true);
    else setApplicationStatus('Some application details could not be validated. Please review the required fields and try again.', true);
  } else if (applicationResult === 'error') {
    if (managerForm) setFormStatus('managerApplicationStatus', 'We could not save your management application. Please try again or contact recruitment.', true);
    else setApplicationStatus('We could not save your application. Please try again or contact recruitment.', true);
  }

  const contactResult = query.get('contact');
  if (contactResult === 'received') setFormStatus('contactStatus', 'Your message has been received. We will get back to you.');
  else if (contactResult === 'invalid') setFormStatus('contactStatus', 'Some contact details could not be validated. Please review the form and try again.', true);
  else if (contactResult === 'error') setFormStatus('contactStatus', 'We could not save your message. Please try again.', true);
});
