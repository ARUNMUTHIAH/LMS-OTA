// Report definitions shared by the on-screen view, Excel export, PDF export and printing.

const ExcelJS = require('exceljs');

// Client organisation shown at the top of every report.
const ORG_NAME = 'Technical Library - CGAS Chennai';
const { display, today } = require('./dates');

const DATE_BY_LABELS = { issue: 'Issue date', return: 'Return date', due: 'Due date' };
const STATUS_LABELS = {
  '': 'All',
  Out: 'Not returned yet',
  Issued: 'Issued (on time)',
  Overdue: 'Overdue',
  Returned: 'Returned on time',
  'Returned Late': 'Returned late',
  AllReturned: 'All returned',
};

const REPORTS = {
  books: {
    title: 'Total Books Report',
    columns: [
      { key: 'book_no', label: 'Accession No', width: 14 },
      { key: 'lf', label: 'LF', width: 10 },
      { key: 'category', label: 'CAT', width: 12 },
      { key: 'name', label: 'Description of Manual', width: 48 },
      { key: 'location', label: 'LOC', width: 8 },
      { key: 'rack', label: 'Rack', width: 8 },
      { key: 'status', label: 'Status', width: 12 },
    ],
    build(db, f) {
      const rows = db.searchBooks({ query: f.q, category: f.category, status: f.status, location: f.location, rack: f.rack });
      const parts = [];
      parts.push(`CAT: ${f.category || 'All'}`);
      parts.push(`LOC: ${f.location || 'All'}`);
      parts.push(`Rack: ${f.rack || 'All'}`);
      parts.push(`Status: ${f.status || 'All'}`);
      if (f.q) parts.push(`Search: "${f.q}"`);
      const issued = rows.filter((r) => r.status === 'Issued').length;
      return {
        rows,
        filterText: parts.join('   |   '),
        summary: `${rows.length} book(s)  ·  ${rows.length - issued} available  ·  ${issued} issued`,
      };
    },
  },
  circulation: {
    title: 'Circulation Report',
    columns: [
      { key: 'book_no', label: 'Accession No', width: 14 },
      { key: 'book_name', label: 'Description', width: 30 },
      { key: 'issue_user', label: 'Issued To', width: 20 },
      { key: 'issue_date', label: 'Issue Date', width: 12, date: true },
      { key: 'due_date', label: 'Due Date', width: 12, date: true },
      { key: 'return_date', label: 'Return Date', width: 12, date: true },
      { key: 'return_user', label: 'Returned By', width: 18 },
      { key: 'status', label: 'Status', width: 14 },
      { key: 'remarks', label: 'Remarks', width: 36 },
    ],
    build(db, f) {
      const dateBy = f.dateBy || 'issue';
      const rows = db
        .circulationList({ from: f.from, to: f.to, dateBy, userName: f.userName, bookNo: f.bookNo, status: f.status, q: f.q })
        .map((r) => {
          const remarks = [];
          if (r.issue_remarks) remarks.push(`Issue: ${r.issue_remarks}`);
          if (r.return_remarks) remarks.push(`Return: ${r.return_remarks}`);
          return { ...r, remarks: remarks.join('; ') };
        });
      const dateLabel = DATE_BY_LABELS[dateBy] || 'Issue date';
      const range = f.from || f.to ? `${dateLabel}: ${f.from ? display(f.from) : 'Start'} to ${f.to ? display(f.to) : 'Any'}` : `${dateLabel}: All`;
      const parts = [range, `Status: ${STATUS_LABELS[f.status || ''] || 'All'}`, `User: ${f.userName || 'All'}`];
      if (f.bookNo) parts.push(`Accession No: ${f.bookNo}`);
      if (f.q) parts.push(`Search: "${f.q}"`);
      return {
        rows,
        filterText: parts.join('   |   '),
        summary: `${rows.length} transaction(s)  ·  ${rows.filter((r) => !r.return_date).length} still out`,
      };
    },
  },
  overdue: {
    title: 'Overdue Books Report',
    columns: [
      { key: 'book_no', label: 'Accession No', width: 14 },
      { key: 'book_name', label: 'Description', width: 34 },
      { key: 'issue_user', label: 'User Name', width: 22 },
      { key: 'issue_date', label: 'Issue Date', width: 12, date: true },
      { key: 'due_date', label: 'Due Date', width: 12, date: true },
      { key: 'days_overdue', label: 'Days Overdue', width: 14, num: true },
    ],
    build(db, f) {
      const asOn = f.asOn || today();
      const rows = db.overdueList(asOn, { userName: f.userName, bookNo: f.bookNo, q: f.q });
      const parts = [`As on: ${display(asOn)}`, `User: ${f.userName || 'All'}`];
      if (f.bookNo) parts.push(`Accession No: ${f.bookNo}`);
      if (f.q) parts.push(`Search: "${f.q}"`);
      return {
        rows,
        filterText: parts.join('   |   '),
        summary: `${rows.length} overdue book(s)`,
      };
    },
  },
};

function buildReport(db, type, filters = {}) {
  const def = REPORTS[type];
  if (!def) throw new Error('Unknown report: ' + type);
  const result = def.build(db, filters);
  return {
    type,
    title: def.title,
    columns: def.columns.map(({ key, label, date, num }) => ({ key, label, date: !!date, num: !!num })),
    generatedOn: new Date().toLocaleString('en-GB'),
    ...result,
  };
}

// Empty cells print as "-" so blank fields are visible in exports.
function cellText(col, row) {
  const v = row[col.key];
  const text = v == null ? '' : col.date ? display(v) : String(v).trim();
  return text || '-';
}

async function toExcel(db, type, filters, filePath) {
  const def = REPORTS[type];
  const rep = buildReport(db, type, filters);
  const wb = new ExcelJS.Workbook();
  wb.creator = ORG_NAME;
  wb.created = new Date();
  const ws = wb.addWorksheet(def.title.replace(' Report', ''), {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const n = def.columns.length;
  ws.columns = def.columns.map((c) => ({ width: c.width }));

  ws.mergeCells(1, 1, 1, n);
  ws.getCell(1, 1).value = ORG_NAME;
  ws.getCell(1, 1).font = { bold: true, size: 15, color: { argb: 'FF1E3A8A' } };
  ws.getRow(1).height = 24;
  ws.mergeCells(2, 1, 2, n);
  ws.getCell(2, 1).value = rep.title;
  ws.getCell(2, 1).font = { bold: true, size: 12, color: { argb: 'FF111827' } };
  ws.getRow(2).height = 20;
  ws.mergeCells(3, 1, 3, n);
  ws.getCell(3, 1).value = rep.filterText;
  ws.getCell(3, 1).font = { size: 10, color: { argb: 'FF475569' } };
  ws.mergeCells(4, 1, 4, n);
  ws.getCell(4, 1).value = `Generated on ${rep.generatedOn}   ·   ${rep.summary}`;
  ws.getCell(4, 1).font = { size: 10, color: { argb: 'FF475569' } };

  const header = ws.getRow(5);
  def.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    cell.alignment = { vertical: 'middle' };
  });
  header.height = 20;

  rep.rows.forEach((row, ri) => {
    const r = ws.getRow(6 + ri);
    def.columns.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      cell.value = c.num ? Number(row[c.key]) : cellText(c, row);
      if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.alignment = { vertical: 'top', wrapText: c.key === 'remarks' };
    });
  });
  if (rep.rows.length) {
    ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + rep.rows.length, column: n } };
  }
  await wb.xlsx.writeFile(filePath);
  return rep.rows.length;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function toHtml(db, type, filters) {
  const rep = buildReport(db, type, filters);
  const head = rep.columns.map((c) => `<th class="${c.num ? 'num' : ''}">${escapeHtml(c.label)}</th>`).join('');
  const body = rep.rows.length
    ? rep.rows
        .map(
          (row, i) =>
            `<tr><td class="idx">${i + 1}</td>${rep.columns
              .map((c) => {
                const text = escapeHtml(cellText(c, row));
                if (c.key === 'status') return `<td><span class="st st-${text.replace(/\s+/g, '-').toLowerCase()}">${text}</span></td>`;
                return `<td class="${c.num ? 'num' : ''}">${text}</td>`;
              })
              .join('')}</tr>`
        )
        .join('')
    : `<tr><td colspan="${rep.columns.length + 1}" class="empty">No records match the selected filters.</td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(rep.title)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; font-size: 11px; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #1e3a8a; padding-bottom: 8px; margin-bottom: 10px; }
  .org { font-size: 16px; font-weight: 800; letter-spacing: .01em; color: #1e3a8a; margin-bottom: 2px; }
  .brand { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #1d4ed8; font-weight: 700; }
  h1 { font-size: 20px; margin: 2px 0 0; }
  .meta { text-align: right; color: #475569; line-height: 1.6; }
  .summary { background: #f1f5f9; color: #1f2937; padding: 6px 10px; border-radius: 3px; margin-bottom: 10px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { background: #1e3a8a; color: #fff; text-align: left; padding: 6px 7px; font-weight: 600; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  td { padding: 5px 7px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #f8fafc; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .idx { color: #94a3b8; width: 28px; }
  .num { text-align: right; }
  .empty { text-align: center; padding: 30px; color: #64748b; }
  .st { padding: 1px 7px; border-radius: 3px; font-weight: 600; font-size: 10px; white-space: nowrap; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .st-available, .st-returned { background: #dcfce7; color: #166534; }
  .st-issued { background: #dbeafe; color: #1e40af; }
  .st-overdue { background: #fee2e2; color: #991b1b; }
  .st-returned-late { background: #fef3c7; color: #92400e; }
</style></head><body>
<div class="head">
  <div><div class="org">${escapeHtml(ORG_NAME)}</div><div class="brand">Library Management System</div><h1>${escapeHtml(rep.title)}</h1></div>
  <div class="meta">${escapeHtml(rep.filterText)}<br>Generated on ${escapeHtml(rep.generatedOn)}</div>
</div>
<div class="summary">${escapeHtml(rep.summary)}</div>
<table><thead><tr><th class="idx">#</th>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`;
}

module.exports = { buildReport, toExcel, toHtml, REPORTS, ORG_NAME };
