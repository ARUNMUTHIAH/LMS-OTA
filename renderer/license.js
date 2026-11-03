'use strict';
// License screen: shown before sign-in when there is no license, or it has expired or does not
// belong to this installation. The librarian enters the Client ID, emails the request code to the
// administrator, then loads the license file sent back. See src/license.js.
// Used by: renderer/index.html, which loads it with <script src="license.js">.
// Not imported: the screen scripts are plain browser scripts that share one global scope and
// load in this order: ui.js, app.js, dashboard.js, books.js, circulation.js, reports.js,
// settings.js, license.js, start.js. Keep that order in index.html when adding or renaming a file.

const LICENSE_REMIND_DAYS = 30;
let licenseInfo = null; // last status from the main process

// True when the app may be used; otherwise shows the License screen.
async function ensureLicense() {
  const res = await window.api.licenseStatus();
  const st = res.ok ? res.data : { valid: false, state: 'invalid', message: res.error, clientId: '', renewal: false };
  licenseInfo = st;
  if (st.valid) return true;
  showLicense(st);
  return false;
}

function licenseDaysLeft(st) {
  if (!st || !st.expiryDate) return null;
  const [y, m, d] = st.expiryDate.split('-').map(Number);
  const [ty, tm, td] = isoToday().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

/* ----- Software license card in Settings ----- */
async function loadLicenseCard() {
  licenseInfo = await rpc('licenseStatus');
  renderLicenseCard(licenseInfo);
}

function renderLicenseCard(st) {
  const left = licenseDaysLeft(st);
  const daysText = left == null ? '' : left === 0 ? 'Last day' : plural(left, 'day');
  const item = (label, value) => `<div><span>${label}</span><strong title="${esc(value)}">${esc(value) || '—'}</strong></div>`;
  setHtml($('#license-grid'), item('Licensed to', st.licensedTo) + item('Client ID', st.clientId) + item('Valid until', st.expiryDate ? fmtDate(st.expiryDate) : '') + item('Remaining', daysText));
  const soon = left != null && left <= LICENSE_REMIND_DAYS;
  $('#license-pill').textContent = st.valid ? (soon ? 'Ends soon' : 'Active') : 'Not valid';
  $('#license-pill').classList.toggle('pill-indigo', st.valid && !soon);
}

// Asks for the Client ID, then shows the request code to email to the administrator.
function openLicenseRenew() {
  const m = openModal({
    title: 'Renew License',
    iconName: 'lock',
    size: 'small',
    body: `<form method="post" id="license-renew-form" autocomplete="off" novalidate>
      <label class="field"><span>Client ID <em>*</em></span><input name="clientId" maxlength="50" spellcheck="false" value="${esc((licenseInfo && licenseInfo.clientId) || '')}" /></label>
      <div class="form-error" hidden></div>
      <button type="submit" hidden></button>
    </form>`,
    foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-ok>Get Request Code</button>`,
  });
  const form = $('#license-renew-form', m.el);
  const errBox = $('.form-error', form);
  setTimeout(() => form.clientId.focus(), 30);
  async function submit() {
    errBox.hidden = true;
    if (!validateFields([[form.clientId, (v) => (v.trim() ? '' : 'Enter the Client ID.')]])) return;
    const res = await window.api.licenseRequest(form.clientId.value);
    if (!res.ok) {
      errBox.textContent = res.error;
      errBox.hidden = false;
      return;
    }
    m.close();
    showLicenseRequest(res.data);
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  $('[data-ok]', m.el).addEventListener('click', submit);
}

$('#license-renew').addEventListener('click', () => openLicenseRenew());

$('#license-load-set').addEventListener('click', (e) =>
  withBusy(e.currentTarget, async () => {
    const st = await rpc('licenseLoad');
    if (!st) return; // cancelled
    licenseInfo = st;
    renderLicenseCard(st);
    toast(`License loaded. Valid until ${fmtDate(st.expiryDate)}.`);
  })
);

// After sign-in: a reminder when the license ends within LICENSE_REMIND_DAYS.
function licenseReminder() {
  const left = licenseDaysLeft(licenseInfo);
  if (left == null || left > LICENSE_REMIND_DAYS) return;
  toast(`The software license ends ${left === 0 ? 'today' : `in ${plural(left, 'day')}`} (${fmtDate(licenseInfo.expiryDate)}). Ask the administrator for a renewal.`, 'info');
}

// manage: opened from the sign-in screen while the license is still valid (to renew early).
function showLicense(st, { manage = false } = {}) {
  state.user = null;
  while (modalStack.length) modalStack[modalStack.length - 1].close();
  $('#app').hidden = true;
  $('#login-screen').hidden = true;
  $('#license-screen').hidden = false;
  const renewal = !!st.renewal;
  const label = renewal ? 'Renew License' : 'Register License';
  $('#license-title').textContent = label;
  $('#license-request-btn').textContent = label;
  $('#license-back-btn').hidden = !(manage && st.valid);
  const kinds = { valid: 'ok', expired: 'err', invalid: 'err', missing: 'warn' };
  const titles = { valid: 'License active', expired: 'License expired', invalid: 'License not valid', missing: 'License required' };
  const text = st.valid ? `Valid until ${fmtDate(st.expiryDate)}${st.licensedTo ? ` · ${st.licensedTo}` : ''}.` : st.message;
  const box = $('#license-state');
  box.className = `license-state ${kinds[st.state] || 'err'}`;
  setHtml(box, `${icon(st.valid ? 'check' : 'alert')}<div><strong>${esc(titles[st.state] || 'License')}</strong><span>${esc(text)}</span>
    <span>${renewal ? 'Enter the Client ID and click Renew License to get a request code for the administrator.' : 'Enter the Client ID and click Register License to get a request code for the administrator.'}</span></div>`);
  $('#license-client').value = st.clientId || '';
  $('#license-error').hidden = true;
  clearFieldErrors($('#license-form'));
  $('#license-client').focus();
}

function licenseError(msg) {
  $('#license-error').textContent = msg;
  $('#license-error').hidden = false;
}

// Popup with the request code to email to the administrator.
function showLicenseRequest(code) {
  const [clientId, platform, software, key] = code.replace(/^\[LM-REQ\]\s*/, '').split('|');
  const m = openModal({
    title: licenseInfo && licenseInfo.renewal ? 'License Renewal Request' : 'License Registration Request',
    iconName: 'lock',
    body: `<p class="license-help">Copy this request code and send it to the administrator by email. The administrator will send back a license file;
        then click <b>Load License File</b>.</p>
      <dl class="license-grid">
        <dt>Client ID</dt><dd>${esc(clientId)}</dd>
        <dt>Platform</dt><dd>${esc(platform)}</dd>
        <dt>Software</dt><dd>${esc(software)}</dd>
        <dt>Unique ID</dt><dd class="mono">${esc(key.slice(0, 24))}…</dd>
      </dl>
      <label class="field"><span>Request code — copy it and send it to the administrator by email</span><textarea class="license-code" readonly rows="7" spellcheck="false">${esc(code)}</textarea></label>`,
    foot: `<button class="btn btn-ghost" data-close>Close</button><button class="btn btn-primary" data-copy>Copy Request Code</button>`,
  });
  const copyBtn = $('[data-copy]', m.el);
  const area = $('.license-code', m.el);
  area.addEventListener('focus', () => area.select());
  copyBtn.addEventListener('click', async () => {
    const res = await window.api.licenseCopy(code);
    if (!res.ok) return toast(res.error, 'err');
    copyBtn.textContent = 'Copied';
    toast('Request code copied. Paste it into an email to the administrator.');
  });
  copyBtn.focus();
}

$('#license-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#license-error').hidden = true;
  if (!validateFields([[$('#license-client'), (v) => (v.trim() ? '' : 'Enter the Client ID.')]])) return;
  const res = await window.api.licenseRequest($('#license-client').value);
  if (!res.ok) return licenseError(res.error);
  showLicenseRequest(res.data);
});

$('#license-load-btn').addEventListener('click', async () => {
  $('#license-error').hidden = true;
  const res = await window.api.licenseLoad();
  if (!res.ok) return licenseError(res.error);
  if (!res.data) return; // cancelled
  licenseInfo = res.data;
  toast(`License activated. Valid until ${fmtDate(res.data.expiryDate)}.`);
  showLogin();
});

$('#license-recheck-btn').addEventListener('click', async () => {
  $('#license-error').hidden = true;
  if (await ensureLicense()) showLogin();
});

$('#license-back-btn').addEventListener('click', () => showLogin());
