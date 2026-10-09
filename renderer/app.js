'use strict';
// App shell: state, page navigation, sign-in and first-run setup.
// Used by: renderer/index.html, which loads it with <script src="app.js">.
// Not imported: the screen scripts are plain browser scripts that share one global scope and
// load in this order: ui.js, app.js, dashboard.js, books.js, circulation.js, reports.js,
// settings.js, start.js. Keep that order in index.html when adding or renaming a file.

/* ================= State & navigation ================= */
const state = {
  user: null,
  settings: { defaultDuration: 14 },
  page: 'dashboard',
  books: { query: '', status: '', page: 1, size: 25, rows: [] },
  report: 'books',
  lookups: { categories: [], locations: [], racks: [], borrowers: [] },
};

const PAGES = {
  dashboard: ['Dashboard', 'Live overview of the library collection'],
  books: ['Book Entry', 'Add, edit and search the book catalogue'],
  issue: ['Issue Book', 'Enter the Barcode No, then the borrower details'],
  return: ['Return Book', 'Enter the Barcode No to receive the book back'],
  reports: ['Reports', 'View and export to Excel or PDF'],
  settings: ['Settings', 'Users, loan duration and data backup'],
};

function go(page, opts = {}) {
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
  // Server not reachable: say so straight away instead of waiting for a sign-in attempt.
  if (!setup.ok) {
    $('#login-error').textContent = setup.error;
    $('#login-error').hidden = false;
  }
  if (needsSetup && $('#setup-form').hidden) {
    $('#login-form').hidden = true;
    $('#setup-form').hidden = false;
    $('#setup-form').reset();
    $('#setup-error').hidden = true;
    clearFieldErrors($('#setup-form'));
    $('#setup-username').focus();
    return;
  }
  if (!needsSetup && $('#login-form').hidden) {
    $('#setup-form').hidden = true;
    $('#login-form').hidden = false;
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

function enterApp() {
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
  $('#who-name').textContent = state.user.username;
  $('#avatar').textContent = state.user.username.charAt(0);
  const now = new Date();
  $('#today-label').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  refreshLookups();
  go('dashboard');
  if (state.settings.defaultCredentials) {
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
    const [shelf, names] = await Promise.all([rpc('shelfValues'), rpc('borrowers')]);
    state.lookups = { ...shelf, borrowers: names };
    const fill = (sel, values) => {
      const cur = sel.value;
      setHtml(sel, '<option value="">All</option>' + values.map((v) => `<option>${esc(v)}</option>`).join(''));
      sel.value = values.includes(cur) ? cur : '';
    };
    fill($('#rf-category'), shelf.categories);
    fill($('#rf-location'), shelf.locations);
    fill($('#rf-rack'), shelf.racks);
  });
}
