'use strict';
// Reports page: filters, table, and export to Excel / PDF.
// Used by: renderer/index.html, which loads it with <script src="reports.js">.
// Not imported: the screen scripts are plain browser scripts that share one global scope and
// load in this order: ui.js, app.js, dashboard.js, books.js, circulation.js, reports.js,
// settings.js, start.js. Keep that order in index.html when adding or renaming a file.

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
    setHtml(hint, `${icon('calendar')}<span>Showing books <b>${DATE_BY_TEXT[by]}</b> ${esc(range)}. Change “Date based on” to filter by issue, return or due date.</span>`);
  } else if (state.report === 'overdue') {
    setHtml(hint, `${icon('alert')}<span>Books that were past their due date and not yet returned on <b>${esc(fmtDate($('#rf-ason').value || isoToday()))}</b>.</span>`);
  } else {
    setHtml(hint, `${icon('books')}<span>All books in the library. Narrow down by CAT, LOC, Rack or status.</span>`);
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
    setHtml($('#report-table'), emptyState('calendar', 'Correct the date range above to view the report.'));
    setHtml($('#report-pager'), '');
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
  setHtml($('#report-table'), slice.length
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
    : emptyState('file', $('#rep-search').value.trim() ? 'Nothing in this report matches your search.' : 'No records match the selected filters.'));
  setHtml($('#report-pager'), pagerHtml(rep.rows.length, repPage, pages, start, slice.length, 'record'));
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
