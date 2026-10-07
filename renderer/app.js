'use strict';

/* ================= Helpers ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name) => `<svg><use href="#i-${name}"/></svg>`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
// '2026-09-28' -> '28 Sep 2026'
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}
// '2026-09-28 14:05:00' -> '28 Sep, 2:05 PM'
function fmtDateTime(s) {
  if (!s) return '';
  const [date, time = '00:00'] = s.split(' ');
  const [, m, d] = date.split('-');
  let [hh, mm] = time.split(':').map(Number);
  const ap = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12 || 12;
  return `${Number(d)} ${MONTHS[Number(m) - 1]}, ${hh}:${String(mm).padStart(2, '0')} ${ap}`;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function debounce(fn, ms = 220) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
function badge(status) {
  return `<span class="badge badge-${esc(status).replace(/\s+/g, '-').toLowerCase()}">${esc(status)}</span>`;
}
function emptyState(iconName, text) {
  return `<div class="empty">${icon(iconName)}<p>${esc(text)}</p></div>`;
}

/* ================= Suggestions (typeahead) ================= */
// A plain text box that shows matching earlier values underneath while typing — no dropdown arrow.
// getItems() returns the list to search (e.g. names used before).
function attachSuggest(input, getItems) {
  if (input.dataset.suggest) return;
  input.dataset.suggest = '1';
  input.setAttribute('autocomplete', 'off');
  input.removeAttribute('list');
  const wrap = document.createElement('div');
  wrap.className = 'suggest-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const box = document.createElement('div');
  box.className = 'suggest';
  box.hidden = true;
  box.setAttribute('role', 'listbox');
  wrap.appendChild(box);
  let items = [];
  let active = -1;

  const close = () => {
    box.hidden = true;
    active = -1;
  };
  const mark = () => $$('.suggest-item', box).forEach((el, i) => el.classList.toggle('active', i === active));
  const highlight = (v, q) => {
    const i = v.toLowerCase().indexOf(q);
    return i < 0 ? esc(v) : esc(v.slice(0, i)) + '<b>' + esc(v.slice(i, i + q.length)) + '</b>' + esc(v.slice(i + q.length));
  };
  const render = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) return close();
    const starts = [];
    const contains = [];
    for (const v of getItems() || []) {
      const l = String(v).toLowerCase();
      if (l.startsWith(q)) starts.push(v);
      else if (l.includes(q)) contains.push(v);
    }
    items = [...starts, ...contains].slice(0, 8);
    if (!items.length || (items.length === 1 && items[0].toLowerCase() === q)) return close();
    active = -1;
    box.innerHTML =
      `<div class="suggest-head">Used before</div>` +
      items.map((v, i) => `<div class="suggest-item" role="option" data-i="${i}">${icon('user')}<span>${highlight(v, q)}</span></div>`).join('');
    box.hidden = false;
  };
  const pick = (i) => {
    input.value = items[i];
    close();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      active = e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
      mark();
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      pick(active);
    } else if (e.key === 'Escape') {
      e.stopPropagation(); // close the suggestions, not the dialog behind them
      close();
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  box.addEventListener('mousedown', (e) => {
    e.preventDefault(); // keep focus in the box
    const it = e.target.closest('.suggest-item');
    if (it) pick(Number(it.dataset.i));
  });
}

/* ================= Pagination ================= */
const PAGE_SIZES = [10, 25, 50, 100];

// Returns the rows for the current page and clamps st.page into range.
function pageSlice(rows, st) {
  const pages = Math.max(1, Math.ceil(rows.length / st.size));
  st.page = Math.min(Math.max(1, st.page), pages);
  const start = (st.page - 1) * st.size;
  return { pages, start, slice: rows.slice(start, start + st.size) };
}

function pagerHtml(total, st, pages, start, shown, noun) {
  if (!total) return '';
  const nums = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - st.page) <= 1) nums.push(n);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return `<span>Showing <b>${start + 1}–${start + shown}</b> of <b>${total}</b> ${noun}${total === 1 ? '' : 's'}</span>
    <div class="pager-btns">
      <label class="page-size">Rows per page <select data-size>${PAGE_SIZES.map((n) => `<option value="${n}" ${n === st.size ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <button class="icon-btn" data-go="${st.page - 1}" ${st.page <= 1 ? 'disabled' : ''} title="Previous page">${icon('chev-l')}</button>
      ${nums.map((n) => (n === '…' ? '<span class="pg-gap">…</span>' : `<button class="pg-num ${n === st.page ? 'on' : ''}" data-go="${n}">${n}</button>`)).join('')}
      <button class="icon-btn" data-go="${st.page + 1}" ${st.page >= pages ? 'disabled' : ''} title="Next page">${icon('chev-r')}</button>
    </div>`;
}

// One-time wiring of a pager element: page buttons and the rows-per-page menu.
function bindPager(el, st, rerender) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b || b.disabled) return;
    st.page = Number(b.dataset.go);
    rerender();
  });
  el.addEventListener('change', (e) => {
    if (!e.target.matches('[data-size]')) return;
    st.size = Number(e.target.value);
    st.page = 1;
    rerender();
  });
}

/* ================= Password fields ================= */
// Adds a show/hide (eye) button inside every password box under root.
function enhancePasswords(root = document) {
  $$('input[type=password]', root).forEach((input) => {
    if (input.parentElement.classList.contains('pw-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    wrap.appendChild(btn);
    const sync = () => {
      const shown = input.type === 'text';
      btn.innerHTML = icon(shown ? 'eye-off' : 'eye');
      btn.title = shown ? 'Hide password' : 'Show password';
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-pressed', String(shown));
    };
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the cursor in the box
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      input.type = input.type === 'password' ? 'text' : 'password';
      sync();
      input.focus();
    });
    input.hidePassword = () => {
      input.type = 'password';
      sync();
    };
    sync();
  });
}

/* ================= Validation ================= */
const { checks: RULES, LIMITS } = window.Rules;

// Shows (or clears, when msg is empty) an error line under the input's field.
function showFieldError(input, msg) {
  const field = input.closest('.field') || input.closest('.scan-main');
  if (!field) return;
  field.classList.toggle('invalid', !!msg);
  let el = field.querySelector(':scope > .field-error');
  if (!el) {
    el = document.createElement('span');
    el.className = 'field-error';
    field.appendChild(el);
  }
  el.textContent = msg || '';
  el.hidden = !msg;
}

function clearFieldErrors(root) {
  $$('.invalid', root).forEach((f) => {
    f.classList.remove('invalid');
    const el = $(':scope > .field-error', f);
    if (el) el.hidden = true;
  });
}

// Runs [input, check] pairs, marks every failing field, focuses the first. Returns true when all pass.
function validateFields(pairs) {
  let first = null;
  for (const [input, check] of pairs) {
    const msg = check(input.value);
    showFieldError(input, msg);
    if (msg && !first) first = input;
  }
  if (first) {
    first.focus();
    if (typeof first.select === 'function' && first.type !== 'number') first.select();
  }
  return !first;
}

// Enter in `input` moves to `next` while `next` is still empty, instead of submitting the form
// (so the empty field isn't flagged before the user has had a chance to fill it).
function enterMovesTo(input, next) {
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey) return;
    if (!input.value.trim() || next.value) return; // empty here: let validation say so; next filled: submit
    e.preventDefault();
    showFieldError(input, '');
    showFieldError(next, '');
    next.focus();
  });
}

// Editing a field clears its error straight away.
document.addEventListener('input', (e) => {
  if (e.target.closest && e.target.closest('.invalid')) showFieldError(e.target, '');
});
// Number fields accept digits only (no e, +, -, decimals), and the mouse wheel never changes them.
document.addEventListener('keydown', (e) => {
  if (e.target.type === 'number' && ['e', 'E', '+', '-', '.', ','].includes(e.key)) e.preventDefault();
});
document.addEventListener(
  'wheel',
  () => {
    const el = document.activeElement;
    if (el && el.type === 'number') el.blur();
  },
  { passive: true }
);

// Adds a live "n / max" counter under textareas that have a maxlength.
function attachCounters(root) {
  $$('textarea[maxlength]', root).forEach((ta) => {
    const counter = document.createElement('span');
    counter.className = 'counter';
    const update = () => (counter.textContent = `${ta.value.length} / ${ta.maxLength}`);
    ta.addEventListener('input', update);
    ta.after(counter);
    update();
  });
}

class ApiError extends Error {}

// Calls the main process. Resolves with data, or throws ApiError with a friendly message.
async function rpc(name, ...args) {
  const res = await window.api[name](...args);
  if (!res.ok) {
    if (res.auth) showLogin();
    throw new ApiError(res.error);
  }
  return res.data;
}

// Runs an async UI action and reports any failure as a toast.
async function attempt(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message || String(e), 'err');
    return undefined;
  }
}

/* ================= Toasts ================= */
function toast(message, kind = 'ok', actions = []) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const ic = kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : 'clock';
  el.innerHTML = `${icon(ic)}<div class="t-main"><div>${esc(message)}</div>${
    actions.length ? `<div class="t-actions">${actions.map((a, i) => `<button data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''
  }</div>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) actions[Number(b.dataset.i)].run();
    dismiss();
  });
  $('#toasts').appendChild(el);
  let gone = false;
  function dismiss() {
    if (gone) return;
    gone = true;
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  }
  setTimeout(dismiss, actions.length ? 8000 : kind === 'err' ? 6000 : 3500);
}

/* ================= Modals ================= */
const modalStack = [];

function openModal({ title, iconName, body, foot = '', size = '' }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">
      ${title ? `<div class="modal-head"><h3>${iconName ? icon(iconName) : ''}${esc(title)}</h3><button class="icon-btn" data-close title="Close">${icon('x')}</button></div>` : ''}
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div>`;
  $('#modal-root').appendChild(backdrop);
  const m = {
    el: backdrop,
    onClose: null,
    close() {
      const i = modalStack.indexOf(m);
      if (i >= 0) modalStack.splice(i, 1);
      backdrop.remove();
      if (m.onClose) m.onClose();
    },
  };
  modalStack.push(m);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) m.close();
  });
  $$('[data-close]', backdrop).forEach((b) => b.addEventListener('click', () => m.close()));
  return m;
}

function confirmDialog({ title, message, okLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const m = openModal({
      size: 'small',
      body: `<div class="confirm-body"><div class="confirm-icon ${danger ? 'danger' : 'warn'}">${icon(danger ? 'trash' : 'alert')}</div>
        <h3>${esc(title)}</h3><p>${esc(message)}</p></div>`,
      foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(okLabel)}</button>`,
    });
    let result = false;
    m.onClose = () => resolve(result);
    $('[data-ok]', m.el).addEventListener('click', () => {
      result = true;
      m.close();
    });
    $('[data-ok]', m.el).focus();
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) {
    e.preventDefault();
    modalStack[modalStack.length - 1].close();
  }
});

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
  issue: ['Issue Book', 'Enter the Accession Number, then the borrower details'],
  return: ['Return Book', 'Enter the Accession Number to receive the book back'],
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
  const hint = await window.api.loginHint();
  $('#login-hint').hidden = !(hint.ok && hint.data);
  setTimeout(() => $('#login-username').focus(), 50);
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').hidden = true;
  // One field at a time: an empty username is reported on its own, before the password is checked.
  if (!validateFields([[$('#login-username'), (v) => (v.trim() ? '' : 'Enter your username.')]])) {
    showFieldError($('#login-password'), '');
    return;
  }
  if (!validateFields([[$('#login-password'), (v) => (v ? '' : 'Enter your password.')]])) return;
  const btn = $('#login-form button[type=submit]');
  btn.disabled = true;
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
    btn.disabled = false;
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
      sel.innerHTML = '<option value="">All</option>' + values.map((v) => `<option>${esc(v)}</option>`).join('');
      sel.value = values.includes(cur) ? cur : '';
    };
    fill($('#rf-category'), shelf.categories);
    fill($('#rf-location'), shelf.locations);
    fill($('#rf-rack'), shelf.racks);
  });
}

/* ================= Dashboard ================= */
function animateNumber(el, to) {
  const from = Number(el.textContent) || 0;
  if (from === to) {
    el.textContent = to;
    return;
  }
  const start = performance.now();
  const dur = 450;
  const step = (t) => {
    const k = Math.min(1, (t - start) / dur);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function loadDashboard() {
  const s = await rpc('dashboard');
  animateNumber($('#t-total'), s.total);
  animateNumber($('#t-issued'), s.issued);
  animateNumber($('#t-available'), s.available);
  animateNumber($('#t-overdue'), s.overdue);
  $('#tile-overdue').classList.toggle('pulse', s.overdue > 0);

  const onTime = s.issued - s.overdue;
  $('#lg-available').textContent = s.available;
  $('#lg-ontime').textContent = onTime;
  $('#lg-overdue').textContent = s.overdue;
  const pct = s.total ? Math.round((s.available / s.total) * 100) : 0;
  $('#donut-pct').textContent = s.total ? `${pct}%` : '—';
  if (s.total) {
    const a = (s.available / s.total) * 100;
    const b = a + (onTime / s.total) * 100;
    $('#donut').style.background = `conic-gradient(#15803d 0 ${a}%, #1d4ed8 ${a}% ${b}%, #b91c1c ${b}% 100%)`;
  } else {
    $('#donut').style.background = 'conic-gradient(#e5e7eb 0 100%)';
  }

  $('#due-soon').innerHTML = s.dueSoon.length
    ? s.dueSoon
        .map(
          (r) => `<div class="list-item"><div class="list-icon amber">${icon('clock')}</div>
          <div class="list-main"><strong>${esc(r.book_name)}</strong><span>${esc(r.book_no)} · ${esc(r.issue_user)}</span></div>
          <span class="pill">${r.days_left === 0 ? 'Due today' : r.days_left === 1 ? 'Tomorrow' : `In ${r.days_left} days`}</span></div>`
        )
        .join('')
    : emptyState('check', 'Nothing due in the next 3 days.');

  $('#recent').innerHTML = s.recent.length
    ? `<table class="table"><thead><tr><th>When</th><th>Action</th><th>Accession No</th><th>Description</th><th>User</th><th>Due Date</th></tr></thead><tbody>
      ${s.recent
        .map(
          (r) => `<tr><td class="date">${esc(fmtDateTime(r.at))}</td><td>${badge(r.action === 'Issued' ? 'Issued' : r.action)}</td>
            <td class="mono">${esc(r.book_no)}</td><td class="strong">${esc(r.book_name)}</td><td>${esc(r.user_name)}</td><td class="date">${esc(fmtDate(r.due_date))}</td></tr>`
        )
        .join('')}</tbody></table>`
    : emptyState('clock', 'No issues or returns yet. Activity will appear here.');
}

$('#tile-overdue').addEventListener('click', () => attempt(showOverdueModal));
$$('.tile[data-goto]').forEach((t) =>
  t.addEventListener('click', () => {
    const status = { books: '', circulation: 'Issued', available: 'Available' }[t.dataset.goto];
    go('books', { status });
  })
);
$$('[data-goto-page]').forEach((b) =>
  b.addEventListener('click', () => go(b.dataset.gotoPage, { newBook: !!b.dataset.newBook }))
);

async function showOverdueModal() {
  const rows = await rpc('overdueNow');
  const st = { page: 1, size: 10, q: '' };
  const m = openModal({
    title: `Overdue Books (${rows.length})`,
    iconName: 'alert',
    size: 'wide overdue-modal',
    body: rows.length
      ? `<div class="modal-tools">
          <div class="search"><svg><use href="#i-search"/></svg><input data-q type="search" maxlength="100" placeholder="Search accession no, description or borrower…" /></div>
          <span class="muted tiny" data-caption></span>
        </div>
        <div class="table-wrap modal-table" data-table></div>
        <div class="pager" data-pager></div>`
      : emptyState('check', 'Great — no books are overdue right now.'),
    foot: `<button class="btn btn-ghost left" data-report>${icon('chart')}Open Overdue Report</button><button class="btn btn-primary" data-close>Close</button>`,
  });
  $('[data-report]', m.el).addEventListener('click', () => {
    m.close();
    go('reports', { report: 'overdue' });
  });
  if (!rows.length) return;

  const render = () => {
    const q = st.q.toLowerCase();
    const shown = q
      ? rows.filter((r) => [r.book_no, r.book_name, r.issue_user].some((v) => String(v || '').toLowerCase().includes(q)))
      : rows;
    const { pages, start, slice } = pageSlice(shown, st);
    $('[data-caption]', m.el).textContent = q ? `${shown.length} of ${rows.length} match` : 'Most overdue first';
    $('[data-table]', m.el).innerHTML = slice.length
      ? `<table class="table"><thead><tr><th class="idx">#</th><th>Accession No</th><th>Description</th><th>Borrower</th><th>Issue Date</th><th>Due Date</th><th class="num">Days Overdue</th></tr></thead><tbody>
        ${slice
          .map(
            (r, i) => `<tr><td class="idx muted">${start + i + 1}</td><td class="mono">${esc(r.book_no)}</td><td class="strong wrap">${esc(r.book_name)}</td><td>${esc(r.issue_user)}</td>
              <td class="date">${esc(fmtDate(r.issue_date))}</td><td class="date">${esc(fmtDate(r.due_date))}</td><td class="num"><span class="badge badge-overdue">${plural(r.days_overdue, 'day')}</span></td></tr>`
          )
          .join('')}</tbody></table>`
      : emptyState('search', 'No overdue books match your search.');
    $('[data-pager]', m.el).innerHTML = pagerHtml(shown.length, st, pages, start, slice.length, 'book');
  };
  $('[data-q]', m.el).addEventListener(
    'input',
    debounce((e) => {
      st.q = e.target.value.trim();
      st.page = 1;
      render();
    }, 150)
  );
  bindPager($('[data-pager]', m.el), st, render);
  render();
  setTimeout(() => $('[data-q]', m.el).focus(), 30);
}

/* ================= Books ================= */

async function loadBooksPage(opts = {}) {
  if (opts.status !== undefined) {
    state.books.status = opts.status;
    state.books.query = '';
    $('#book-search').value = '';
  }
  $('#book-filter-status').value = state.books.status;
  state.books.page = 1;
  await refreshBooks();
  if (opts.newBook) openBookForm();
  else $('#book-search').focus();
}

let booksSeq = 0;
async function refreshBooks() {
  const seq = ++booksSeq;
  const rows = await rpc('searchBooks', { query: state.books.query, status: state.books.status });
  if (seq !== booksSeq) return; // a newer search superseded this one
  state.books.rows = rows;
  renderBooks();
}

function renderBooks() {
  const { rows } = state.books;
  const { pages, start, slice } = pageSlice(rows, state.books);
  const filtered = state.books.query || state.books.status;

  $('#books-table').innerHTML = slice.length
    ? `<table class="table"><thead><tr><th>Accession No</th><th>LF</th><th>CAT</th><th>Description of Manual</th><th>LOC</th><th>Rack</th><th>Status</th><th class="actions"></th></tr></thead><tbody>
      ${slice
        .map(
          (b) => `<tr>
            <td class="mono">${esc(b.book_no)}</td>
            <td class="mono">${esc(b.lf) || '<span class="muted">—</span>'}</td>
            <td class="nowrap">${esc(b.category) || '<span class="muted">—</span>'}</td>
            <td class="strong wrap">${esc(b.name)}</td>
            <td class="nowrap">${esc(b.location) || '<span class="muted">—</span>'}</td>
            <td class="nowrap">${esc(b.rack) || '<span class="muted">—</span>'}</td>
            <td>${badge(b.status)}${b.status === 'Issued' ? `<div class="tiny muted">${esc(b.issue_user)} · due ${esc(fmtDate(b.due_date))}</div>` : ''}</td>
            <td class="actions">
              <button class="icon-btn" data-edit="${b.id}" title="Edit">${icon('edit')}</button>
              <button class="icon-btn danger" data-del="${b.id}" ${b.issue_id ? 'disabled title="Issued books cannot be deleted"' : 'title="Delete"'}>${icon('trash')}</button>
            </td></tr>`
        )
        .join('')}</tbody></table>`
    : filtered
      ? emptyState('search', 'No books match your search.')
      : emptyState('books', 'No books yet. Click “Add Book” to enter your first book.');

  $('#books-pager').innerHTML = pagerHtml(rows.length, state.books, pages, start, slice.length, 'book');
}

$('#books-table').addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-del]');
  if (edit) {
    const book = state.books.rows.find((b) => b.id === Number(edit.dataset.edit));
    if (book) openBookForm(book);
  } else if (del && !del.disabled) {
    const book = state.books.rows.find((b) => b.id === Number(del.dataset.del));
    if (book) deleteBook(book);
  }
});
bindPager($('#books-pager'), state.books, renderBooks);
$('#book-search').addEventListener(
  'input',
  debounce(() => {
    state.books.query = $('#book-search').value;
    state.books.page = 1;
    attempt(refreshBooks);
  })
);
$('#book-filter-status').addEventListener('change', () => {
  state.books.status = $('#book-filter-status').value;
  state.books.page = 1;
  attempt(refreshBooks);
});
$('#add-book-btn').addEventListener('click', () => openBookForm());
$('#import-books-btn').addEventListener('click', () => openImportDialog());

/* ----- Bulk import from Excel ----- */
function openImportDialog() {
  const m = openModal({
    title: 'Import Books from Excel',
    iconName: 'sheet',
    size: 'import',
    body: '<div id="import-body"></div>',
    foot: '<div id="import-foot" class="import-foot"></div>',
  });
  const body = $('#import-body', m.el);
  const foot = $('#import-foot', m.el);
  // Forget the chosen file when the dialog closes (harmless after a successful import).
  m.onClose = () => window.api.importCancel();

  function showStart(error = '') {
    body.innerHTML = `
      ${error ? `<div class="alert alert-danger import-alert">${icon('alert')}<div><strong>File not accepted</strong>${esc(error)}</div></div>` : ''}
      <ol class="import-steps">
        <li><strong>Download the template</strong><span>Columns: Accession No, LF, CAT, Description of Manual, LOC, Rack. Accession No and Description of Manual are required.</span></li>
        <li><strong>Fill in one book per row</strong><span>Keep the header row. Accession Numbers must be unique. Blank rows are skipped.</span></li>
        <li><strong>Choose the file</strong><span>Every row is checked first. Nothing is saved until you confirm.</span></li>
      </ol>`;
    foot.innerHTML = `<button class="btn btn-ghost left" data-template>${icon('file')}Download Template</button>
      <button class="btn btn-ghost" data-cancel>Cancel</button>
      <button class="btn btn-primary" data-choose>${icon('sheet')}Choose Excel File</button>`;
    $('[data-cancel]', foot).addEventListener('click', m.close);
    $('[data-template]', foot).addEventListener('click', (e) =>
      withBusy(e.currentTarget, async () => {
        const p = await rpc('importTemplate');
        if (p) savedToast('Template', p);
      })
    );
    $('[data-choose]', foot).addEventListener('click', choose);
  }

  async function choose(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    const res = await window.api.importPreview();
    btn.disabled = false;
    if (res.auth) return showLogin();
    if (!res.ok) return showStart(res.error);
    if (res.data) showPreview(res.data);
  }

  function showPreview(p) {
    const bad = p.errors.length;
    const notes = [];
    if (p.missingOptional.length) notes.push(`Columns not in the file (left blank): ${p.missingOptional.join(', ')}.`);
    if (p.ignored.length) notes.push(`Columns ignored: ${p.ignored.join(', ')}.`);
    const shown = p.errors.slice(0, 200);
    body.innerHTML = `
      <div class="import-file">${icon('sheet')}<div><strong>${esc(p.fileName)}</strong><span>Sheet “${esc(p.sheet)}” · header on row ${p.headerRow}</span></div></div>
      <div class="import-stats">
        <div class="istat"><span>Rows found</span><strong>${p.total}</strong></div>
        <div class="istat ok"><span>Ready to import</span><strong>${p.readyCount}</strong></div>
        <div class="istat ${bad ? 'bad' : ''}"><span>Rows with errors</span><strong>${bad}</strong></div>
      </div>
      ${notes.length ? `<div class="alert alert-info import-alert">${icon('alert')}<div>${notes.map(esc).join('<br>')}</div></div>` : ''}
      ${
        bad
          ? `<div class="alert alert-warn import-alert">${icon('alert')}<div><strong>${plural(bad, 'row')} with errors will not be imported</strong>
              ${p.readyCount ? `The ${plural(p.readyCount, 'correct row')} will be saved. ` : ''}The wrong rows will be saved to a separate
              <b>“…_not_imported”</b> Excel file next to your file, with the problem written beside each row. Correct that file and import it again.</div></div>
            <div class="table-wrap import-errors"><table class="table"><thead><tr><th>Excel Row</th><th>Accession No</th><th>Problem</th></tr></thead><tbody>
              ${shown
                .map(
                  (e) => `<tr><td class="num">${e.rowNumber}</td><td class="mono">${esc(e.book_no) || '<span class="muted">—</span>'}</td>
                    <td class="wrap">${e.messages.map(esc).join('<br>')}</td></tr>`
                )
                .join('')}
              ${bad > shown.length ? `<tr><td colspan="3" class="muted">…and ${bad - shown.length} more. Download the error report to see all.</td></tr>` : ''}
            </tbody></table></div>`
          : `<div class="alert alert-ok import-alert">${icon('check')}<div><strong>All rows are valid</strong>Ready to add ${plural(p.readyCount, 'book')} to the library.</div></div>`
      }`;
    const label = p.readyCount
      ? `Import ${plural(p.readyCount, 'Book')}${bad ? ' & Save Wrong Rows' : ''}`
      : 'Save Wrong Rows to Excel';
    foot.innerHTML = `<span class="left"></span>
      <button class="btn btn-ghost" data-back>Choose Another File</button>
      <button class="btn btn-primary" data-import>${icon(p.readyCount ? 'plus' : 'sheet')}${label}</button>`;
    $('[data-back]', foot).addEventListener('click', choose);
    $('[data-import]', foot).addEventListener('click', (e) =>
      withBusy(e.currentTarget, async () => {
        const r = await rpc('importCommit');
        m.close();
        refreshLookups();
        if (state.page === 'books') await refreshBooks();
        const saved = r.imported ? `${plural(r.imported, 'book')} imported.` : 'No books imported.';
        if (!r.skipped) return toast(saved);
        if (!r.rejectsFile) return toast(`${saved} ${plural(r.skipped, 'wrong row')} could not be saved to a file.`, 'err');
        const name = r.rejectsFile.split(/[\\/]/).pop();
        toast(`${saved} ${plural(r.skipped, 'wrong row')} saved to “${name}” — correct it and import again.`, r.imported ? 'ok' : 'info', [
          { label: 'Open', run: () => attempt(() => rpc('openFile', r.rejectsFile)) },
          { label: 'Show in folder', run: () => attempt(() => rpc('showInFolder', r.rejectsFile)) },
        ]);
      })
    );
  }

  showStart();
}

function openBookForm(book = null, prefillNo = '') {
  const isEdit = !!book;
  const b = book || { book_no: prefillNo, lf: '', category: '', name: '', location: '', rack: '' };
  const m = openModal({
    title: isEdit ? 'Edit Book' : 'Add New Book',
    iconName: isEdit ? 'edit' : 'plus',
    body: `<form id="book-form" autocomplete="off" novalidate>
      <label class="field"><span>Accession Number <em>*</em></span><input name="book_no" maxlength="${LIMITS.bookNo}" spellcheck="false" value="${esc(b.book_no)}" placeholder="e.g. OTA-0001" />
        <span class="hint">Must be unique. Letters, numbers and - / _ . only.</span></label>
      <div class="row-2">
        <label class="field"><span>LF</span><input name="lf" maxlength="${LIMITS.lf}" spellcheck="false" value="${esc(b.lf)}" placeholder="e.g. 001-06" /></label>
        <label class="field"><span>CAT</span><input name="category" maxlength="${LIMITS.category}" spellcheck="false" value="${esc(b.category)}" placeholder="e.g. DOR-MM" /></label>
      </div>
      <label class="field"><span>Description of Manual <em>*</em></span><input name="name" maxlength="${LIMITS.bookName}" value="${esc(b.name)}" placeholder="e.g. Airplane Maintenance Manual Vol-I (CG-780)" /></label>
      <div class="row-2">
        <label class="field"><span>LOC</span><input name="location" maxlength="${LIMITS.location}" spellcheck="false" value="${esc(b.location)}" placeholder="e.g. B2" /></label>
        <label class="field"><span>Rack</span><input name="rack" maxlength="${LIMITS.rack}" spellcheck="false" value="${esc(b.rack)}" placeholder="e.g. 6" /></label>
      </div>
      <div class="form-error" hidden></div>
      <button type="submit" hidden></button>
    </form>`,
    foot: `<button class="btn btn-ghost" data-close>Cancel</button>
      ${isEdit ? '' : '<button class="btn btn-soft" data-another>Save &amp; Add Another</button>'}
      <button class="btn btn-primary" data-save>${isEdit ? 'Save Changes' : 'Save Book'}</button>`,
  });
  const form = $('#book-form', m.el);
  attachSuggest(form.category, () => state.lookups.categories);
  const errBox = $('.form-error', form);
  const first = isEdit || !prefillNo ? form.book_no : form.name;
  setTimeout(() => first.focus(), 30);

  async function save(another) {
    errBox.hidden = true;
    const valid = validateFields([
      [form.book_no, RULES.bookNo],
      [form.lf, RULES.lf],
      [form.category, RULES.category],
      [form.name, RULES.bookName],
      [form.location, RULES.location],
      [form.rack, RULES.rack],
    ]);
    if (!valid) return;
    const data = Object.fromEntries(new FormData(form).entries());
    if (isEdit) data.id = book.id;
    const res = await window.api.saveBook(data);
    if (!res.ok) {
      if (/Accession Number/i.test(res.error)) {
        showFieldError(form.book_no, res.error);
        form.book_no.focus();
        form.book_no.select();
      } else {
        errBox.textContent = res.error;
        errBox.hidden = false;
      }
      return;
    }
    toast(isEdit ? `Book “${res.data.name}” updated.` : `Book “${res.data.name}” (${res.data.book_no}) added.`);
    refreshLookups();
    if (state.page === 'books') attempt(refreshBooks);
    if (another) {
      // Entries usually come in runs from the same shelf, so keep CAT / LOC / Rack.
      const keep = { category: form.category.value, location: form.location.value, rack: form.rack.value };
      form.reset();
      form.book_no.value = '';
      form.lf.value = '';
      form.name.value = '';
      form.category.value = keep.category;
      form.location.value = keep.location;
      form.rack.value = keep.rack;
      clearFieldErrors(form);
      form.book_no.focus();
    } else {
      m.close();
      if (m.afterSave) m.afterSave(res.data);
    }
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save(false);
  });
  $('[data-save]', m.el).addEventListener('click', () => save(false));
  const another = $('[data-another]', m.el);
  if (another) another.addEventListener('click', () => save(true));
  return m;
}

async function deleteBook(book) {
  const ok = await confirmDialog({
    title: 'Delete this book?',
    message: `“${book.name}” (${book.book_no}) will be removed from the catalogue. Past circulation records are kept in reports.`,
    okLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await attempt(async () => {
    await rpc('deleteBook', book.id);
    toast(`Book ${book.book_no} deleted.`);
    refreshLookups();
    await refreshBooks();
  });
}

/* ================= Circulation ================= */
function bookCard(b) {
  return `<div class="book-card">
    <div class="book-card-head"><div><div class="eyebrow">Book details</div><h3>${esc(b.name)}</h3></div>${badge(b.status)}</div>
    <dl class="details">
      <dt>Accession No</dt><dd class="mono">${esc(b.book_no)}</dd>
      <dt>LF</dt><dd class="mono">${esc(b.lf) || '—'}</dd>
      <dt>CAT</dt><dd>${esc(b.category) || '—'}</dd>
      <dt>Location</dt><dd>LOC ${esc(b.location) || '—'} · Rack ${esc(b.rack) || '—'}</dd>
    </dl>
  </div>`;
}

function notFound(kind, bookNo) {
  const box = $(`#${kind}-result`);
  box.innerHTML = `<div class="result"><div class="alert alert-danger">${icon('alert')}<div><strong>Book not found</strong>
    No book with Accession Number “${esc(bookNo)}” exists in the catalogue.</div></div>
    ${kind === 'issue' ? '<div class="form-actions start"><button class="btn btn-soft" data-addbook>' + icon('plus') + 'Add this book</button></div>' : ''}</div>`;
  const add = $('[data-addbook]', box);
  if (add) {
    add.addEventListener('click', () => {
      const m = openBookForm(null, bookNo);
      m.afterSave = (b) => {
        $('#issue-scan').value = b.book_no;
        lookup('issue');
      };
    });
  }
  const input = $(`#${kind}-scan`);
  input.select();
}

// Issue page: book summary with the shelf details as tiles.
function issueBookHead(b) {
  const spec = (label, value) => `<div class="spec"><span>${label}</span><strong>${esc(value) || '—'}</strong></div>`;
  return `<div class="sheet-book">
      <div class="sheet-book-icon">${icon('book')}</div>
      <div class="sheet-book-main">
        <div class="sheet-accession">Accession No <span class="chip mono">${esc(b.book_no)}</span></div>
        <h3>${esc(b.name)}</h3>
      </div>
      ${badge(b.status)}
    </div>
    <div class="spec-row">${spec('LF', b.lf)}${spec('CAT', b.category)}${spec('LOC', b.location)}${spec('Rack', b.rack)}</div>`;
}

function circGuide(kind) {
  const step = (n, title, text) =>
    `<div class="guide-step"><span class="step">${n}</span><div><strong>${title}</strong><span>${text}</span></div></div>`;
  return kind === 'issue'
    ? `<div class="card issue-guide">
        ${step(1, 'Enter the Accession Number', 'Type the Accession Number of the book above and press Enter.')}
        ${step(2, 'Enter borrower details', 'Name of the person, loan days and any remarks.')}
        ${step(3, 'Issue the book', 'The issue date and due date are set automatically.')}
      </div>`
    : `<div class="card issue-guide guide-green">
        ${step(1, 'Enter the Accession Number', 'Type the Accession Number of the returned book above and press Enter.')}
        ${step(2, 'Check the details', 'See who borrowed it, the due date and whether it is late.')}
        ${step(3, 'Return the book', 'Confirm who returned it. The book becomes available again.')}
      </div>`;
}

async function resetCirc(kind) {
  $(`#${kind}-result`).innerHTML = circGuide(kind);
  $(`#${kind}-scan`).value = '';
  $(`#${kind}-scan`).focus();
  await Promise.all([loadRecords(kind), loadCircSummary(), refreshLookups()]);
}

// "At a glance" numbers shown beside the Issue and Return forms.
async function loadCircSummary() {
  const [s, issuedToday, returnedToday] = await Promise.all([rpc('dashboard'), rpc('todaysActivity', 'issue'), rpc('todaysActivity', 'return')]);
  const stat = (label, value, cls, iconName) =>
    `<div class="mini-stat ${cls}"><div class="mini-icon">${icon(iconName)}</div><div><span>${label}</span><strong>${value}</strong></div></div>`;
  const html = `<div class="card-head"><h3>${icon('calendar')}At a glance</h3><span class="muted tiny">${esc(fmtDate(s.today))}</span></div>
    <div class="mini-stats">
      ${stat('Issued today', issuedToday.length, 'indigo', 'out')}
      ${stat('Returned today', returnedToday.length, 'green', 'in')}
      ${stat('Currently issued', s.issued, 'blue', 'books')}
      ${stat('Overdue now', s.overdue, s.overdue ? 'rose' : 'muted', 'alert')}
    </div>
    <p class="muted tiny glance-note">${s.dueSoon.length ? `${plural(s.dueSoon.length, 'book')} due in the next 3 days.` : 'Nothing due in the next 3 days.'}</p>`;
  $$('[data-summary]').forEach((el) => (el.innerHTML = html));
}

/* ----- Issued / returned books tables ----- */
const RECORD_RANGES = [
  ['today', 'Today'],
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['all', 'All'],
];
const records = {
  issue: { range: 'today', q: '', page: 1, size: 25, rows: [], seq: 0 },
  return: { range: 'today', q: '', page: 1, size: 25, rows: [], seq: 0 },
};

function recordsShell(kind) {
  const box = $(`#${kind}-records`);
  if (box.dataset.ready) return;
  box.dataset.ready = '1';
  const st = records[kind];
  const issue = kind === 'issue';
  box.innerHTML = `<div class="records-head">
      <div><h3>${icon(issue ? 'out' : 'in')}${issue ? 'Issued books' : 'Returned books'} <span class="pill pill-indigo" data-count>0</span></h3>
        <p class="muted" data-caption></p></div>
      <div class="records-tools">
        <div class="range-chips" role="group" aria-label="Period">${RECORD_RANGES.map(([v, l]) => `<button class="range-chip ${v === st.range ? 'on' : ''}" data-range="${v}">${l}</button>`).join('')}</div>
        <div class="search"><svg><use href="#i-search"/></svg><input data-q type="search" maxlength="100" placeholder="Search accession no, description or name…" /></div>
      </div>
    </div>
    <div class="table-wrap" data-table></div>
    <div class="pager" data-pager></div>`;
  $('.range-chips', box).addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    st.range = b.dataset.range;
    st.page = 1;
    $$('.range-chip', box).forEach((c) => c.classList.toggle('on', c === b));
    attempt(() => loadRecords(kind));
  });
  $('[data-q]', box).addEventListener(
    'input',
    debounce((e) => {
      st.q = e.target.value.trim();
      st.page = 1;
      attempt(() => loadRecords(kind));
    }, 250)
  );
  bindPager($('[data-pager]', box), st, () => renderRecords(kind));
}

async function loadRecords(kind) {
  recordsShell(kind);
  const st = records[kind];
  const t = isoToday();
  const from = st.range === 'today' ? t : st.range === 'all' ? '' : addDays(t, -(Number(st.range) - 1));
  const filters =
    kind === 'issue'
      ? { dateBy: 'issue', from, to: st.range === 'all' ? '' : t, q: st.q }
      : { dateBy: 'return', from, to: st.range === 'all' ? '' : t, q: st.q, status: 'AllReturned' };
  const seq = ++st.seq;
  const rows = await rpc('circList', filters);
  if (seq !== st.seq) return; // a newer request superseded this one
  st.rows = rows;
  renderRecords(kind);
}

function renderRecords(kind) {
  const box = $(`#${kind}-records`);
  const st = records[kind];
  const issue = kind === 'issue';
  const rangeText = { today: 'today', 7: 'in the last 7 days', 30: 'in the last 30 days', all: 'so far' }[st.range];
  $('[data-count]', box).textContent = st.rows.length;
  $('[data-caption]', box).textContent = `${issue ? 'Books issued' : 'Books returned'} ${rangeText}${st.q ? ` matching “${st.q}”` : ''}.`;
  const { pages, start, slice } = pageSlice(st.rows, st);
  const dash = '<span class="muted">—</span>';
  const head = issue
    ? '<th class="idx">#</th><th>Accession No</th><th>Description</th><th>Issued To</th><th>Issue Date</th><th>Due Date</th><th>Status</th><th>Remarks</th>'
    : '<th class="idx">#</th><th>Accession No</th><th>Description</th><th>Issued To</th><th>Returned By</th><th>Issue Date</th><th>Due Date</th><th>Return Date</th><th>Status</th>';
  const row = (r, i) =>
    issue
      ? `<tr><td class="idx muted">${start + i + 1}</td><td class="mono">${esc(r.book_no)}</td><td class="strong wrap">${esc(r.book_name)}</td>
          <td>${esc(r.issue_user)}</td><td class="date">${esc(fmtDate(r.issue_date))}</td><td class="date">${esc(fmtDate(r.due_date))}</td>
          <td>${badge(r.status)}</td><td class="wrap">${esc(r.issue_remarks) || dash}</td></tr>`
      : `<tr><td class="idx muted">${start + i + 1}</td><td class="mono">${esc(r.book_no)}</td><td class="strong wrap">${esc(r.book_name)}</td>
          <td>${esc(r.issue_user)}</td><td>${esc(r.return_user)}</td><td class="date">${esc(fmtDate(r.issue_date))}</td>
          <td class="date">${esc(fmtDate(r.due_date))}</td><td class="date">${esc(fmtDate(r.return_date))}</td><td>${badge(r.status)}</td></tr>`;
  const none = st.q
    ? 'No books match your search.'
    : issue
      ? `No books issued ${rangeText}.`
      : `No books returned ${rangeText}.`;
  $('[data-table]', box).innerHTML = slice.length
    ? `<table class="table"><thead><tr>${head}</tr></thead><tbody>${slice.map(row).join('')}</tbody></table>`
    : emptyState(issue ? 'out' : 'in', none);
  $('[data-pager]', box).innerHTML = pagerHtml(st.rows.length, st, pages, start, slice.length, 'book');
}

async function lookup(kind) {
  const input = $(`#${kind}-scan`);
  const bookNo = input.value.trim();
  if (!bookNo) {
    showFieldError(input, 'Enter an Accession Number.');
    input.focus();
    return;
  }
  showFieldError(input, '');
  const res = await attempt(() => rpc('lookup', bookNo));
  if (!res) return;
  if (!res.book) return notFound(kind, bookNo);
  input.value = res.book.book_no;
  if (kind === 'issue') renderIssue(res);
  else renderReturn(res);
}

['issue', 'return'].forEach((kind) => {
  $(`#${kind}-scan`).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      lookup(kind);
    }
  });
  $(`#${kind}-find`).addEventListener('click', () => lookup(kind));
});

function renderIssue({ book, overdueDays }) {
  const box = $('#issue-result');
  if (book.issue_id) {
    box.innerHTML = `<div class="card flush issue-sheet">${issueBookHead(book)}
      <div class="sheet-body">
        <div class="alert alert-warn">${icon('alert')}<div><strong>This book is already issued</strong>
        Issued to <b>${esc(book.issue_user)}</b> on ${esc(fmtDate(book.issue_date))}, due ${esc(fmtDate(book.due_date))}${
          overdueDays > 0 ? ` — <b>overdue by ${plural(overdueDays, 'day')}</b>` : ''
        }. It must be returned before it can be issued again.</div></div>
      </div></div>`;
    $('#issue-scan').select();
    return;
  }
  const today = isoToday();
  const dur = state.settings.defaultDuration || 14;
  box.innerHTML = `<div class="card flush issue-sheet">${issueBookHead(book)}
    <form id="issue-form" autocomplete="off" novalidate>
      <div class="sheet-body">
        <div class="sheet-title">${icon('user')}Borrower details</div>
        <div class="issue-fields">
          <label class="field"><span>User Name <em>*</em></span><input name="userName" maxlength="${LIMITS.person}" placeholder="Start typing — names used before are suggested" /></label>
          <label class="field"><span>Loan period (days) <em>*</em></span><input name="duration" type="number" min="1" max="365" step="1" value="${dur}" /></label>
        </div>
        <label class="field"><span>Remarks</span><textarea name="remarks" rows="2" maxlength="${LIMITS.remarks}" placeholder="Optional"></textarea></label>
        <div class="due-banner">
          <div class="due-banner-icon">${icon('calendar')}</div>
          <div><span>Issue date</span><strong>${esc(fmtDate(today))}</strong></div>
          <div class="due-arrow">${icon('arrow-r')}</div>
          <div><span>Due back on</span><strong id="due-preview">${esc(fmtDate(addDays(today, dur)))}</strong></div>
          <div class="due-days" id="due-days">${plural(dur, 'day')}</div>
        </div>
        <div class="form-error" hidden></div>
      </div>
      <div class="sheet-foot">
        <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary btn-lg">${icon('out')}Issue Book</button>
      </div>
    </form></div>`;
  const form = $('#issue-form');
  const errBox = $('.form-error', form);
  attachSuggest(form.userName, () => state.lookups.borrowers);
  attachCounters(form);
  form.userName.focus();
  form.duration.addEventListener('input', () => {
    const n = Number(form.duration.value);
    const ok = Number.isInteger(n) && n >= 1 && n <= 365;
    $('#due-preview').textContent = ok ? fmtDate(addDays(today, n)) : '—';
    $('#due-days').textContent = ok ? plural(n, 'day') : '—';
  });
  $('[data-cancel]', form).addEventListener('click', () => resetCirc('issue'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const valid = validateFields([
      [form.userName, (v) => RULES.person(v, 'User Name')],
      [form.duration, RULES.duration],
      [form.remarks, RULES.remarks],
    ]);
    if (!valid) return;
    const userName = form.userName.value.trim();
    const duration = Number(form.duration.value);
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    const res = await window.api.issueBook({ bookNo: book.book_no, userName, duration, remarks: form.remarks.value });
    btn.disabled = false;
    if (!res.ok) {
      errBox.textContent = res.error;
      errBox.hidden = false;
      return;
    }
    toast(`“${book.name}” issued to ${res.data.issue_user}. Due ${fmtDate(res.data.due_date)}.`);
    refreshLookups();
    attempt(() => resetCirc('issue'));
  });
}

function renderReturn({ book, overdueDays }) {
  const box = $('#return-result');
  if (!book.issue_id) {
    box.innerHTML = `<div class="card flush issue-sheet">${issueBookHead(book)}
      <div class="sheet-body"><div class="alert alert-info">${icon('check')}<div><strong>This book is not issued</strong>
      It is already available on the shelf, so there is nothing to return.</div></div></div></div>`;
    $('#return-scan').select();
    return;
  }
  const late = overdueDays > 0;
  const info = (label, value, cls = '') => `<div class="info"><span>${label}</span><strong class="${cls}">${value}</strong></div>`;
  box.innerHTML = `<div class="card flush issue-sheet">${issueBookHead(book)}
    <form id="return-form" autocomplete="off" novalidate>
      <div class="sheet-body">
        <div class="sheet-title">${icon('user')}Issue details</div>
        <div class="info-grid">
          ${info('Issued to', esc(book.issue_user))}
          ${info('Issue date', esc(fmtDate(book.issue_date)))}
          ${info('Due date', esc(fmtDate(book.due_date)), late ? 'hl' : '')}
          ${info('Loan period', plural(book.duration, 'day'))}
        </div>
        ${book.issue_remarks ? `<div class="info-note"><span>Issue remarks</span>${esc(book.issue_remarks)}</div>` : ''}
        ${
          late
            ? `<div class="alert alert-danger">${icon('alert')}<div><strong>Overdue by ${plural(overdueDays, 'day')}</strong>This return will be recorded as <b>Returned Late</b>.</div></div>`
            : `<div class="alert alert-ok">${icon('check')}<div><strong>Within due date</strong>This book is being returned on time.</div></div>`
        }
        <div class="sheet-title sheet-title-gap">${icon('in')}Return details</div>
        <div class="issue-fields">
          <label class="field"><span>Returned By (User Name) <em>*</em></span><input name="userName" maxlength="${LIMITS.person}" value="${esc(book.issue_user)}" /></label>
          <div class="field"><span>Return date</span><div class="due-preview">${icon('calendar')}<span>${esc(fmtDate(isoToday()))}</span></div></div>
        </div>
        <label class="field"><span>Remarks</span><textarea name="remarks" rows="2" maxlength="${LIMITS.remarks}" placeholder="e.g. book condition"></textarea></label>
        <div class="form-error" hidden></div>
      </div>
      <div class="sheet-foot">
        <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-success btn-lg">${icon('in')}Return Book</button>
      </div>
    </form></div>`;
  const form = $('#return-form');
  const errBox = $('.form-error', form);
  attachCounters(form);
  attachSuggest(form.userName, () => state.lookups.borrowers);
  form.remarks.focus();
  $('[data-cancel]', form).addEventListener('click', () => resetCirc('return'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const valid = validateFields([
      [form.userName, (v) => RULES.person(v, 'Returned By')],
      [form.remarks, RULES.remarks],
    ]);
    if (!valid) return;
    const userName = form.userName.value.trim();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    const res = await window.api.returnBook({ bookNo: book.book_no, userName, remarks: form.remarks.value });
    btn.disabled = false;
    if (!res.ok) {
      errBox.textContent = res.error;
      errBox.hidden = false;
      return;
    }
    toast(
      res.data.returned_late ? `“${book.name}” returned late (${plural(overdueDays, 'day')} overdue).` : `“${book.name}” returned. It is now available.`,
      res.data.returned_late ? 'info' : 'ok'
    );
    refreshLookups();
    attempt(() => resetCirc('return'));
  });
}

/* ================= Reports ================= */
const DATE_BY_TEXT = { issue: 'issued', return: 'returned', due: 'due back' };
const repPage = { page: 1, size: 25 };
let reportRows = null;

// Date range checks. Issue/return dates can't be in the future; due dates can.
function checkReportRange() {
  if (state.report !== 'circulation') return true;
  const from = $('#rf-from');
  const to = $('#rf-to');
  const t = isoToday();
  const allowFuture = $('#rf-dateby').value === 'due';
  from.max = allowFuture ? '' : t;
  to.max = allowFuture ? '' : t;
  to.min = from.value || '';
  const future = (v) => !allowFuture && v && v > t;
  return validateFields([
    [from, (v) => (future(v) ? '"From" cannot be a future date.' : '')],
    [to, (v) => (future(v) ? '"To" cannot be a future date.' : v && from.value && v < from.value ? '"To" must be on or after "From".' : '')],
  ]);
}

function reportFilters() {
  const q = $('#rep-search').value.trim();
  switch (state.report) {
    case 'books':
      return { category: $('#rf-category').value, location: $('#rf-location').value, rack: $('#rf-rack').value, status: $('#rf-status').value, q };
    case 'circulation':
      return {
        dateBy: $('#rf-dateby').value,
        from: $('#rf-from').value,
        to: $('#rf-to').value,
        status: $('#rf-cstatus').value,
        userName: $('#rf-user').value.trim(),
        bookNo: $('#rf-bookno').value.trim(),
        q,
      };
    default:
      return { asOn: $('#rf-ason').value || isoToday(), userName: $('#rf-ouser').value.trim(), bookNo: $('#rf-obookno').value.trim(), q };
  }
}

// Plain-language line under the filters saying exactly what is being shown.
function updateReportHint() {
  const hint = $('#rf-hint');
  if (state.report === 'circulation') {
    const by = $('#rf-dateby').value;
    const f = $('#rf-from').value;
    const t = $('#rf-to').value;
    const range = f && t ? (f === t ? `on ${fmtDate(f)}` : `between ${fmtDate(f)} and ${fmtDate(t)}`) : f ? `on or after ${fmtDate(f)}` : t ? `on or before ${fmtDate(t)}` : 'on any date';
    hint.innerHTML = `${icon('calendar')}<span>Showing books <b>${DATE_BY_TEXT[by]}</b> ${esc(range)}. Change “Date based on” to filter by issue, return or due date.</span>`;
  } else if (state.report === 'overdue') {
    hint.innerHTML = `${icon('alert')}<span>Books that were past their due date and not yet returned on <b>${esc(fmtDate($('#rf-ason').value || isoToday()))}</b>.</span>`;
  } else {
    hint.innerHTML = `${icon('books')}<span>All books in the library. Narrow down by CAT, LOC, Rack or status.</span>`;
  }
}

async function loadReportsPage(opts = {}) {
  if (!$('#rf-ason').value) $('#rf-ason').value = isoToday();
  // Circulation range starts on today; clear either date to widen it.
  if (!state.reportDatesSet) {
    $('#rf-from').value = isoToday();
    $('#rf-to').value = isoToday();
    state.reportDatesSet = true;
  }
  setReport(opts.report || state.report);
  await refreshLookups();
}

function setReport(type) {
  state.report = type;
  $$('#report-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.report === type));
  $$('.filter-set').forEach((f) => (f.hidden = f.dataset.for !== type));
  clearFieldErrors($('.report-filters'));
  $('#rep-search').value = '';
  repPage.page = 1;
  attempt(refreshReport);
}

let reportSeq = 0;
async function refreshReport() {
  updateReportHint();
  if (!checkReportRange()) {
    reportSeq++; // drop any request still in flight
    reportRows = null;
    $('#rep-filter-text').textContent = 'Invalid date range';
    $('#rep-summary').textContent = '—';
    $('#report-table').innerHTML = emptyState('calendar', 'Correct the date range above to view the report.');
    $('#report-pager').innerHTML = '';
    return;
  }
  const seq = ++reportSeq;
  const rep = await rpc('report', state.report, reportFilters());
  if (seq !== reportSeq) return; // a newer request superseded this one
  $('#rep-title').textContent = rep.title;
  $('#rep-filter-text').textContent = rep.filterText;
  $('#rep-summary').textContent = rep.summary;
  reportRows = rep;
  renderReportTable();
}

function renderReportTable() {
  const rep = reportRows;
  if (!rep) return;
  const { pages, start, slice } = pageSlice(rep.rows, repPage);
  const dash = '<span class="muted">—</span>';
  $('#report-table').innerHTML = slice.length
    ? `<table class="table"><thead><tr><th class="idx">#</th>${rep.columns.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
      ${slice
        .map(
          (r, i) =>
            `<tr><td class="idx muted">${start + i + 1}</td>${rep.columns
              .map((c) => {
                const v = r[c.key];
                if (c.key === 'status') return `<td>${badge(v)}</td>`;
                if (c.key === 'book_no') return `<td class="mono">${esc(v)}</td>`;
                if (c.date) return `<td class="date">${esc(fmtDate(v)) || dash}</td>`;
                if (c.num) return `<td class="num"><span class="badge badge-overdue">${plural(v, 'day')}</span></td>`;
                if (c.key === 'name' || c.key === 'book_name') return `<td class="strong wrap">${esc(v)}</td>`;
                return `<td class="${c.key === 'remarks' ? 'wrap' : 'nowrap'}">${esc(v) || dash}</td>`;
              })
              .join('')}</tr>`
        )
        .join('')}</tbody></table>`
    : emptyState('file', $('#rep-search').value.trim() ? 'Nothing in this report matches your search.' : 'No records match the selected filters.');
  $('#report-pager').innerHTML = pagerHtml(rep.rows.length, repPage, pages, start, slice.length, 'record');
}

function refreshReportFromStart() {
  repPage.page = 1;
  attempt(refreshReport);
}

$$('#report-tabs .tab').forEach((t) => t.addEventListener('click', () => setReport(t.dataset.report)));
['#rf-category', '#rf-location', '#rf-rack', '#rf-status', '#rf-dateby', '#rf-from', '#rf-to', '#rf-cstatus'].forEach((sel) =>
  $(sel).addEventListener('change', refreshReportFromStart)
);
// An empty "As on" date falls back to today.
$('#rf-ason').addEventListener('change', () => {
  if (!$('#rf-ason').value) $('#rf-ason').value = isoToday();
  refreshReportFromStart();
});
['#rf-user', '#rf-bookno', '#rf-ouser', '#rf-obookno', '#rep-search'].forEach((sel) =>
  $(sel).addEventListener('input', debounce(refreshReportFromStart, 300))
);
attachSuggest($('#rf-user'), () => state.lookups.borrowers);
attachSuggest($('#rf-ouser'), () => state.lookups.borrowers);
bindPager($('#report-pager'), repPage, renderReportTable);

$('#rep-reset').addEventListener('click', () => {
  ['#rf-category', '#rf-location', '#rf-rack', '#rf-status', '#rf-cstatus'].forEach((sel) => ($(sel).value = ''));
  ['#rf-user', '#rf-bookno', '#rf-ouser', '#rf-obookno', '#rep-search'].forEach((sel) => ($(sel).value = ''));
  $('#rf-dateby').value = 'issue';
  $('#rf-from').value = isoToday();
  $('#rf-to').value = isoToday();
  $('#rf-ason').value = isoToday();
  clearFieldErrors($('.report-filters'));
  refreshReportFromStart();
});

function savedToast(what, filePath) {
  toast(`${what} saved: ${filePath.split(/[\\/]/).pop()}`, 'ok', [
    { label: 'Open', run: () => attempt(() => rpc('openFile', filePath)) },
    { label: 'Show in folder', run: () => attempt(() => rpc('showInFolder', filePath)) },
  ]);
}

async function withBusy(btn, fn) {
  btn.disabled = true;
  try {
    return await attempt(fn);
  } finally {
    btn.disabled = false;
  }
}

$('#rep-excel').addEventListener('click', (e) =>
  checkReportRange() &&
  withBusy(e.currentTarget, async () => {
    const p = await rpc('exportExcel', state.report, reportFilters());
    if (p) savedToast('Excel file', p);
  })
);
$('#rep-pdf').addEventListener('click', (e) =>
  checkReportRange() &&
  withBusy(e.currentTarget, async () => {
    const p = await rpc('exportPdf', state.report, reportFilters());
    if (p) savedToast('PDF', p);
  })
);

/* ================= Settings ================= */
async function loadSettings() {
  const [s, info] = await Promise.all([rpc('getSettings'), rpc('appInfo')]);
  state.settings = s;
  clearFieldErrors($('#page-settings'));
  $('#set-duration').value = s.defaultDuration;
  $('#data-file').textContent = `Data file: ${info.dataFile}  ·  Version ${info.version}`;
  await loadUsers();
}

/* ----- Users ----- */
async function loadUsers() {
  state.users = await rpc('listUsers');
  renderUsers();
}

function renderUsers() {
  const users = state.users;
  const q = ($('#users-search').value || '').trim().toLowerCase();
  const shown = q ? users.filter((u) => u.username.toLowerCase().includes(q)) : users;
  $('#users-count').textContent = users.length;
  const others = shown.filter((u) => !u.me).length;
  $('#users-table').innerHTML = shown.length
    ? `<table class="table users-table"><thead><tr>
      <th class="check"><input type="checkbox" id="users-all" title="Select all" ${others ? '' : 'disabled'} /></th>
      <th class="idx">#</th><th>Username</th><th>Status</th><th class="actions">Actions</th></tr></thead><tbody>
    ${shown
      .map(
        (u, i) => `<tr class="${u.me ? 'me' : ''}">
        <td class="check"><input type="checkbox" data-user-check="${u.id}" ${u.me ? 'disabled title="You cannot delete your own account"' : ''} /></td>
        <td class="idx muted">${i + 1}</td>
        <td><div class="user-cell"><div class="avatar-sm ${u.active ? '' : 'off'}">${esc(u.username.charAt(0).toUpperCase())}</div><strong>${esc(u.username)}</strong>${u.me ? '<span class="you-tag">You</span>' : ''}</div></td>
        <td>${u.active ? '<span class="badge badge-active"><i></i>Active</span>' : '<span class="badge badge-inactive"><i></i>Inactive</span>'}</td>
        <td class="actions">
          <button class="icon-btn" data-user-edit="${u.id}" title="Edit">${icon('edit')}</button>
          <button class="icon-btn danger" data-user-del="${u.id}" ${u.me ? 'disabled title="You cannot delete your own account"' : 'title="Delete"'}>${icon('trash')}</button>
        </td></tr>`
      )
      .join('')}</tbody></table>`
    : emptyState('search', 'No users match your search.');
  updateUserSelection();
}

function selectedUserIds() {
  return $$('[data-user-check]:checked', $('#users-table')).map((c) => Number(c.dataset.userCheck));
}

// Keeps the "select all" box and the Delete Selected button in step with the row checkboxes.
function updateUserSelection() {
  const boxes = $$('[data-user-check]:not(:disabled)', $('#users-table'));
  const n = selectedUserIds().length;
  const all = $('#users-all');
  if (all) {
    all.checked = boxes.length > 0 && n === boxes.length;
    all.indeterminate = n > 0 && n < boxes.length;
  }
  $$('tr', $('#users-table')).forEach((tr) => {
    const c = $('[data-user-check]', tr);
    tr.classList.toggle('selected', !!(c && c.checked));
  });
  const btn = $('#delete-users-btn');
  btn.disabled = n === 0;
  $('span', btn).textContent = n ? `Delete Selected (${n})` : 'Delete Selected';
}

function syncSignedInName(username) {
  state.user.username = username;
  state.settings.username = username;
  $('#who-name').textContent = username;
  $('#avatar').textContent = username.charAt(0);
}

function openUserForm(user = null) {
  const isEdit = !!user;
  const m = openModal({
    title: isEdit ? `Edit User “${user.username}”` : 'Add User',
    iconName: isEdit ? 'edit' : 'plus',
    size: 'small',
    body: `<form id="user-form" autocomplete="off" novalidate>
      <label class="field"><span>Username <em>*</em></span><input name="username" maxlength="30" spellcheck="false" value="${esc(isEdit ? user.username : '')}" />
        <span class="hint">3–30 characters: letters, numbers, . _ - (no spaces).</span></label>
      <label class="field"><span>Password${isEdit ? '' : ' <em>*</em>'}</span><input name="password" type="password" maxlength="64" ${isEdit ? 'placeholder="Leave blank to keep the current password"' : ''} />
        <span class="hint">At least 4 characters.</span></label>
      <div class="field"><span>Status</span>
        <div class="segmented" role="radiogroup" aria-label="Status">
          <label class="seg seg-active"><input type="radio" name="active" value="1" ${!isEdit || user.active ? 'checked' : ''} /><span><i></i>Active</span></label>
          <label class="seg seg-inactive"><input type="radio" name="active" value="0" ${isEdit && !user.active ? 'checked' : ''} ${isEdit && user.me ? 'disabled' : ''} /><span><i></i>Inactive</span></label>
        </div>
        <span class="hint">${isEdit && user.me ? 'You cannot make your own account inactive.' : 'Inactive users cannot sign in. Their records are kept.'}</span>
      </div>
      <div class="form-error" hidden></div>
      <button type="submit" hidden></button>
    </form>`,
    foot: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-save>${isEdit ? 'Save Changes' : 'Create User'}</button>`,
  });
  const form = $('#user-form', m.el);
  const errBox = $('.form-error', form);
  enhancePasswords(form);
  if (!isEdit) enterMovesTo(form.username, form.password); // password is optional when editing
  setTimeout(() => form.username.focus(), 30);

  async function save() {
    errBox.hidden = true;
    const password = form.password.value;
    const valid = validateFields([
      [form.username, RULES.username],
      [form.password, (v) => (!isEdit && !v ? 'Password is required.' : RULES.newPassword(v))],
    ]);
    if (!valid) return;
    const payload = { username: form.username.value.trim(), password, active: form.active.value === '1' };
    const res = isEdit ? await window.api.updateUser(user.id, payload) : await window.api.createUser(payload);
    if (!res.ok) {
      if (/username/i.test(res.error)) showFieldError(form.username, res.error);
      else {
        errBox.textContent = res.error;
        errBox.hidden = false;
      }
      return;
    }
    if (isEdit && user.me) syncSignedInName(res.data.username);
    toast(isEdit ? `User “${res.data.username}” updated.` : `User “${res.data.username}” created.`);
    m.close();
    attempt(loadSettings);
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
  $('[data-save]', m.el).addEventListener('click', save);
}

$('#add-user-btn').addEventListener('click', () => openUserForm());
$('#users-search').addEventListener('input', debounce(renderUsers, 150));
$('#users-table').addEventListener('change', (e) => {
  if (e.target.id === 'users-all') {
    $$('[data-user-check]:not(:disabled)', $('#users-table')).forEach((c) => (c.checked = e.target.checked));
  }
  updateUserSelection();
});
$('#delete-users-btn').addEventListener('click', async () => {
  const ids = selectedUserIds();
  if (!ids.length) return;
  const names = state.users.filter((u) => ids.includes(u.id)).map((u) => u.username);
  const ok = await confirmDialog({
    title: `Delete ${plural(ids.length, 'user')}?`,
    message: `${names.join(', ')} will no longer be able to sign in. Library records are not affected.`,
    okLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await attempt(async () => {
    const n = await rpc('deleteUsers', ids);
    toast(`${plural(n, 'user')} deleted.`);
    await loadUsers();
  });
});
$('#users-table').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-user-edit]');
  const del = e.target.closest('[data-user-del]');
  if (edit) {
    const user = state.users.find((u) => u.id === Number(edit.dataset.userEdit));
    if (user) openUserForm(user);
  } else if (del && !del.disabled) {
    const user = state.users.find((u) => u.id === Number(del.dataset.userDel));
    if (!user) return;
    const ok = await confirmDialog({
      title: 'Delete this user?',
      message: `“${user.username}” will no longer be able to sign in. Library records are not affected.`,
      okLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await attempt(async () => {
      await rpc('deleteUser', user.id);
      toast(`User “${user.username}” deleted.`);
      await loadUsers();
    });
  }
});

// Copyright footer opens the 2CQR website in the default browser.
$$('[data-website]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openWebsite();
  })
);

$('#duration-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!validateFields([[$('#set-duration'), RULES.duration]])) return;
  attempt(async () => {
    state.settings = await rpc('setDefaultDuration', Number($('#set-duration').value));
    toast(`Default loan duration set to ${plural(state.settings.defaultDuration, 'day')}.`);
  });
});

$('#backup-btn').addEventListener('click', (e) =>
  withBusy(e.currentTarget, async () => {
    const p = await rpc('backup');
    if (p) savedToast('Backup', p);
  })
);

$('#restore-btn').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Restore from backup?',
    message: 'All current books and circulation records will be replaced by the backup file. A safety copy of the current data is kept automatically.',
    okLabel: 'Choose backup file',
    danger: true,
  });
  if (!ok) return;
  await attempt(async () => {
    const p = await rpc('restore');
    if (!p) return;
    await showLogin();
    toast('Backup restored. Please sign in again.');
  });
});

/* ================= Boot ================= */
enhancePasswords($('#login-form'));
enterMovesTo($('#login-username'), $('#login-password'));
showLogin();
