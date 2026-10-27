
function toggleMenu(){document.getElementById('mobileNav')?.classList.toggle('open')}
function filterRoutes(type){document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x.dataset.filter===type));document.querySelectorAll('.route-row[data-type]').forEach(x=>x.style.display=(type==='all'||x.dataset.type===type)?'grid':'none')}
function showLang(lang){document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.lang===lang));document.querySelectorAll('.lang-panel').forEach(x=>x.style.display=x.dataset.lang===lang?'block':'none')}
function submitApplication(e){
  const form = e?.currentTarget || e?.target;
  const success = document.querySelector('.success');
  if (success) {
    success.textContent = 'Submitting your application…';
    success.style.display = 'block';
    success.setAttribute('role', 'status');
    success.setAttribute('aria-live', 'polite');
  }

  const submit = form?.querySelector('button[type="submit"], input[type="submit"]');
  if (submit) {
    submit.disabled = true;
    if (submit.tagName === 'INPUT') submit.value = 'Submitting…';
    else submit.textContent = 'Submitting…';
  }

  // Keep native form submission enabled: join.html's existing FormSubmit
  // action delivers applications by email. Do not show a false success state.
}
