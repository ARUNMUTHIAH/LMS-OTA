// End-to-end check of the library API server (server/index.js) through the app's own client.
// Needs a running server on an EMPTY test database — it creates accounts, books and issues.
// Usage: LMS_SERVER=http://127.0.0.1:4555 node test/server-check.js            (through the API server)
//        LMS_DIRECT='{"host":..,"user":..,"password":..,"database":..}' node test/server-check.js   (MySQL directly)
const assert = require('assert');
const { RemoteDB, AuthError, asLibrary } = require('../src/remote');
const { LibraryDB, UserError } = require('../src/database');
const reports = require('../src/reports');
const { today, addDays } = require('../src/dates');

const URL = process.env.LMS_SERVER;
const DIRECT = process.env.LMS_DIRECT ? JSON.parse(process.env.LMS_DIRECT) : null;
if (!URL && !DIRECT) {
  console.error('Set LMS_SERVER (API server address) or LMS_DIRECT (MySQL login as JSON) for an empty test database.');
  process.exit(1);
}
const { DirectDB } = require('../src/direct');
const client = (edition) => (DIRECT ? new DirectDB(DIRECT, edition) : new RemoteDB(URL, edition));

const rejects = (p, pattern, type = UserError) =>
  assert.rejects(p, (e) => e instanceof type && pattern.test(e.message), `expected ${type.name} ${pattern}`);

async function edition(name) {
  const remote = client(name);
  const lib = asLibrary(remote);
  const t = today();

  // Not signed in: only the public methods work.
  await rejects(lib.searchBooks({}), /session has ended/, AuthError);
  assert.strictEqual(await remote.call('needsSetup'), true, `${name}: new library has no accounts`);
  await rejects(remote.call('setup', { username: 'admin', password: '' }), /Password is required/);
  const setup = await remote.call('setup', { username: 'librarian', password: 'pass1234' });
  assert.ok(setup.token && setup.user.username === 'librarian');
  await rejects(remote.call('setup', { username: 'other', password: 'pass1234' }), /already set up/);
  await rejects(remote.call('login', { username: 'librarian', password: 'wrong' }), /Invalid username or password/);
  const login = await remote.call('login', { username: 'LIBRARIAN', password: 'pass1234' });
  remote.token = login.token;
  assert.strictEqual(login.settings.defaultDuration, 14);

  // Books
  const b1 = await lib.saveBook({ book_no: 'OTA-001', name: 'Wings of Fire', lf: '001-06', category: 'DOR-MM', location: 'B2', rack: '6' });
  assert.strictEqual(b1.status, 'Available');
  await lib.saveBook({ book_no: 'OTA-002', name: 'Physics Vol I', category: 'Science' });
  await rejects(lib.saveBook({ book_no: 'ota-001', name: 'Dup' }), /Barcode No "ota-001" already exists/);
  await rejects(lib.saveBook({ book_no: '', name: 'x' }), /Barcode No is required/);
  assert.strictEqual((await lib.searchBooks({ query: '001-06' })).length, 1, 'search by LF / Title');
  assert.strictEqual((await lib.searchBooks({ query: '50%' })).length, 0, 'LIKE wildcards are escaped');
  assert.strictEqual((await lib.searchBooks({ category: 'science' })).length, 1, 'filters ignore case');
  const edited = await lib.saveBook({ ...b1, name: 'Wings of Fire (2nd ed)' });
  assert.strictEqual(edited.name, 'Wings of Fire (2nd ed)');
  assert.deepStrictEqual((await lib.shelfValues()).categories, ['DOR-MM', 'Science']);

  // Import
  const preview = await lib.validateImport([
    { rowNumber: 2, values: { book_no: 'IMP-1', name: 'Imported one' } },
    { rowNumber: 3, values: { book_no: 'imp-1', name: 'Repeated' } },
    { rowNumber: 4, values: { book_no: 'OTA-002', name: 'Exists' } },
  ]);
  assert.strictEqual(preview.ready.length, 1);
  assert.strictEqual(preview.errors.length, 2);
  const imp = await lib.importBooks([{ rowNumber: 2, values: { book_no: 'IMP-1', name: 'Imported one' } }]);
  assert.strictEqual(imp.imported, 1);

  // Issue and return, with Rank / Number / Dept
  await rejects(lib.issueBook({ bookNo: 'NOPE', userName: 'A', duration: 7 }), /No book found/);
  await rejects(lib.issueBook({ bookNo: 'OTA-001', userName: '', duration: 7 }), /Name is required/);
  await rejects(lib.issueBook({ bookNo: 'OTA-001', userName: 'Ravi', duration: 400 }), /between 1 and 365/);
  const issue = await lib.issueBook({ bookNo: 'ota-001', userName: 'Ravi Kumar', rank: 'Lt', number: '12345', dept: 'Air Ops', duration: 7 });
  assert.strictEqual(issue.due_date, addDays(t, 7));
  assert.strictEqual(issue.issue_date, t, 'DATE comes back as YYYY-MM-DD');
  assert.match(issue.issued_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'DATETIME comes back as text');
  assert.strictEqual(issue.issue_rank, 'Lt');
  await rejects(lib.issueBook({ bookNo: 'OTA-001', userName: 'Someone', duration: 7 }), /already issued to Ravi Kumar/);
  await rejects(lib.deleteBook(b1.id), /currently issued/);
  const look = await lib.lookupForCirculation('OTA-001');
  assert.strictEqual(look.book.issue_dept, 'Air Ops');
  assert.strictEqual(look.overdueDays, 0);
  const dash = await lib.dashboard();
  assert.deepStrictEqual([dash.total, dash.issued, dash.available], [3, 1, 2]);
  assert.strictEqual(dash.recent[0].action, 'Issued');
  assert.strictEqual((await lib.todaysActivity('issue')).length, 1);
  assert.deepStrictEqual(await lib.borrowerNames(), ['Ravi Kumar']);
  assert.strictEqual((await lib.overdueList(addDays(t, 10))).length, 1, 'overdue as on a later date');
  assert.strictEqual((await lib.overdueList(addDays(t, 10)))[0].days_overdue, 3);

  // Reports run on the server's data
  assert.strictEqual((await reports.buildReport(lib, 'books', { status: 'Available' })).rows.length, 2);
  const rc = await reports.buildReport(lib, 'circulation', { userName: 'ravi' });
  assert.strictEqual(rc.rows[0].issue_number, '12345');
  assert.ok((await reports.toHtml(lib, 'overdue', { asOn: addDays(t, 10) })).includes('Wings of Fire'));

  const ret = await lib.returnBook({ bookNo: 'OTA-001', userName: 'Ravi Kumar', remarks: 'Good condition' });
  assert.strictEqual(ret.return_date, t);
  assert.strictEqual(ret.returned_late, 0);
  await rejects(lib.returnBook({ bookNo: 'OTA-001', userName: 'Ravi', remarks: '' }), /not currently issued/);
  assert.strictEqual((await lib.circulationList({ status: 'Returned' })).length, 1);
  assert.strictEqual((await lib.circulationList({ q: 'good cond' })).length, 1, 'search in remarks');

  // Users: the signed-in user comes from the token
  const u2 = await lib.createUser({ username: 'helper', password: 'pass1234' });
  const users = await lib.listUsers();
  assert.strictEqual(users.find((u) => u.username === 'librarian').me, true);
  await rejects(lib.deleteUser(setup.user.id), /signed in with/);
  await rejects(lib.updateUser(setup.user.id, { username: 'librarian', active: false }), /cannot make the account/);
  const helper = client(name);
  helper.token = (await helper.call('login', { username: 'helper', password: 'pass1234' })).token;
  await lib.updateUser(u2.id, { username: 'helper', active: false });
  await rejects(asLibrary(helper).dashboard(), /session has ended/, AuthError);
  await rejects(helper.call('login', { username: 'helper', password: 'pass1234' }), /inactive/);
  await lib.deleteUser(u2.id);
  await lib.setDefaultDuration(21);
  assert.strictEqual((await lib.getSettings()).defaultDuration, 21);

  // Backup -> local .db file -> restore round trip
  const data = await lib.exportData();
  const local = await LibraryDB.open(null);
  local.replaceData(data);
  assert.strictEqual(local.searchBooks({}).length, 3, 'backup file has the books');
  assert.ok(local.verifyLogin('librarian', 'pass1234'), 'backup file keeps the accounts');
  const restored = await LibraryDB.open(null);
  restored.restoreFrom(local.exportBytes());
  await lib.saveBook({ book_no: 'AFTER-BACKUP', name: 'Added after the backup' });
  await lib.replaceData(restored.exportData());
  await rejects(lib.dashboard(), /session has ended/, AuthError); // restore signs everyone out
  remote.token = (await remote.call('login', { username: 'librarian', password: 'pass1234' })).token;
  assert.strictEqual((await lib.searchBooks({})).length, 3, 'restore replaced the data');
  assert.strictEqual((await lib.circulationList({})).length, 1, 'restore kept the history');
  await lib.saveBook({ book_no: 'AFTER-RESTORE', name: 'New ids continue after the restored ones' });

  await remote.call('logout');
  await rejects(lib.dashboard(), /session has ended/, AuthError);
  return remote;
}

(async () => {
  await edition('technical');
  await edition('general');
  // The two versions never see each other's data or accounts.
  const v1 = client('technical');
  v1.token = (await v1.call('login', { username: 'librarian', password: 'pass1234' })).token;
  await asLibrary(v1).saveBook({ book_no: 'ONLY-V1', name: 'Only in version 1' });
  const v2 = client('general');
  v2.token = (await v2.call('login', { username: 'librarian', password: 'pass1234' })).token;
  assert.strictEqual((await asLibrary(v2).searchBooks({ query: 'ONLY-V1' })).length, 0, 'version 2 does not see version 1 books');
  const v2Lib = asLibrary(v2);
  // A token from one version does not open the other.
  const cross = client('general');
  cross.token = v1.token;
  await rejects(asLibrary(cross).dashboard(), /session has ended/, AuthError);
  assert.strictEqual((await v2Lib.dashboard()).total, 4);
  console.log(`All checks passed (version 1 and version 2, ${DIRECT ? 'MySQL directly' : 'API server'}).`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
