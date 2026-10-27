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
