// End-to-end check of the business rules in the requirement document, run against a temp database.
// Usage: npm test
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LibraryDB, UserError } = require('../src/database');
const reports = require('../src/reports');
const { today, addDays } = require('../src/dates');
const { LicenseManager, LicenseError, SOFTWARE_NAME, SOFTWARE_KEY } = require('../src/license');

const expectUserError = (fn, pattern) =>
  assert.throws(fn, (e) => e instanceof UserError && pattern.test(e.message), `expected UserError ${pattern}`);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-lms-test-'));
  const file = path.join(dir, 'library.db');
  let db = await LibraryDB.open(file);
  const t = today();

  // First-run setup: no built-in account; the first user is created by the librarian.
  const firstPw = crypto.randomBytes(9).toString('base64');
  assert.ok(db.needsSetup(), 'new database has no accounts');
  assert.strictEqual(db.verifyLogin('admin', 'anything'), null, 'no factory default login');
  expectUserError(() => db.createFirstUser({ username: 'admin', password: '' }), /Password is required/);
  db.createFirstUser({ username: 'admin', password: firstPw });
  assert.ok(!db.needsSetup());
  expectUserError(() => db.createFirstUser({ username: 'other', password: firstPw }), /already set up/);
  assert.strictEqual(db.getSettings().defaultCredentials, false);

  // Login
  assert.ok(db.verifyLogin('admin', firstPw), 'first account can sign in');
  assert.strictEqual(db.verifyLogin('admin', 'wrong'), null);
  assert.strictEqual(db.getSettings().defaultDuration, 14);

  // Book entry: mandatory fields, uniqueness
  expectUserError(() => db.saveBook({ book_no: '', name: 'x' }), /Barcode No is required/);
  expectUserError(() => db.saveBook({ book_no: 'B1', name: '' }), /Description of Manual is required/);
  expectUserError(() => db.saveBook({ book_no: 'A 1', name: 'x' }), /no spaces/);
  expectUserError(() => db.saveBook({ book_no: 'A1', name: 'x', category: '12345' }), /must contain letters/);
  expectUserError(() => db.saveBook({ book_no: 'A1', name: 'x'.repeat(201) }), /200 characters/);
  expectUserError(() => db.saveBook({ book_no: 'A1', name: 'x', rack: 'r'.repeat(31) }), /Rack must be 30/);
  const b1 = db.saveBook({ book_no: 'OTA-001', lf: '001-06', category: 'DOR-MM', name: 'Airplane Maintenance Manual Vol-I (CG-780)', location: 'B2', rack: '6' });
  db.saveBook({ book_no: 'OTA-002', lf: '007-01', category: 'DOR-SMM', name: 'Wings of Fire', location: 'B2', rack: '1' });
  db.saveBook({ book_no: 'OTA-003', lf: '002-06', category: 'Science', name: 'Physics Vol 1' });
  expectUserError(() => db.saveBook({ book_no: 'ota-001', name: 'Dup' }), /Barcode No "ota-001" already exists/);

  // Edit + search
  db.saveBook({ ...b1, id: b1.id, rack: '7' });
  const e1 = db.getBookByNumber('OTA-001');
  assert.deepStrictEqual([e1.lf, e1.category, e1.location, e1.rack], ['001-06', 'DOR-MM', 'B2', '7']);
  assert.strictEqual(db.searchBooks({ query: 'wings' }).length, 1);
  assert.strictEqual(db.searchBooks({ query: 'OTA-00' }).length, 3);
  assert.strictEqual(db.searchBooks({ query: '007-01' }).length, 1, 'search by LF');
  assert.strictEqual(db.searchBooks({ query: 'DOR-' }).length, 2, 'search by CAT');

  // Dashboard basics
  let d = db.dashboard();
  assert.deepStrictEqual([d.total, d.issued, d.available, d.overdue], [3, 0, 3, 0]);

  // Issue
  expectUserError(() => db.issueBook({ bookNo: 'NOPE', userName: 'A', duration: 7 }), /No book found/);
  expectUserError(() => db.issueBook({ bookNo: 'OTA-001', userName: '', duration: 7 }), /Name is required/);
  expectUserError(() => db.issueBook({ bookNo: 'OTA-001', userName: 'Ravi', duration: 0 }), /Duration/);
  expectUserError(() => db.issueBook({ bookNo: 'OTA-001', userName: 'Ravi', duration: '2.5' }), /whole number/);
  expectUserError(() => db.issueBook({ bookNo: 'OTA-001', userName: 'Ravi', duration: 400 }), /between 1 and 365/);
  expectUserError(() => db.issueBook({ bookNo: 'OTA-001', userName: '999', duration: 7 }), /must contain letters/);
  expectUserError(() => db.issueBook({ bookNo: 'OTA-001', userName: 'Ravi<script>', duration: 7 }), /can contain only/);
  expectUserError(() => db.issueBook({ bookNo: 'OTA-001', userName: 'Ravi', duration: 7, remarks: 'r'.repeat(251) }), /250 characters/);
  // Rank / Number / Dept: optional, letters and numbers allowed.
  expectUserError(() => db.issueBook({ bookNo: 'OTA-001', userName: 'Ravi', rank: 'Lt<b>', duration: 7 }), /Rank can contain only/);
  expectUserError(() => db.issueBook({ bookNo: 'OTA-001', userName: 'Ravi', dept: 'd'.repeat(51), duration: 7 }), /Dept must be 50/);
  assert.strictEqual(require('../renderer/rules').checks.detail('Lt Cdr (Air Ops) & Tech-2', 'Rank'), '');
  const iss = db.issueBook({ bookNo: 'OTA-001', userName: 'Ravi Kumar', duration: 14, remarks: 'New copy' });
  assert.strictEqual(iss.issue_date, t);
  assert.strictEqual(iss.due_date, addDays(t, 14));
  expectUserError(() => db.issueBook({ bookNo: 'OTA-001', userName: 'Someone', duration: 7 }), /already issued/);

  // Cannot delete an issued book
  expectUserError(() => db.deleteBook(b1.id), /cannot be deleted/);

  d = db.dashboard();
  assert.deepStrictEqual([d.total, d.issued, d.available, d.overdue], [3, 1, 2, 0]);

  // Overdue: simulate a book issued 20 days ago for 7 days
  db.issueBook({ bookNo: 'OTA-002', userName: 'Priya', duration: 7 });
  db.db.run('UPDATE issues SET issue_date = ?, due_date = ? WHERE book_no = ?', [addDays(t, -20), addDays(t, -13), 'OTA-002']);
  d = db.dashboard();
  assert.deepStrictEqual([d.total, d.issued, d.available, d.overdue], [3, 2, 1, 1]);
  const od = db.overdueList(t);
  assert.strictEqual(od.length, 1);
  assert.strictEqual(od[0].days_overdue, 13);
  assert.strictEqual(db.lookupForCirculation('OTA-002').overdueDays, 13);

  // Barcode No suggestions: available books on the Issue page, issued books on the Return page
  assert.deepStrictEqual(db.suggestBooks({ query: 'ota', status: 'Available' }).map((b) => b.book_no), ['OTA-003']);
  assert.deepStrictEqual(db.suggestBooks({ query: 'ota', status: 'Issued' }).map((b) => b.book_no), ['OTA-001', 'OTA-002']);
  assert.strictEqual(db.suggestBooks({ query: 'OTA-002', status: 'Issued' })[0].issue_user, 'Priya');
  assert.deepStrictEqual(db.suggestBooks({ query: '%' }), [], 'LIKE wildcards are matched literally');
  assert.deepStrictEqual(db.suggestBooks({ query: '  ' }), []);

  // Borrower on return: another person may return by default; when switched off, only the borrower
  assert.strictEqual(db.getSettings().allowOtherReturner, true);
  assert.strictEqual(db.setAllowOtherReturner(false).allowOtherReturner, false);
  expectUserError(() => db.returnBook({ bookNo: 'OTA-002', userName: 'Someone Else' }), /Only Priya can return/);

  // Return
  expectUserError(() => db.returnBook({ bookNo: 'OTA-003', userName: 'X' }), /not currently issued/);
  const ret = db.returnBook({ bookNo: 'OTA-002', userName: 'Priya', remarks: 'Cover torn' });
  assert.strictEqual(ret.return_date, t);
  assert.strictEqual(ret.returned_late, 1, 'late return flagged');
  const ret2 = db.returnBook({ bookNo: 'OTA-001', userName: 'Ravi Kumar' });
  assert.strictEqual(ret2.returned_late, 0);
  assert.strictEqual(db.setAllowOtherReturner(true).allowOtherReturner, true);
  d = db.dashboard();
  assert.deepStrictEqual([d.total, d.issued, d.available, d.overdue], [3, 0, 3, 0]);
  assert.strictEqual(db.overdueList(t).length, 0, 'returned book leaves overdue list');
  // Historical "as on" still shows it was overdue before it came back
  assert.strictEqual(db.overdueList(addDays(t, -1)).length, 1);

  // Reports
  const rb = await reports.buildReport(db, 'books', { status: 'Available' });
  assert.strictEqual(rb.rows.length, 3);
  assert.strictEqual((await reports.buildReport(db, 'books', { category: 'Science' })).rows.length, 1);
  const rc = await reports.buildReport(db, 'circulation', { userName: 'priya' });
  assert.strictEqual(rc.rows.length, 1);
  assert.strictEqual(rc.rows[0].status, 'Returned Late');
  assert.ok(rc.rows[0].remarks.includes('Cover torn'));
  assert.strictEqual((await reports.buildReport(db, 'circulation', { from: t, to: t })).rows.length, 1);
  // Circulation filters: which date the range applies to, status, accession number, user, free text.
  assert.strictEqual(db.circulationList({ dateBy: 'return', from: t, to: t }).length, 2, 'both books were returned today');
  assert.strictEqual(db.circulationList({ dateBy: 'due', to: addDays(t, -1) }).length, 1, 'only OTA-002 was due before today');
  assert.strictEqual(db.circulationList({ status: 'Returned Late' })[0].book_no, 'OTA-002');
  assert.strictEqual(db.circulationList({ status: 'Returned' })[0].book_no, 'OTA-001');
  assert.strictEqual(db.circulationList({ status: 'Out' }).length, 0);
  assert.strictEqual(db.circulationList({ bookNo: 'ota-002' }).length, 1);
  assert.strictEqual(db.circulationList({ q: 'cover torn' }).length, 1, 'search covers remarks');
  assert.strictEqual(db.circulationList({ q: 'kumar' }).length, 1, 'search covers names');
  expectUserError(() => db.circulationList({ dateBy: 'nope' }), /Unknown date/);
  expectUserError(() => db.circulationList({ status: 'nope' }), /Unknown status/);
  assert.match((await reports.buildReport(db, 'circulation', { dateBy: 'return', from: t, to: t })).filterText, /Return date/);
  assert.strictEqual(db.overdueList(addDays(t, -1), { userName: 'priya' }).length, 1);
  assert.strictEqual(db.overdueList(addDays(t, -1), { userName: 'ravi' }).length, 0);
  assert.strictEqual(db.overdueList(addDays(t, -1), { bookNo: 'OTA-002' }).length, 1);
  assert.ok(db.shelfValues().categories.includes('Science'));
  assert.strictEqual((await reports.buildReport(db, 'books', { q: 'physics' })).rows.length, 1, 'report search');
  await assert.rejects(reports.buildReport(db, 'circulation', { from: t, to: addDays(t, -1) }), (e) => e instanceof UserError && /From/.test(e.message));
  const xlsx = path.join(dir, 'r.xlsx');
  await reports.toExcel(db, 'circulation', {}, xlsx);
  assert.ok(fs.statSync(xlsx).size > 4000, 'excel written');
  const xwb = new (require('exceljs').Workbook)();
  await xwb.xlsx.readFile(xlsx);
  assert.strictEqual(xwb.worksheets[0].getCell(1, 1).value, 'Technical Library - CGAS Chennai', 'library name heads the Excel report');
  assert.ok((await reports.toHtml(db, 'books', {})).includes('Technical Library - CGAS Chennai'), 'library name heads the PDF report');
  assert.ok((await reports.toHtml(db, 'books', {})).includes('>S.No</th>'), 'PDF report numbers rows under S.No');
  assert.ok((await reports.toHtml(db, 'overdue', { asOn: addDays(t, -1) })).includes('Wings of Fire'));

  // Delete now that it is returned; history kept
  db.deleteBook(b1.id);
  assert.strictEqual(db.dashboard().total, 2);
  assert.strictEqual((await reports.buildReport(db, 'circulation', {})).rows.length, 2);

  // Credentials
  expectUserError(() => db.changeCredentials(1, { currentPassword: 'bad', newPassword: 'secret1' }), /incorrect/);
  expectUserError(() => db.changeCredentials(1, { currentPassword: firstPw, newUsername: 'my name' }), /no spaces/);
  expectUserError(() => db.changeCredentials(1, { currentPassword: firstPw, newPassword: '123' }), /at least 4/);
  expectUserError(() => db.setDefaultDuration(0), /between 1 and 365/);
  db.changeCredentials(1, { currentPassword: firstPw, newUsername: 'librarian', newPassword: 'secret1' });
  assert.ok(db.verifyLogin('librarian', 'secret1'));
  assert.strictEqual(db.getSettings().defaultCredentials, false);
  db.setDefaultDuration(21);

  // User management
  expectUserError(() => db.createUser({ username: 'arun', password: '' }), /Password is required/);
  expectUserError(() => db.createUser({ username: 'a b', password: 'secret1' }), /no spaces/);
  expectUserError(() => db.createUser({ username: 'LIBRARIAN', password: 'secret1' }), /already in use/);
  expectUserError(() => db.createUser({ username: 'arun', password: 'abc' }), /at least 4/);
  const arun = db.createUser({ username: 'arun', password: 'arun123' });
  db.updateUser(arun.id, { username: 'arun', password: '1234' });
  assert.ok(db.verifyLogin('arun', '1234'), '4-character password accepted');
  assert.ok(db.verifyLogin('arun', '1234'));
  assert.deepStrictEqual(db.listUsers().map((u) => u.username), ['arun', 'librarian']);
  db.updateUser(arun.id, { username: 'arun.k', password: '' });
  assert.ok(db.verifyLogin('arun.k', '1234'), 'blank password keeps the old one');
  db.updateUser(arun.id, { username: 'arun.k', password: 'newpass1' });
  assert.ok(db.verifyLogin('arun.k', 'newpass1'));
  expectUserError(() => db.updateUser(arun.id, { username: 'librarian' }), /already in use/);
  expectUserError(() => db.deleteUser(1, 1), /signed in with/);
  // Status: inactive users are kept but cannot sign in; you cannot deactivate yourself.
  assert.strictEqual(db.listUsers().find((u) => u.id === arun.id).active, true, 'new users are active');
  db.updateUser(arun.id, { username: 'arun.k', password: '', active: false }, 1);
  assert.strictEqual(db.verifyLogin('arun.k', 'newpass1').active, false);
  assert.strictEqual(db.listUsers().find((u) => u.id === arun.id).active, false);
  db.updateUser(arun.id, { username: 'arun.k', password: '' }, 1);
  assert.strictEqual(db.listUsers().find((u) => u.id === arun.id).active, false, 'status unchanged when not given');
  db.updateUser(arun.id, { username: 'arun.k', password: '', active: true }, 1);
  assert.strictEqual(db.verifyLogin('arun.k', 'newpass1').active, true);
  expectUserError(() => db.updateUser(1, { username: 'librarian', active: false }, 1), /signed in with inactive/);
  assert.strictEqual(db.createUser({ username: 'off1', password: '1234', active: false }).active, false);
  db.deleteUser(db.listUsers().find((u) => u.username === 'off1').id, 1);
  db.deleteUser(arun.id, 1);
  assert.strictEqual(db.verifyLogin('arun.k', 'newpass1'), null);
  expectUserError(() => db.deleteUser(arun.id, 1), /no longer exists/);
  const u1 = db.createUser({ username: 'temp1', password: '1111' });
  const u2 = db.createUser({ username: 'temp2', password: '2222' });
  expectUserError(() => db.deleteUsers([u1.id, 1], 1), /signed in with/);
  expectUserError(() => db.deleteUsers([], 1), /at least one/);
  assert.strictEqual(db.deleteUsers([u1.id, u2.id], 1), 2);
  assert.deepStrictEqual(db.listUsers().map((u) => u.username), ['librarian']);

  // Exports show "-" for empty cells
  assert.ok((await reports.toHtml(db, 'books', {})).includes('<td class="">-</td>'), 'blank LF/LOC/Rack print as -');

  // Persistence: reopen from disk
  await db.flush(); // saves are written in the background
  db = await LibraryDB.open(file);
  assert.strictEqual(db.dashboard().total, 2);
  assert.strictEqual(db.getSettings().defaultDuration, 21);
  assert.ok(db.verifyLogin('librarian', 'secret1'));

  // Backup / restore
  const backup = db.exportBytes();
  db.saveBook({ book_no: 'OTA-009', name: 'Temp' });
  db.restoreFrom(backup);
  assert.strictEqual(db.dashboard().total, 2);
  expectUserError(() => db.restoreFrom(Buffer.from('not a database')), /not a valid/);
  assert.strictEqual(db.dashboard().total, 2, 'failed restore leaves data intact');

  // Bulk import from Excel
  const importer = require('../src/importer');
  const ExcelJS = require('exceljs');
  const xl = path.join(dir, 'books.xlsx');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['DORNIER AIRCRAFT PUBLICATION']); // title row above the header
  ws.addRow(['SL', 'Barcode No', 'LF', 'CAT', 'DESCRIPTIONS OF MANUAL', 'LOC', 'RACK']);
  ws.addRow([1, 'IMP-001', '001-06', 'DOR-MM', 'AIRPLANE MAINTENANCE MANUAL VOL-I (CG-780)', 'B2', 6]);
  ws.addRow([2, 'IMP-002', '001-07', 'DOR-MM', 'AIRPLANE MAINTENANCE MANUAL VOL-I (CG-786)', 'B2', 6]);
  ws.addRow([]); // blank row is skipped
  ws.addRow([3, 'imp-001', '001-08', 'DOR-MM', 'Repeated accession', 'B2', 6]);
  ws.addRow([4, 'OTA-002', '002-06', 'DOR-MM', 'Already in the library', 'B2', 6]);
  ws.addRow([5, 'IMP-005', '002-07', 'DOR-MM', '', 'B2', 6]);
  ws.addRow([6, 'IMP 006', new Date(2026, 0, 6), 'DOR-MM', 'Bad accession and date LF', 'B2', 6]);
  ws.addRow([7, 12345, '', '', 'Numeric accession, optional fields empty', '', '']);
  await wb.xlsx.writeFile(xl);

  const sheet = await importer.readBookSheet(xl);
  assert.strictEqual(sheet.headerRow, 2);
  assert.deepStrictEqual(sheet.ignored, ['SL']);
  assert.strictEqual(sheet.rows.length, 7, 'blank row skipped');
  const pv = db.validateImport(sheet.rows);
  assert.strictEqual(pv.ready.length, 3);
  const errAt = (row) => pv.errors.find((e) => e.rowNumber === row).messages.join(' | ');
  assert.match(errAt(6), /repeated \(first seen in row 3\)/);
  assert.match(errAt(7), /already exists in the library/);
  assert.match(errAt(8), /Description of Manual is required/);
  assert.match(errAt(9), /no spaces/);
  assert.match(errAt(9), /LF was read as a date/);
  const imp = db.importBooks(sheet.rows);
  assert.deepStrictEqual([imp.imported, imp.skipped, imp.errors.length], [3, 4, 4]);
  assert.strictEqual(db.getBookByNumber('12345').name, 'Numeric accession, optional fields empty');
  assert.strictEqual(db.getBookByNumber('IMP-001').rack, '6');
  const again = db.importBooks(sheet.rows); // everything is now a duplicate or wrong: nothing saved
  assert.deepStrictEqual([again.imported, again.skipped], [0, 7]);

  const errFile = path.join(dir, 'errors.xlsx');
  await importer.writeErrorReport(errFile, sheet.rows, pv.errors);
  const ewb = new ExcelJS.Workbook();
  await ewb.xlsx.readFile(errFile);
  assert.strictEqual(ewb.worksheets[0].actualRowCount, 1 + 4, 'not-imported file lists the 4 wrong rows');
  // The not-imported file can be corrected and imported again as it is.
  const back = await importer.readBookSheet(errFile);
  assert.strictEqual(back.rows.length, 4);
  assert.deepStrictEqual(back.ignored, ['Problems', 'Source Row']);
  const fixRow = back.rows.find((r) => r.values.book_no === 'IMP-005');
  assert.strictEqual(fixRow.values.lf, '002-07', 'values kept, blanks stay blank');
  assert.strictEqual(fixRow.values.name, '');
  fixRow.values.name = 'Corrected description';
  assert.strictEqual(db.importBooks([fixRow]).imported, 1);
  const rp = importer.rejectsPath(dir, 'books.xlsx', '2026-10-07');
  assert.ok(rp.endsWith('books_not_imported_2026-10-07.xlsx'));
  fs.writeFileSync(rp, 'x');
  assert.ok(importer.rejectsPath(dir, 'books.xlsx', '2026-10-07').endsWith('books_not_imported_2026-10-07 (2).xlsx'), 'never overwrites');
  assert.ok(importer.rejectsPath(dir, 'books_not_imported_2026-10-07.xlsx', '2026-10-07').endsWith('books_not_imported_2026-10-07 (2).xlsx'), 'no stacked suffix');

  const tpl = path.join(dir, 'template.xlsx');
  await importer.writeTemplate(tpl);
  const tsheet = await importer.readBookSheet(tpl);
  assert.strictEqual(db.validateImport(tsheet.rows).ready.length, 2, 'template example rows are valid');

  const noHeader = path.join(dir, 'nohdr.xlsx');
  const nwb = new ExcelJS.Workbook();
  nwb.addWorksheet('S').addRow(['Book', 'Author']);
  await nwb.xlsx.writeFile(noHeader);
  await assert.rejects(importer.readBookSheet(noHeader), /header row/);
  fs.writeFileSync(path.join(dir, 'old.xls'), 'x');
  await assert.rejects(importer.readBookSheet(path.join(dir, 'old.xls')), /\.xlsx/);
  fs.writeFileSync(path.join(dir, 'fake.xlsx'), 'not a workbook');
  await assert.rejects(importer.readBookSheet(path.join(dir, 'fake.xlsx')), /valid \.xlsx/);

  // Databases from the first release (no LF / LOC / Rack columns) are upgraded on open.
  const oldFile = path.join(dir, 'old.db');
  const legacy = new db.SQL.Database();
  legacy.run(`CREATE TABLE books (id INTEGER PRIMARY KEY AUTOINCREMENT, book_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL, author TEXT NOT NULL, publisher TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`);
  legacy.run("INSERT INTO books (book_no, name, author) VALUES ('OLD-1', 'Legacy', 'Someone')");
  fs.writeFileSync(oldFile, Buffer.from(legacy.export()));
  const upgraded = await LibraryDB.open(oldFile);
  assert.strictEqual(upgraded.getBookByNumber('OLD-1').rack, '');
  upgraded.saveBook({ book_no: 'OLD-2', name: 'New', rack: '3' });
  assert.strictEqual(upgraded.getBookByNumber('OLD-2').rack, '3');

  // License: nothing opens without an approved, unexpired license for this installation.
  const licData = path.join(dir, 'lic-data');
  const licRoot = path.join(dir, 'lic-root');
  fs.mkdirSync(licRoot);
  let lic = new LicenseManager({ dataDir: licData, rootDirs: [licRoot] });
  assert.strictEqual(lic.status().state, 'missing');
  assert.strictEqual(lic.status().renewal, false);
  assert.throws(() => lic.requestCode('  '), LicenseError);
  const code = lic.requestCode('SVIT');
  const key = lic.identity.softwareKey;
  assert.strictEqual(key, SOFTWARE_KEY, 'unique id is the fixed constant of this version');
  assert.match(key, /^[a-z0-9]{522}$/);
  assert.strictEqual(code, `[LM-REQ] SVIT|web|${SOFTWARE_NAME}|${key}`);
  lic = new LicenseManager({ dataDir: licData, rootDirs: [licRoot] });
  assert.strictEqual(lic.identity.softwareKey, key, 'unique id is kept');
  assert.strictEqual(lic.status().clientId, 'SVIT', 'client id is kept');
  const licFile = (over = {}) =>
    JSON.stringify({ success: true, data: { signature: { payload: { v: 3, platform: 'web', client_id: 'SVIT', key: SOFTWARE_NAME, status: 'Approved',
      expiry_date: addDays(t, 30), license_id: 92, software_name: SOFTWARE_NAME, software_key: key, institute_name: 'Central Library', ...over }, sig: 'x' } } });
  assert.throws(() => lic.install('{ nope'), /not a license file/);
  assert.throws(() => lic.install(licFile({ software_key: 'other' })), /different software key/);
  assert.throws(() => lic.install(licFile({ status: 'Pending' })), /not approved/);
  assert.throws(() => lic.install(licFile({ client_id: 'OTHER' })), /Client ID/);
  assert.throws(() => lic.install(licFile({ software_name: 'Gate', key: 'Gate' })), /different software/);
  assert.throws(() => lic.install(licFile({ expiry_date: addDays(t, -1) })), /expired/);
  assert.strictEqual(lic.install(licFile({ expiry_date: t })).valid, true, 'valid through the expiry date');
  // A file pasted into the install folder: the later expiry wins; an expired one asks for renewal.
  fs.writeFileSync(path.join(licRoot, `${SOFTWARE_NAME}_93.lmlic`), licFile({ expiry_date: addDays(t, 365) }));
  assert.strictEqual(lic.reload().expiryDate, addDays(t, 365));
  fs.writeFileSync(path.join(licRoot, `${SOFTWARE_NAME}_93.lmlic`), licFile({ expiry_date: addDays(t, -5) }));
  // The saved copy is encrypted: not readable, and any edit (e.g. a later expiry) breaks it.
  const store = path.join(licData, 'license.dat');
  const sealed = fs.readFileSync(store, 'utf8');
  assert.ok(!sealed.includes('expiry_date') && !sealed.includes(key), 'saved license is not readable');
  const raw = Buffer.from(sealed, 'base64');
  raw[raw.length - 3] ^= 1;
  fs.writeFileSync(store, raw.toString('base64'));
  const expired = lic.reload();
  assert.strictEqual(expired.state, 'expired', 'edited saved copy no longer counts; the pasted expired file does');
  assert.strictEqual(expired.renewal, true);
  assert.strictEqual(expired.expiryDate, addDays(t, -5));
  fs.rmSync(path.join(licRoot, `${SOFTWARE_NAME}_93.lmlic`));
  assert.match(lic.reload().message, /changed or damaged/);
  fs.writeFileSync(store, licFile({ expiry_date: addDays(t, 999) }));
  assert.strictEqual(lic.reload().valid, false, 'a readable file in place of the saved copy is refused');
  fs.writeFileSync(path.join(licData, 'license.json'), licFile());
  new LicenseManager({ dataDir: licData });
  assert.ok(!fs.existsSync(path.join(licData, 'license.json')), 'readable copies from earlier builds are removed');
  // Loading a renewed file replaces the old one: no other step.
  assert.strictEqual(lic.install(licFile({ expiry_date: addDays(t, 400) })).expiryDate, addDays(t, 400));

  // Borrowers seen before: one per Number, from their latest issue (fills the Issue form)
  const bdb = await LibraryDB.open(null);
  bdb.saveBook({ book_no: 'N-1', name: 'Book one' });
  bdb.saveBook({ book_no: 'N-2', name: 'Book two' });
  bdb.issueBook({ bookNo: 'N-1', userName: 'Ravi', rank: 'Lt', number: 'C-101', dept: 'Ops', duration: 7 });
  bdb.returnBook({ bookNo: 'N-1', userName: 'Ravi' });
  bdb.issueBook({ bookNo: 'N-2', userName: 'Ravi Kumar', rank: 'Cdr', number: 'C-101', dept: 'Air', duration: 7 });
  bdb.issueBook({ bookNo: 'N-1', userName: 'Priya', duration: 7 }); // no Number: not listed
  assert.deepStrictEqual(bdb.borrowerDetails(), [{ number: 'C-101', name: 'Ravi Kumar', rank: 'Cdr', dept: 'Air' }]);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('All smoke tests passed.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
