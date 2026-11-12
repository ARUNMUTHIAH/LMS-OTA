'use strict';
// Audit Log page: a read-only list of everything done in the software (who, when, which computer,
// what changed). Entries come from the server (server/audit.js); there is nothing here, or anywhere
// in the app, that can change or delete one. Shown to accounts with Settings access.

const audit = { page: 1, size: 25, rows: [], total: 0, limit: 0, loaded: false };
// Login, Section and Result: tick any number; none ticked = all.
const auditPick = {
  user: multiSelect($('#af-user'), { onChange: () => attempt(refreshAudit), noun: 'logins' }),
  category: multiSelect($('#af-category'), { onChange: () => attempt(refreshAudit), noun: 'sections' }),
  result: multiSelect($('#af-result'), { onChange: () => attempt(refreshAudit), noun: 'results' }),
};
auditPick.category.setOptions(['Sign-in', 'Books', 'Circulation', 'Users', 'Settings', 'Reports', 'Backup', 'Audit Log']);
auditPick.result.setOptions(['Success', 'Failed']);

function auditFilters() {
  return {
    from: $('#af-from').value,
    to: $('#af-to').value,
    username: auditPick.user.values(),
    category: auditPick.category.values(),
    result: auditPick.result.values(),
    q: $('#audit-search').value.trim(),
  };
}

function resetAuditFilters() {
  $('#af-from').value = addDays(isoToday(), -29);
  $('#af-to').value = isoToday();
  auditPick.user.clear();
  auditPick.category.clear();
  auditPick.result.clear();
  $('#audit-search').value = '';
}

async function loadAuditPage() {
  if (!audit.loaded) {
    resetAuditFilters();
    audit.loaded = true;
  }
  await refreshAudit();
}

async function refreshAudit() {
  const f = auditFilters();
  if (f.from && f.to && f.from > f.to) {
    toast('The From date is after the To date.', 'err');
    return;
  }
  const data = await rpc('auditLog', f);
  audit.rows = data.rows;
  audit.total = data.total;
  audit.limit = data.limit;
  audit.page = 1;
  auditPick.user.setOptions(data.users); // logins seen in the log; ticked ones stay ticked
  const range = f.from || f.to ? `${f.from ? fmtDate(f.from) : 'Start'} to ${f.to ? fmtDate(f.to) : 'today'}` : 'All dates';
  $('#audit-caption').textContent = `${range}${data.oldest ? ` · Oldest entry kept: ${fmtDate(data.oldest)}` : ''} · Kept for ${data.keepDays} days`;
  renderAudit();
}

function renderAudit() {
  const st = audit;
  const shownAll = st.total <= st.rows.length;
  $('#audit-summary').textContent = shownAll
    ? `${st.total} ${st.total === 1 ? 'entry' : 'entries'}`
    : `Latest ${st.rows.length} of ${st.total} entries — narrow the dates to see older ones`;
  const excel = $('#audit-excel');
  excel.disabled = !st.rows.length;
  excel.title = st.rows.length ? 'Export these entries to Excel' : 'No entries to export';

  const { pages, start, slice } = pageSlice(st.rows, st);
  const dash = '<span class="muted">—</span>';
  // "Label: value | Label: value" -> one line each, for easy reading.
  const details = (d) => (d ? d.split(' | ').map((part) => `<span>${esc(part)}</span>`).join('') : dash);
  setHtml(
    $('#audit-table'),
    slice.length
      ? `<table class="table audit-table"><thead><tr><th class="idx">S.No</th><th>Date &amp; Time</th><th>Login</th><th>Computer / IP</th>
          <th>Section</th><th>Action</th><th>Record</th><th>Details</th><th>Result</th></tr></thead><tbody>
        ${slice
          .map(
            (r, i) => `<tr class="${r.result === 'Failed' ? 'failed' : ''}">
              <td class="idx muted">${start + i + 1}</td>
              <td class="date nowrap">${esc(fmtDateTime(r.logged_at))}</td>
              <td class="strong nowrap">${esc(r.username) || dash}</td>
              <td class="nowrap">${esc(r.computer) || dash}</td>
              <td><span class="audit-cat">${esc(r.category)}</span></td>
              <td class="nowrap">${esc(r.action)}</td>
              <td class="mono">${esc(r.record) || dash}</td>
              <td class="audit-details">${details(r.details)}</td>
              <td>${badge(r.result)}</td></tr>`
          )
          .join('')}</tbody></table>`
      : emptyState('shield', 'No audit entries match these filters.')
  );
  setHtml($('#audit-pager'), pagerHtml(st.rows.length, st, pages, start, slice.length, 'record'));
}

bindPager($('#audit-pager'), audit, renderAudit);
for (const id of ['#af-from', '#af-to']) {
  $(id).addEventListener('change', () => attempt(refreshAudit));
}
$('#audit-search').addEventListener('input', debounce(() => attempt(refreshAudit), 350));
$('#audit-reset').addEventListener('click', () => {
  resetAuditFilters();
  attempt(refreshAudit);
});
$('#audit-excel').addEventListener('click', () =>
  attempt(async () => {
    const file = await rpc('exportAuditExcel', auditFilters());
    if (file) savedToast('Audit log', file);
  })
);
