'use strict';
// Dashboard page: tiles, chart, due-soon list, recent activity and the overdue dialog.
// Screen scripts share one global scope and load in order from index.html.

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

  setHtml($('#due-soon'), s.dueSoon.length
    ? s.dueSoon
        .map(
          (r) => `<div class="list-item"><div class="list-icon amber">${icon('clock')}</div>
          <div class="list-main"><strong>${esc(r.book_name)}</strong><span>${esc(r.book_no)} · ${esc(r.issue_user)}</span></div>
          <span class="pill">${r.days_left === 0 ? 'Due today' : r.days_left === 1 ? 'Tomorrow' : `In ${r.days_left} days`}</span></div>`
        )
        .join('')
    : emptyState('check', 'Nothing due in the next 3 days.'));

  setHtml($('#recent'), s.recent.length
    ? `<table class="table"><thead><tr><th>When</th><th>Action</th><th>Accession No</th><th>Description</th><th>User</th><th>Due Date</th></tr></thead><tbody>
      ${s.recent
        .map(
          (r) => `<tr><td class="date">${esc(fmtDateTime(r.at))}</td><td>${badge(r.action === 'Issued' ? 'Issued' : r.action)}</td>
            <td class="mono">${esc(r.book_no)}</td><td class="strong">${esc(r.book_name)}</td><td>${esc(r.user_name)}</td><td class="date">${esc(fmtDate(r.due_date))}</td></tr>`
        )
        .join('')}</tbody></table>`
    : emptyState('clock', 'No issues or returns yet. Activity will appear here.'));
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
    setHtml($('[data-table]', m.el), slice.length
      ? `<table class="table"><thead><tr><th class="idx">#</th><th>Accession No</th><th>Description</th><th>Borrower</th><th>Issue Date</th><th>Due Date</th><th class="num">Days Overdue</th></tr></thead><tbody>
        ${slice
          .map(
            (r, i) => `<tr><td class="idx muted">${start + i + 1}</td><td class="mono">${esc(r.book_no)}</td><td class="strong wrap">${esc(r.book_name)}</td><td>${esc(r.issue_user)}</td>
              <td class="date">${esc(fmtDate(r.issue_date))}</td><td class="date">${esc(fmtDate(r.due_date))}</td><td class="num"><span class="badge badge-overdue">${plural(r.days_overdue, 'day')}</span></td></tr>`
          )
          .join('')}</tbody></table>`
      : emptyState('search', 'No overdue books match your search.'));
    setHtml($('[data-pager]', m.el), pagerHtml(shown.length, st, pages, start, slice.length, 'book'));
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
