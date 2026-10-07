'use strict';
// Shared screen helpers: escaping and safe HTML, suggestions, paging, password boxes,
// field validation, calls to the main process, toasts and dialogs.
// Screen scripts share one global scope and load in order from index.html.

/* ================= Helpers ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// The one way the screens put HTML on the page. Values are already escaped with esc(); DOMPurify
// then removes anything executable as a second line of defence. SANITIZE_DOM is off so that form
// fields such as name="name" / name="location" are kept. <use> is allowed only for the icon sprite.
const PURIFY = { RETURN_DOM_FRAGMENT: true, SANITIZE_DOM: false, ADD_TAGS: ['use'] };
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName.toLowerCase() !== 'use') return;
  if (!/^#i-[\w-]+$/.test(node.getAttribute('href') || '')) node.removeAttribute('href');
  node.removeAttribute('xlink:href');
});
function setHtml(el, html) {
  el.replaceChildren(DOMPurify.sanitize(html, PURIFY));
}
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
    setHtml(box, `<div class="suggest-head">Used before</div>` +
      items.map((v, i) => `<div class="suggest-item" role="option" data-i="${i}">${icon('user')}<span>${highlight(v, q)}</span></div>`).join(''));
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
  const sizeOptions = PAGE_SIZES.map((n) => `<option value="${n}" ${n === st.size ? 'selected' : ''}>${n}</option>`).join('');
  return `<span>Showing <b>${start + 1}–${start + shown}</b> of <b>${total}</b> ${noun}${total === 1 ? '' : 's'}</span>
    <div class="pager-btns">
      <label class="page-size">Rows per page <select data-size>
        ${sizeOptions}
      </select></label>
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
      setHtml(btn, icon(shown ? 'eye-off' : 'eye'));
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
  setHtml(el, `${icon(ic)}<div class="t-main"><div>${esc(message)}</div>${
    actions.length ? `<div class="t-actions">${actions.map((a, i) => `<button data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''
  }</div>`);
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
  setHtml(backdrop, `<div class="modal ${size}" role="dialog" aria-modal="true">
      ${title ? `<div class="modal-head"><h3>${iconName ? icon(iconName) : ''}${esc(title)}</h3><button class="icon-btn" data-close title="Close">${icon('x')}</button></div>` : ''}
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div>`);
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
