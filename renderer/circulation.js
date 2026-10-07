'use strict';
// Issue Book and Return Book pages.
// Screen scripts share one global scope and load in order from index.html.

/* ================= Circulation ================= */
function notFound(kind, bookNo) {
  const box = $(`#${kind}-result`);
  setHtml(box, `<div class="result"><div class="alert alert-danger">${icon('alert')}<div><strong>Book not found</strong>
    No book with Accession Number “${esc(bookNo)}” exists in the catalogue.</div></div>
    ${kind === 'issue' ? '<div class="form-actions start"><button class="btn btn-soft" data-addbook>' + icon('plus') + 'Add this book</button></div>' : ''}</div>`);
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
  setHtml($(`#${kind}-result`), circGuide(kind));
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
  $$('[data-summary]').forEach((el) => setHtml(el, html));
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
  setHtml(box, `<div class="records-head">
      <div><h3>${icon(issue ? 'out' : 'in')}${issue ? 'Issued books' : 'Returned books'} <span class="pill pill-indigo" data-count>0</span></h3>
        <p class="muted" data-caption></p></div>
      <div class="records-tools">
        <div class="range-chips" role="group" aria-label="Period">${RECORD_RANGES.map(([v, l]) => `<button class="range-chip ${v === st.range ? 'on' : ''}" data-range="${v}">${l}</button>`).join('')}</div>
        <div class="search"><svg><use href="#i-search"/></svg><input data-q type="search" maxlength="100" placeholder="Search accession no, description or name…" /></div>
      </div>
    </div>
    <div class="table-wrap" data-table></div>
    <div class="pager" data-pager></div>`);
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
  setHtml($('[data-table]', box), slice.length
    ? `<table class="table"><thead><tr>${head}</tr></thead><tbody>${slice.map(row).join('')}</tbody></table>`
    : emptyState(issue ? 'out' : 'in', none));
  setHtml($('[data-pager]', box), pagerHtml(st.rows.length, st, pages, start, slice.length, 'book'));
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
    setHtml(box, `<div class="card flush issue-sheet">${issueBookHead(book)}
      <div class="sheet-body">
        <div class="alert alert-warn">${icon('alert')}<div><strong>This book is already issued</strong>
        Issued to <b>${esc(book.issue_user)}</b> on ${esc(fmtDate(book.issue_date))}, due ${esc(fmtDate(book.due_date))}${
          overdueDays > 0 ? ` — <b>overdue by ${plural(overdueDays, 'day')}</b>` : ''
        }. It must be returned before it can be issued again.</div></div>
      </div></div>`);
    $('#issue-scan').select();
    return;
  }
  const today = isoToday();
  const dur = state.settings.defaultDuration || 14;
  setHtml(box, `<div class="card flush issue-sheet">${issueBookHead(book)}
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
    </form></div>`);
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
    setHtml(box, `<div class="card flush issue-sheet">${issueBookHead(book)}
      <div class="sheet-body"><div class="alert alert-info">${icon('check')}<div><strong>This book is not issued</strong>
      It is already available on the shelf, so there is nothing to return.</div></div></div></div>`);
    $('#return-scan').select();
    return;
  }
  const late = overdueDays > 0;
  const info = (label, value, cls = '') => `<div class="info"><span>${label}</span><strong class="${cls}">${value}</strong></div>`;
  setHtml(box, `<div class="card flush issue-sheet">${issueBookHead(book)}
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
    </form></div>`);
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
