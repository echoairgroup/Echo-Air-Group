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

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('pilotApplicationForm');
  if (form) form.addEventListener('submit', submitApplication);

  const result = new URLSearchParams(window.location.search).get('application');
  if (result === 'received') {
    setApplicationStatus('Your application was received. The recruitment team will review it.');
  } else if (result === 'invalid') {
    setApplicationStatus('Some application details could not be validated. Please review the required fields and try again.', true);
  } else if (result === 'error') {
    setApplicationStatus('We could not save your application. Please try again or contact recruitment.', true);
  }
});
