// Bulk book import from Excel: template, sheet reading and error report.
// Row-level business rules (format, uniqueness) live in LibraryDB.validateImport.

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { UserError } = require('./database');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;
const HEADER_SCAN_ROWS = 10; // a title row (e.g. "DORNIER AIRCRAFT PUBLICATION") may sit above the header

// Accepted header spellings, compared after lower-casing and removing spaces/punctuation.
const FIELDS = [
  { key: 'book_no', label: 'Accession No', required: true, aliases: ['accessionno', 'accessionnumber', 'accession', 'accno', 'accnumber'] },
  { key: 'lf', label: 'LF', aliases: ['lf', 'lfno'] },
  { key: 'category', label: 'CAT', aliases: ['cat', 'category'] },
  {
    key: 'name',
    label: 'Description of Manual',
    required: true,
    aliases: ['descriptionofmanual', 'descriptionsofmanual', 'description', 'descriptions', 'title', 'bookname', 'manual'],
  },
  { key: 'location', label: 'LOC', aliases: ['loc', 'location'] },
  { key: 'rack', label: 'Rack', aliases: ['rack', 'rackno', 'racknumber'] },
];

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Reads one cell as text. Dates and formula errors are reported instead of guessed at.
function readCell(value) {
  if (value == null) return { text: '' };
  if (value instanceof Date) return { text: '', issue: 'date' };
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return { text: value.richText.map((r) => r.text).join('') };
    if (value.error) return { text: '', issue: 'error' };
    if ('formula' in value || 'sharedFormula' in value || 'result' in value) return readCell(value.result);
    if ('text' in value) return readCell(value.text); // hyperlink
    return { text: '' };
  }
  return { text: String(value) };
}

function headerText(cell) {
  return readCell(cell.value).text;
}

async function readBookSheet(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.xlsx') {
    throw new UserError('Please choose an Excel workbook saved as .xlsx. (Older .xls files: open in Excel and "Save As" .xlsx.)');
  }
  const { size } = fs.statSync(filePath);
  if (size === 0) throw new UserError('The selected file is empty.');
  if (size > MAX_BYTES) throw new UserError('The file is larger than 5 MB. Split it into smaller files and import them one by one.');

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.readFile(filePath);
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') throw new UserError('The file is open in another program. Close it in Excel and try again.');
    throw new UserError('Could not read the file. Make sure it is a valid .xlsx workbook and is not password-protected.');
  }

  const ws = wb.worksheets.find((s) => s.state !== 'hidden' && s.actualRowCount > 0);
  if (!ws) throw new UserError('The workbook has no data.');

  // Find the header row: the first row (within the top few) that names both required columns.
  let headerRow = 0;
  let columns = null;
  let ignored = [];
  for (let r = 1; r <= Math.min(HEADER_SCAN_ROWS, ws.rowCount) && !headerRow; r++) {
    const map = {};
    const unknown = [];
    const dupes = [];
    ws.getRow(r).eachCell((cell, col) => {
      const text = headerText(cell).trim();
      if (!text) return;
      const field = FIELDS.find((f) => f.aliases.includes(norm(text)));
      if (!field) return unknown.push(text);
      if (map[field.key]) dupes.push(field.label);
      else map[field.key] = col;
    });
    if (FIELDS.filter((f) => f.required).every((f) => map[f.key])) {
      if (dupes.length) throw new UserError(`Row ${r} has more than one "${dupes[0]}" column. Keep only one.`);
      headerRow = r;
      columns = map;
      ignored = unknown;
    }
  }
  if (!headerRow) {
    throw new UserError(
      'Could not find the header row. The first sheet must have the columns "Accession No" and "Description of Manual" ' +
        '(plus optional LF, CAT, LOC, Rack). Download the template to see the expected layout.'
    );
  }

  const rows = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const values = {};
    const issues = [];
    for (const f of FIELDS) {
      if (!columns[f.key]) {
        values[f.key] = '';
        continue;
      }
      const { text, issue } = readCell(row.getCell(columns[f.key]).value);
      values[f.key] = text;
      if (issue === 'date') issues.push(`${f.label} was read as a date by Excel. Format the column as Text and re-type the value.`);
      if (issue === 'error') issues.push(`${f.label} contains a formula error.`);
    }
    if (!issues.length && FIELDS.every((f) => !values[f.key].trim())) continue; // blank row
    rows.push({ rowNumber: r, values, issues });
    if (rows.length > MAX_ROWS) throw new UserError(`The sheet has more than ${MAX_ROWS} book rows. Split it into smaller files.`);
  }
  if (!rows.length) throw new UserError('No book rows were found below the header row.');

  return {
    fileName: path.basename(filePath),
    sheet: ws.name,
    headerRow,
    columns: FIELDS.filter((f) => columns[f.key]).map((f) => f.label),
    missingOptional: FIELDS.filter((f) => !f.required && !columns[f.key]).map((f) => f.label),
    ignored,
    rows,
  };
}

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    cell.alignment = { vertical: 'middle' };
  });
  row.height = 20;
}

async function writeTemplate(filePath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Technical Library - CGAS Chennai';
  const ws = wb.addWorksheet('Books', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Accession No', width: 16 },
    { header: 'LF', width: 12 },
    { header: 'CAT', width: 12 },
    { header: 'Description of Manual', width: 56 },
    { header: 'LOC', width: 10 },
    { header: 'Rack', width: 10 },
  ];
  // Text format stops Excel turning values like 001-06 into dates or dropping leading zeros.
  ws.columns.forEach((c) => (c.numFmt = '@'));
  styleHeader(ws.getRow(1));
  ws.addRow(['OTA-0001', '001-06', 'DOR-MM', 'AIRPLANE MAINTENANCE MANUAL VOL-I (CG-780)', 'B2', '6']);
  ws.addRow(['OTA-0002', '001-07', 'DOR-MM', 'AIRPLANE MAINTENANCE MANUAL VOL-I (CG-786)', 'B2', '6']);
  for (let r = 2; r <= 200; r++) ws.getRow(r).eachCell({ includeEmpty: true }, (cell) => (cell.numFmt = '@'));

  const help = wb.addWorksheet('Instructions');
  help.columns = [{ width: 26 }, { width: 90 }];
  help.addRow(['Column', 'Rule']);
  styleHeader(help.getRow(1));
  [
    ['Accession No *', 'Required. Must be unique (not already in the library, not repeated in the file). Letters, numbers and - / _ . only, no spaces. Max 50.'],
    ['LF', 'Optional. Max 30 characters, e.g. 001-06.'],
    ['CAT', 'Optional. Must contain letters, max 100, e.g. DOR-MM.'],
    ['Description of Manual *', 'Required. Max 200 characters.'],
    ['LOC', 'Optional. Max 30 characters, e.g. B2.'],
    ['Rack', 'Optional. Max 30 characters, e.g. 6.'],
    ['', ''],
    ['Notes', 'Keep the header row as it is. Delete the two example rows before importing. Blank rows are skipped.'],
    ['', 'Keep all columns formatted as Text so Excel does not change values like 001-06 into dates.'],
    ['', `Up to ${MAX_ROWS} books per file. Rows with errors are listed before anything is saved.`],
  ].forEach((r) => help.addRow(r));
  help.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  await wb.xlsx.writeFile(filePath);
}

// Rows that failed validation, with the reasons. The book columns match the template and the
// extra "Source Row" / "Problems" columns are ignored on import, so the file can be corrected
// and imported again as it is.
async function writeErrorReport(filePath, rows, errors) {
  const byRow = new Map(errors.map((e) => [e.rowNumber, e.messages]));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Technical Library - CGAS Chennai';
  const ws = wb.addWorksheet('Not Imported', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    ...FIELDS.map((f) => ({ header: f.label, width: f.key === 'name' ? 48 : 14, style: { numFmt: '@' } })),
    { header: 'Problems', width: 70 },
    { header: 'Source Row', width: 11 },
  ];
  styleHeader(ws.getRow(1));
  const problemCol = FIELDS.length + 1;
  for (const r of rows) {
    if (!byRow.has(r.rowNumber)) continue;
    const row = ws.addRow([...FIELDS.map((f) => r.values[f.key] || ''), byRow.get(r.rowNumber).join('\n'), r.rowNumber]);
    row.getCell(problemCol).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(problemCol).font = { color: { argb: 'FF991B1B' } };
  }
  await wb.xlsx.writeFile(filePath);
}

// "<file>_not_imported_<date>.xlsx" in the given folder, numbered if one already exists.
function rejectsPath(dir, sourceName, date) {
  // Anchored, with no nested repetition, so it cannot backtrack badly.
  // eslint-disable-next-line security/detect-unsafe-regex
  const base = path.basename(sourceName, path.extname(sourceName)).replace(/_not_imported_\d{4}-\d{2}-\d{2}(\s\(\d+\))?$/, '');
  let p = path.join(dir, `${base}_not_imported_${date}.xlsx`);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base}_not_imported_${date} (${i}).xlsx`);
  return p;
}

module.exports = { readBookSheet, writeTemplate, writeErrorReport, rejectsPath, FIELDS, MAX_ROWS };
