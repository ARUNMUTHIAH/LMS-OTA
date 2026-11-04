'use strict';
// App shell: state, page navigation, sign-in and first-run setup.
// Used by: renderer/index.html, which loads it with <script src="app.js">.
// Not imported: the screen scripts are plain browser scripts that share one global scope and
// load in this order: ui.js, app.js, dashboard.js, books.js, circulation.js, reports.js,
// settings.js, license.js, start.js. Keep that order in index.html when adding or renaming a file.

/* ================= State & navigation ================= */
const state = {
  user: null,
  settings: { defaultDuration: 14 },
  page: 'dashboard',
  books: { query: '', status: '', location: '', page: 1, size: 25, rows: [] },
  report: 'books',
  lookups: { categories: [], locations: [], racks: [], borrowers: [], borrowerDetails: [] },
};

const PAGES = {
  dashboard: ['Dashboard', 'Live overview of the library collection'],
  books: ['Book Entry', 'Add, edit and search the book catalogue'],
  issue: ['Issue Book', 'Enter the Barcode No, then the borrower details'],
  return: ['Return Book', 'Enter the Barcode No to receive the book back'],
  reports: ['Reports', 'View and export to Excel or PDF'],
  settings: ['Settings', 'Users, loan duration, return rules and data backup'],
};

// User access (Settings → Users): which screens and actions the signed-in account may use.
// Screens it may not use are hidden; the server refuses their actions too.
const ACCESS = window.Rules.access;
const userPerms = () => (state.user ? (state.user.settingsOnly ? ['settings'] : ACCESS.permsOf(state.user)) : []);
const can = (perm) => userPerms().includes(perm);
// The first page in the sidebar this account may open.
const firstPage = () => Object.keys(PAGES).find(can) || 'dashboard';

// Settings asks for the Settings password each time it is opened from another page.
async function go(page, opts = {}) {
  if (!can(page)) page = firstPage();
  if (!can('books_edit')) opts = { ...opts, newBook: false };
  if (page === 'settings' && state.page !== 'settings' && !(await unlockSettings())) return;
  state.page = page;
  $$('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  $$('.page').forEach((p) => (p.hidden = p.id !== `page-${page}`));
  const [title, sub] = PAGES[page];
  $('#page-title').textContent = title;
  $('#page-sub').textContent = sub;
  $('.main').scrollTop = 0;
  const loaders = {
    dashboard: loadDashboard,
    books: () => loadBooksPage(opts),
    issue: () => resetCirc('issue'),
    return: () => resetCirc('return'),
    reports: () => loadReportsPage(opts),
    settings: loadSettings,
  };
  attempt(loaders[page]);
}

$$('.nav-item').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    go(a.dataset.page);
  })
);

/* ================= Login ================= */
async function showLogin() {
  state.user = null;
  while (modalStack.length) modalStack[modalStack.length - 1].close();
  $('#app').hidden = true;
  // No valid license: the License screen instead of the sign-in.
  if (!(await ensureLicense())) return;
  if (state.user) return;
  $('#license-screen').hidden = true;
  $('#login-screen').hidden = false;
  $('#login-username').value = '';
  $('#login-password').value = '';
  if ($('#login-password').hidePassword) $('#login-password').hidePassword();
  $('#login-error').hidden = true;
  clearFieldErrors($('#login-form'));
  // Ready to type straight away; the checks below run while the librarian types.
  if (!$('#login-form').hidden) $('#login-username').focus();
  // A new database has no accounts yet: ask for the first one instead of a sign-in.
  const setup = await window.api.setupNeeded();
  // Signed in meanwhile: leave the screen alone.
  if (state.user || $('#login-screen').hidden) return;
  const needsSetup = !!(setup.ok && setup.data);
  // Server not reachable: say so straight away instead of waiting for a sign-in attempt, and offer
  // to change the database connection (nobody can sign in to reach Settings meanwhile).
  $('#db-fix').hidden = setup.ok;
  if (!setup.ok) {
    $('#login-error').textContent = setup.error;
    $('#login-error').hidden = false;
  }
  if (needsSetup && $('#setup-form').hidden) {
    $('#login-form').hidden = true;
    $('#setup-form').hidden = false;
    $('#login-settings-btn').hidden = true;
    $('#setup-form').reset();
    $('#setup-error').hidden = true;
    clearFieldErrors($('#setup-form'));
    $('#setup-username').focus();
    return;
  }
  if (!needsSetup && $('#login-form').hidden) {
    $('#setup-form').hidden = true;
    $('#login-form').hidden = false;
    $('#login-settings-btn').hidden = false;
    focusIfIdle($('#login-username'));
  }
  window.api.loginHint().then((hint) => {
    if (!state.user) $('#login-hint').hidden = !(hint.ok && hint.data);
  });
}

// Moves the cursor only if the librarian has not clicked or typed anywhere yet.
function focusIfIdle(el) {
  const active = document.activeElement;
  if (!active || active === document.body) el.focus();
}

// Shows what the button is doing while the server answers ("Signing in…").
function busyButton(btn, text) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = text;
  return () => {
    btn.disabled = false;
    btn.textContent = label;
  };
}

$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#setup-error').hidden = true;
  const password = $('#setup-password');
  const valid = validateFields([
    [$('#setup-username'), RULES.username],
    [password, (v) => (v ? RULES.newPassword(v) : 'Password is required.')],
  ]);
  if (!valid) return;
  const done = busyButton($('#setup-form button[type=submit]'), 'Creating account…');
  try {
    const res = await window.api.setup({ username: $('#setup-username').value.trim(), password: password.value });
    if (res.license) return showLogin();
    if (!res.ok) {
      $('#setup-error').textContent = res.error;
      $('#setup-error').hidden = false;
      return;
    }
    state.user = res.data.user;
    state.settings = res.data.settings;
    enterApp();
    toast(`Account “${res.data.user.username}” created. Welcome!`);
  } finally {
    done();
  }
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').hidden = true;
  // One field at a time: an empty username is reported on its own, before the password is checked.
  if (!validateFields([[$('#login-username'), (v) => (v.trim() ? '' : 'Enter your username.')]])) {
    showFieldError($('#login-password'), '');
    return;
  }
  if (!validateFields([[$('#login-password'), (v) => (v ? '' : 'Enter your password.')]])) return;
  const done = busyButton($('#login-form button[type=submit]'), 'Signing in…');
  try {
    const res = await window.api.login({ username: $('#login-username').value, password: $('#login-password').value });
    if (res.license) return showLogin();
    if (!res.ok) {
      $('#login-error').textContent = res.error;
      $('#login-error').hidden = false;
      $('#login-form').classList.remove('shake');
      void $('#login-form').offsetWidth;
      $('#login-form').classList.add('shake');
      $('#login-password').select();
      return;
    }
    state.user = res.data.user;
    state.settings = res.data.settings;
    enterApp();
  } finally {
    done();
  }
});

// Settings from the sign-in screen: the gear asks for the Settings password and opens Settings on
// its own (no librarian account; the other pages stay locked until someone signs in).
$('#login-settings-btn').addEventListener('click', () => {
  const m = openModal({
    title: 'Open Settings',
    iconName: 'lock',
    size: 'small',
    body: `<form method="post" id="login-settings-form" autocomplete="off" novalidate>
      <p class="muted unlock-help">Enter the Settings password to open Settings.</p>
      <label class="field"><span>Password <em>*</em></span><input name="password" type="password" maxlength="64" /></label>
      <button type="submit" hidden></button>
    </form>`,
    foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-ok>${icon('gear')}Open Settings</button>`,
  });
  const form = $('#login-settings-form', m.el);
  const btn = $('[data-ok]', m.el);
  enhancePasswords(form);
  setTimeout(() => form.password.focus(), 30);
  async function submit() {
    if (!validateFields([[form.password, (v) => (v ? '' : 'Enter the password.')]])) return;
    btn.disabled = true;
    try {
      const res = await window.api.settingsLogin(form.password.value);
      if (res.license) {
        m.close();
        return showLogin();
      }
      if (!res.ok) {
        showFieldError(form.password, res.error);
        form.password.select();
        return;
      }
      m.close();
      state.user = res.data.user;
      if (res.data.settings) state.settings = res.data.settings;
      enterApp();
      if (res.data.user.offline) {
        toast(`The library database cannot be reached (${res.data.error}). Only the database connection and automatic backup options are available until it is fixed.`, 'info');
      }
    } finally {
      btn.disabled = false;
    }
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  btn.addEventListener('click', submit);
});

function enterApp() {
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
  $('#who-name').textContent = state.user.username;
  $('#avatar').textContent = state.user.username.charAt(0);
  // Opened with the Settings password: only Settings, and "Sign out" goes back to the sign-in.
  const settingsOnly = !!state.user.settingsOnly;
  document.body.classList.toggle('settings-only', settingsOnly);
  document.body.classList.toggle('settings-offline', !!state.user.offline);
  // Screens and buttons this account may not use are hidden by a "no-<permission>" class (styles.css).
  for (const k of ACCESS.ALL) document.body.classList.toggle(`no-${k}`, !settingsOnly && !can(k));
  $('#who-role').textContent = settingsOnly ? 'Settings only' : ACCESS.accessLabel(userPerms());
  const now = new Date();
  $('#today-label').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (settingsOnly) {
    state.page = 'settings'; // already unlocked by the Settings password
    go('settings');
    return;
  }
  refreshLookups();
  state.page = '';
  go(firstPage());
  licenseReminder();
  if (state.settings.defaultCredentials && can('settings')) {
    toast('You are using the default password. Change it in Settings → Users.', 'info', [
      { label: 'Open Settings', run: () => go('settings') },
    ]);
  }
}

$('#logout-btn').addEventListener('click', async () => {
  const ok = await confirmDialog({ title: 'Sign out?', message: 'You will need your password to sign back in.', okLabel: 'Sign out' });
  if (!ok) return;
  await window.api.logout();
  showLogin();
});

// Datalists for categories and borrower names.
async function refreshLookups() {
  await attempt(async () => {
    const [shelf, names, details] = await Promise.all([rpc('shelfValues'), rpc('borrowers'), rpc('borrowerDetails')]);
    state.lookups = { ...shelf, borrowers: names, borrowerDetails: details };
    const fill = (sel, values) => {
      const cur = sel.value;
      setHtml(sel, '<option value="">All</option>' + values.map((v) => `<option>${esc(v)}</option>`).join(''));
      sel.value = values.includes(cur) ? cur : '';
    };
    fill($('#rf-category'), shelf.categories);
    fill($('#rf-location'), shelf.locations);
    fill($('#rf-rack'), shelf.racks);
    // Book Entry's location filter: keeps the chosen location while it still exists.
    const loc = $('#book-filter-location');
    setHtml(loc, '<option value="">All locations</option>' + shelf.locations.map((v) => `<option>${esc(v)}</option>`).join(''));
    loc.value = shelf.locations.includes(state.books.location) ? state.books.location : '';
  });
}
