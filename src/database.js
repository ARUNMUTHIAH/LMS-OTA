// Library database: SQLite (via sql.js / WebAssembly) persisted to a single local file.
// All business rules for books, circulation, dashboard and reports live here so they
// can be exercised without Electron (see test/smoke.js).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');
const { today, isValidDate, addDays, display } = require('./dates');
const { checks } = require('../renderer/rules');

const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'admin123';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_no     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL,
  author      TEXT NOT NULL,
  publisher   TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  lf          TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  rack        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS issues (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id         INTEGER,
  book_no         TEXT NOT NULL,
  book_name       TEXT NOT NULL,
  issue_user      TEXT NOT NULL,
  issue_date      TEXT NOT NULL,
  duration        INTEGER NOT NULL,
  due_date        TEXT NOT NULL,
  issue_remarks   TEXT NOT NULL DEFAULT '',
  return_date     TEXT,
  return_user     TEXT,
  return_remarks  TEXT,
  returned_late   INTEGER NOT NULL DEFAULT 0,
  issued_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  returned_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_issues_book ON issues(book_id);
CREATE INDEX IF NOT EXISTS idx_issues_open ON issues(return_date);
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

class UserError extends Error {}

// Throws the first failing rule as a UserError.
function check(...messages) {
  const msg = messages.find(Boolean);
  if (msg) throw new UserError(msg);
}

function clean(v) {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v == null ? '' : String(v).trim();
}

function likeParam(s) {
  return `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

class LibraryDB {
  static async open(filePath) {
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wasmPath) });
    const inst = new LibraryDB(SQL, filePath);
    inst._load();
    return inst;
  }

  constructor(SQL, filePath) {
    this.SQL = SQL;
    this.filePath = filePath;
    this.db = null;
  }

  _load() {
    if (this.filePath && fs.existsSync(this.filePath)) {
      this.db = new this.SQL.Database(fs.readFileSync(this.filePath));
    } else {
      this.db = new this.SQL.Database();
    }
    this.db.run(SCHEMA);
    this._migrate();
    this._seed();
    this._save();
  }

  // Adds columns introduced after the first release to databases created by older versions.
  _migrate() {
    const cols = this.all('PRAGMA table_info(books)').map((c) => c.name);
    for (const col of ['lf', 'location', 'rack']) {
      if (!cols.includes(col)) this.db.run(`ALTER TABLE books ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
    }
    const userCols = this.all('PRAGMA table_info(users)').map((c) => c.name);
    if (!userCols.includes('active')) this.db.run('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
  }

  _seed() {
    if (!this.get('SELECT id FROM users LIMIT 1')) {
      const salt = crypto.randomBytes(16).toString('hex');
      this.db.run('INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)', [
        DEFAULT_USERNAME,
        hashPassword(DEFAULT_PASSWORD, salt),
        salt,
      ]);
      this._setSetting('default_credentials', '1');
    }
    if (this.getSetting('default_duration') == null) this._setSetting('default_duration', '14');
  }

  // Writes the database atomically: temp file then rename, so a crash never leaves a half-written file.
  _save() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(this.db.export()));
    fs.renameSync(tmp, this.filePath);
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(sql, params = []) {
    return this.all(sql, params)[0] || null;
  }

  _transaction(fn) {
    this.db.run('BEGIN');
    try {
      const result = fn();
      this.db.run('COMMIT');
      this._save();
      return result;
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
  }

  _lastId() {
    return this.get('SELECT last_insert_rowid() AS id').id;
  }

  // ---------- Settings ----------
  getSetting(key) {
    const row = this.get('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : null;
  }

  _setSetting(key, value) {
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, String(value)]
    );
  }

  getSettings() {
    const user = this.get('SELECT username FROM users ORDER BY id LIMIT 1');
    return {
      defaultDuration: Number(this.getSetting('default_duration')) || 14,
      username: user ? user.username : DEFAULT_USERNAME,
      defaultCredentials: this.getSetting('default_credentials') === '1',
    };
  }

  setDefaultDuration(days) {
    check(checks.duration(days));
    const n = Number(days);
    this._transaction(() => this._setSetting('default_duration', n));
    return this.getSettings();
  }

  // ---------- Authentication ----------
  verifyLogin(username, password) {
    const user = this.get('SELECT * FROM users WHERE username = ?', [clean(username)]);
    if (!user || typeof password !== 'string') return null;
    const a = Buffer.from(hashPassword(password, user.salt), 'hex');
    const b = Buffer.from(user.password_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { id: user.id, username: user.username, active: user.active === 1 };
  }

  changeCredentials(userId, { currentPassword, newUsername, newPassword }) {
    const user = this.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) throw new UserError('User not found.');
    if (!this.verifyLogin(user.username, currentPassword)) throw new UserError('Current password is incorrect.');
    const username = newUsername == null || String(newUsername).trim() === '' ? user.username : String(newUsername).trim();
    check(checks.username(username), checks.newPassword(newPassword));
    const taken = this.get('SELECT id FROM users WHERE username = ? AND id <> ?', [username, userId]);
    if (taken) throw new UserError('That username is already in use.');
    let hash = user.password_hash;
    let salt = user.salt;
    if (newPassword) {
      salt = crypto.randomBytes(16).toString('hex');
      hash = hashPassword(newPassword, salt);
    }
    this._transaction(() => {
      this.db.run('UPDATE users SET username = ?, password_hash = ?, salt = ? WHERE id = ?', [username, hash, salt, userId]);
      if (newPassword) this._setSetting('default_credentials', '0');
    });
    return { id: userId, username };
  }

  // ---------- User management ----------
  listUsers() {
    return this.all('SELECT id, username, active FROM users ORDER BY username COLLATE NOCASE').map((u) => ({ ...u, active: u.active === 1 }));
  }

  createUser({ username, password, active = true } = {}) {
    const name = username == null ? '' : String(username).trim();
    check(checks.username(name), password ? checks.newPassword(password) : 'Password is required.');
    if (this.get('SELECT id FROM users WHERE username = ?', [name])) {
      throw new UserError('That username is already in use.');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    return this._transaction(() => {
      this.db.run('INSERT INTO users (username, password_hash, salt, active) VALUES (?, ?, ?, ?)', [
        name,
        hashPassword(password, salt),
        salt,
        active === false ? 0 : 1,
      ]);
      return { id: this._lastId(), username: name, active: active !== false };
    });
  }

  // Edits a user's login. A blank password keeps the existing one; status is unchanged unless given.
  updateUser(id, { username, password, active } = {}, currentUserId = null) {
    const user = this.get('SELECT * FROM users WHERE id = ?', [Number(id)]);
    if (!user) throw new UserError('This user no longer exists.');
    const isActive = active == null ? user.active === 1 : active !== false;
    if (!isActive && user.id === currentUserId) throw new UserError('You cannot make the account you are signed in with inactive.');
    const name = username == null ? '' : String(username).trim();
    check(checks.username(name), checks.newPassword(password));
    if (this.get('SELECT id FROM users WHERE username = ? AND id <> ?', [name, user.id])) {
      throw new UserError('That username is already in use.');
    }
    let { password_hash: hash, salt } = user;
    if (password) {
      salt = crypto.randomBytes(16).toString('hex');
      hash = hashPassword(password, salt);
    }
    this._transaction(() => {
      this.db.run('UPDATE users SET username = ?, password_hash = ?, salt = ?, active = ? WHERE id = ?', [
        name,
        hash,
        salt,
        isActive ? 1 : 0,
        user.id,
      ]);
      if (password && user.username.toLowerCase() === DEFAULT_USERNAME) this._setSetting('default_credentials', '0');
    });
    return { id: user.id, username: name, active: isActive };
  }

  deleteUser(id, currentUserId) {
    const user = this.get('SELECT id, username FROM users WHERE id = ?', [Number(id)]);
    if (!user) throw new UserError('This user no longer exists.');
    if (user.id === currentUserId) throw new UserError('You cannot delete the account you are signed in with.');
    if (this.get('SELECT COUNT(*) AS n FROM users').n <= 1) throw new UserError('At least one user account must remain.');
    this._transaction(() => {
      this.db.run('DELETE FROM users WHERE id = ?', [user.id]);
      if (user.username.toLowerCase() === DEFAULT_USERNAME) this._setSetting('default_credentials', '0');
    });
    return true;
  }

  // Deletes several users at once; the signed-in account is never included.
  deleteUsers(ids, currentUserId) {
    const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(Number))];
    if (!wanted.length) throw new UserError('Select at least one user to delete.');
    if (wanted.includes(currentUserId)) throw new UserError('You cannot delete the account you are signed in with.');
    const users = this.listUsers().filter((u) => wanted.includes(u.id));
    if (!users.length) throw new UserError('The selected users no longer exist.');
    this._transaction(() => {
      for (const u of users) {
        this.db.run('DELETE FROM users WHERE id = ?', [u.id]);
        if (u.username.toLowerCase() === DEFAULT_USERNAME) this._setSetting('default_credentials', '0');
      }
    });
    return users.length;
  }

  // ---------- Books ----------
  _bookSelect() {
    return `SELECT b.id, b.book_no, b.name, b.author, b.publisher, b.category, b.lf, b.location, b.rack, b.created_at, b.updated_at,
              i.id AS issue_id, i.issue_user, i.issue_date, i.due_date, i.duration, i.issue_remarks,
              CASE WHEN i.id IS NULL THEN 'Available' ELSE 'Issued' END AS status
            FROM books b
            LEFT JOIN issues i ON i.book_id = b.id AND i.return_date IS NULL`;
  }

  searchBooks({ query = '', category = '', status = '', location = '', rack = '' } = {}) {
    const q = clean(query);
    const where = [];
    const params = [];
    if (q) {
      where.push(
        "(b.book_no LIKE ? ESCAPE '\\' OR b.name LIKE ? ESCAPE '\\' OR b.lf LIKE ? ESCAPE '\\' OR b.category LIKE ? ESCAPE '\\')"
      );
      const p = likeParam(q);
      params.push(p, p, p, p);
    }
    if (clean(category)) {
      where.push('b.category = ? COLLATE NOCASE');
      params.push(clean(category));
    }
    if (clean(location)) {
      where.push('b.location = ? COLLATE NOCASE');
      params.push(clean(location));
    }
    if (clean(rack)) {
      where.push('b.rack = ? COLLATE NOCASE');
      params.push(clean(rack));
    }
    if (status === 'Available') where.push('i.id IS NULL');
    if (status === 'Issued') where.push('i.id IS NOT NULL');
    const sql = `${this._bookSelect()} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.id DESC`;
    return this.all(sql, params);
  }

  getBookByNumber(bookNo) {
    const n = clean(bookNo);
    if (!n) return null;
    return this.get(`${this._bookSelect()} WHERE b.book_no = ? COLLATE NOCASE`, [n]);
  }

  categories() {
    return this.all("SELECT DISTINCT category FROM books WHERE category <> '' ORDER BY category COLLATE NOCASE").map(
      (r) => r.category
    );
  }

  saveBook(input) {
    const book = {
      id: input.id ? Number(input.id) : null,
      book_no: clean(input.book_no),
      name: clean(input.name),
      lf: clean(input.lf),
      category: clean(input.category),
      location: clean(input.location),
      rack: clean(input.rack),
    };
    check(
      checks.bookNo(book.book_no),
      checks.lf(book.lf),
      checks.category(book.category),
      checks.bookName(book.name),
      checks.location(book.location),
      checks.rack(book.rack)
    );

    const dup = this.get('SELECT id FROM books WHERE book_no = ? COLLATE NOCASE', [book.book_no]);
    if (dup && dup.id !== book.id) {
      throw new UserError(`Accession Number "${book.book_no}" already exists. Each book must have a unique number.`);
    }

    return this._transaction(() => {
      if (book.id) {
        const existing = this.get('SELECT id FROM books WHERE id = ?', [book.id]);
        if (!existing) throw new UserError('This book no longer exists.');
        this.db.run(
          `UPDATE books SET book_no = ?, name = ?, lf = ?, category = ?, location = ?, rack = ?,
             updated_at = datetime('now','localtime') WHERE id = ?`,
          [book.book_no, book.name, book.lf, book.category, book.location, book.rack, book.id]
        );
        // Keep the open issue's snapshot in step with the edited book.
        this.db.run('UPDATE issues SET book_no = ?, book_name = ? WHERE book_id = ? AND return_date IS NULL', [
          book.book_no,
          book.name,
          book.id,
        ]);
        return this.get(`${this._bookSelect()} WHERE b.id = ?`, [book.id]);
      }
      this.db.run(
        `INSERT INTO books (book_no, name, author, lf, category, location, rack) VALUES (?, ?, '', ?, ?, ?, ?)`,
        [book.book_no, book.name, book.lf, book.category, book.location, book.rack]
      );
      return this.get(`${this._bookSelect()} WHERE b.id = ?`, [this._lastId()]);
    });
  }

  // Checks rows read from an import file with the same rules as the Add Book form.
  // Every problem in a row is reported, not just the first. Nothing is saved here.
  validateImport(rows) {
    const ready = [];
    const errors = [];
    const seen = new Map(); // accession (lower case) -> first Excel row
    const existing = new Set(this.all('SELECT book_no FROM books').map((b) => b.book_no.toLowerCase()));
    for (const r of rows) {
      const v = r.values || {};
      const book = {
        book_no: clean(v.book_no),
        lf: clean(v.lf),
        category: clean(v.category),
        name: clean(v.name),
        location: clean(v.location),
        rack: clean(v.rack),
      };
      const messages = [
        ...(r.issues || []),
        checks.bookNo(book.book_no),
        checks.lf(book.lf),
        checks.category(book.category),
        checks.bookName(book.name),
        checks.location(book.location),
        checks.rack(book.rack),
      ].filter(Boolean);
      const key = book.book_no.toLowerCase();
      if (key) {
        if (seen.has(key)) messages.push(`Accession Number "${book.book_no}" is repeated (first seen in row ${seen.get(key)}).`);
        else seen.set(key, r.rowNumber);
        if (existing.has(key)) messages.push(`Accession Number "${book.book_no}" already exists in the library.`);
      }
      if (messages.length) errors.push({ rowNumber: r.rowNumber, book_no: book.book_no, messages });
      else ready.push(book);
    }
    return { total: rows.length, ready, errors };
  }

  // Saves the valid rows in one transaction; rows with errors are skipped and returned.
  importBooks(rows) {
    const { ready, errors } = this.validateImport(rows);
    if (!ready.length && !errors.length) throw new UserError('There are no rows to import.');
    if (ready.length) this._transaction(() => {
      for (const b of ready) {
        this.db.run(
          `INSERT INTO books (book_no, name, author, lf, category, location, rack) VALUES (?, ?, '', ?, ?, ?, ?)`,
          [b.book_no, b.name, b.lf, b.category, b.location, b.rack]
        );
      }
    });
    return { imported: ready.length, skipped: errors.length, errors };
  }

  deleteBook(id) {
    const book = this.get(`${this._bookSelect()} WHERE b.id = ?`, [Number(id)]);
    if (!book) throw new UserError('This book no longer exists.');
    if (book.issue_id) {
      throw new UserError(`Book "${book.book_no}" is currently issued to ${book.issue_user} and cannot be deleted.`);
    }
    this._transaction(() => {
      // Circulation history keeps its book number / name snapshot.
      this.db.run('UPDATE issues SET book_id = NULL WHERE book_id = ?', [book.id]);
      this.db.run('DELETE FROM books WHERE id = ?', [book.id]);
    });
    return true;
  }

  // ---------- Circulation ----------
  lookupForCirculation(bookNo) {
    const book = this.getBookByNumber(bookNo);
    if (!book) return { book: null };
    const t = today();
    let overdueDays = 0;
    if (book.issue_id && book.due_date < t) {
      overdueDays = this.get('SELECT CAST(julianday(?) - julianday(?) AS INTEGER) AS d', [t, book.due_date]).d;
    }
    return { book, overdueDays, today: t };
  }

  issueBook({ bookNo, userName, duration, remarks }) {
    const book = this.getBookByNumber(bookNo);
    if (!book) throw new UserError(`No book found with number "${clean(bookNo)}".`);
    if (book.issue_id) {
      throw new UserError(`Book "${book.book_no}" is already issued to ${book.issue_user} (due ${display(book.due_date)}).`);
    }
    check(checks.person(userName, 'User Name'), checks.duration(duration), checks.remarks(remarks));
    const user = clean(userName);
    const days = Number(duration);
    const issueDate = today();
    const dueDate = addDays(issueDate, days);
    return this._transaction(() => {
      this.db.run(
        `INSERT INTO issues (book_id, book_no, book_name, issue_user, issue_date, duration, due_date, issue_remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [book.id, book.book_no, book.name, user, issueDate, days, dueDate, clean(remarks)]
      );
      return this.get('SELECT * FROM issues WHERE id = ?', [this._lastId()]);
    });
  }

  returnBook({ bookNo, userName, remarks }) {
    const book = this.getBookByNumber(bookNo);
    if (!book) throw new UserError(`No book found with number "${clean(bookNo)}".`);
    if (!book.issue_id) throw new UserError(`Book "${book.book_no}" is not currently issued.`);
    check(checks.person(userName, 'Returned By'), checks.remarks(remarks));
    const user = clean(userName);
    const returnDate = today();
    const late = returnDate > book.due_date ? 1 : 0;
    return this._transaction(() => {
      this.db.run(
        `UPDATE issues SET return_date = ?, return_user = ?, return_remarks = ?, returned_late = ?,
           returned_at = datetime('now','localtime') WHERE id = ?`,
        [returnDate, user, clean(remarks), late, book.issue_id]
      );
      return this.get('SELECT * FROM issues WHERE id = ?', [book.issue_id]);
    });
  }

  // Values used in the books, for the CAT / LOC / Rack filter menus.
  shelfValues() {
    const distinct = (col) =>
      this.all(`SELECT DISTINCT ${col} AS v FROM books WHERE ${col} <> '' ORDER BY ${col} COLLATE NOCASE`).map((r) => r.v);
    return { categories: distinct('category'), locations: distinct('location'), racks: distinct('rack') };
  }

  borrowerNames() {
    return this.all(
      `SELECT name FROM (SELECT issue_user AS name FROM issues UNION SELECT return_user FROM issues WHERE return_user IS NOT NULL)
       ORDER BY name COLLATE NOCASE`
    ).map((r) => r.name);
  }

  recentActivity(limit = 12) {
    return this.all(
      `SELECT * FROM (
         SELECT 'Issued' AS action, book_no, book_name, issue_user AS user_name, issued_at AS at, due_date, 0 AS late FROM issues
         UNION ALL
         SELECT CASE WHEN returned_late = 1 THEN 'Returned Late' ELSE 'Returned' END, book_no, book_name, return_user, returned_at, due_date, returned_late
           FROM issues WHERE return_date IS NOT NULL
       ) ORDER BY at DESC LIMIT ?`,
      [limit]
    );
  }

  todaysActivity(kind) {
    const t = today();
    if (kind === 'issue') {
      return this.all('SELECT * FROM issues WHERE issue_date = ? ORDER BY id DESC', [t]);
    }
    return this.all('SELECT * FROM issues WHERE return_date = ? ORDER BY returned_at DESC', [t]);
  }

  // ---------- Dashboard ----------
  dashboard() {
    const t = today();
    const total = this.get('SELECT COUNT(*) AS n FROM books').n;
    const issued = this.get('SELECT COUNT(*) AS n FROM issues WHERE return_date IS NULL AND book_id IS NOT NULL').n;
    const overdue = this.get(
      'SELECT COUNT(*) AS n FROM issues WHERE return_date IS NULL AND book_id IS NOT NULL AND due_date < ?',
      [t]
    ).n;
    const dueSoon = this.all(
      `SELECT book_no, book_name, issue_user, due_date, CAST(julianday(due_date) - julianday(?) AS INTEGER) AS days_left
         FROM issues WHERE return_date IS NULL AND book_id IS NOT NULL AND due_date >= ? AND due_date <= ?
         ORDER BY due_date, book_no LIMIT 10`,
      [t, t, addDays(t, 3)]
    );
    return {
      today: t,
      total,
      issued,
      available: total - issued,
      overdue,
      dueSoon,
      recent: this.recentActivity(8),
    };
  }

  // ---------- Reports ----------
  overdueList(asOn = today(), { userName = '', bookNo = '', q = '' } = {}) {
    if (!isValidDate(asOn)) throw new UserError('Please choose a valid "As on" date.');
    const where = ['issue_date <= ?', 'due_date < ?', '(return_date IS NULL OR return_date > ?)'];
    const params = [asOn, asOn, asOn];
    this._textFilters(where, params, { userName, bookNo, q });
    return this.all(
      `SELECT book_no, book_name, issue_user, issue_date, due_date, return_date, issue_remarks,
              CAST(julianday(?) - julianday(due_date) AS INTEGER) AS days_overdue
         FROM issues
        WHERE ${where.join(' AND ')}
        ORDER BY days_overdue DESC, book_no`,
      [asOn, ...params]
    );
  }

  // Shared text filters for circulation lists: borrower, accession number and free-text search.
  _textFilters(where, params, { userName = '', bookNo = '', q = '' }) {
    const u = clean(userName);
    if (u) {
      where.push("(issue_user LIKE ? ESCAPE '\\' OR IFNULL(return_user, '') LIKE ? ESCAPE '\\')");
      params.push(likeParam(u), likeParam(u));
    }
    const n = clean(bookNo);
    if (n) {
      where.push("book_no LIKE ? ESCAPE '\\'");
      params.push(likeParam(n));
    }
    const t = clean(q);
    if (t) {
      const cols = ['book_no', 'book_name', 'issue_user', "IFNULL(return_user, '')", 'issue_remarks', "IFNULL(return_remarks, '')"];
      where.push('(' + cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ') + ')');
      params.push(...cols.map(() => likeParam(t)));
    }
  }

  // Issue/return records.
  //   dateBy: which date From/To apply to — 'issue' (default), 'return' or 'due'.
  //   status: '' (all), 'Out' (not returned), 'Issued' (out, on time), 'Overdue', 'Returned' (on time),
  //           'Returned Late', 'AllReturned'.
  circulationList({ from = '', to = '', dateBy = 'issue', userName = '', bookNo = '', status = '', q = '' } = {}) {
    const dateCol = { issue: 'issue_date', return: 'return_date', due: 'due_date' }[dateBy];
    if (!dateCol) throw new UserError('Unknown date filter.');
    const where = [];
    const params = [];
    if (from) {
      if (!isValidDate(from)) throw new UserError('Invalid "From" date.');
      where.push(`${dateCol} >= ?`);
      params.push(from);
    }
    if (to) {
      if (!isValidDate(to)) throw new UserError('Invalid "To" date.');
      where.push(`${dateCol} <= ?`);
      params.push(to);
    }
    if (from && to && from > to) throw new UserError('"From" date must be on or before the "To" date.');
    if (dateBy === 'return') where.push('return_date IS NOT NULL');
    const t = today();
    switch (status) {
      case '':
        break;
      case 'Out':
        where.push('return_date IS NULL');
        break;
      case 'Issued':
        where.push('return_date IS NULL AND due_date >= ?');
        params.push(t);
        break;
      case 'Overdue':
        where.push('return_date IS NULL AND due_date < ?');
        params.push(t);
        break;
      case 'Returned':
        where.push('return_date IS NOT NULL AND returned_late = 0');
        break;
      case 'Returned Late':
        where.push('return_date IS NOT NULL AND returned_late = 1');
        break;
      case 'AllReturned':
        where.push('return_date IS NOT NULL');
        break;
      default:
        throw new UserError('Unknown status filter.');
    }
    this._textFilters(where, params, { userName, bookNo, q });
    const order = dateBy === 'issue' ? 'issue_date DESC, id DESC' : `${dateCol} DESC, id DESC`;
    return this.all(
      `SELECT *, CASE
                   WHEN return_date IS NULL AND due_date < ? THEN 'Overdue'
                   WHEN return_date IS NULL THEN 'Issued'
                   WHEN returned_late = 1 THEN 'Returned Late'
                   ELSE 'Returned' END AS status
         FROM issues ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY ${order}`,
      [t, ...params]
    );
  }

  // ---------- Backup / restore ----------
  exportBytes() {
    return Buffer.from(this.db.export());
  }

  restoreFrom(bytes) {
    let candidate;
    try {
      candidate = new this.SQL.Database(bytes);
      const tables = candidate
        .exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]
        ?.values.map((v) => v[0]) || [];
      for (const t of ['books', 'issues', 'users', 'settings']) {
        if (!tables.includes(t)) throw new Error('missing table ' + t);
      }
    } catch (e) {
      if (candidate) candidate.close();
      throw new UserError('The selected file is not a valid library backup.');
    }
    this.db.close();
    this.db = candidate;
    this.db.run(SCHEMA);
    this._migrate();
    this._seed();
    this._save();
  }
}

module.exports = { LibraryDB, UserError, DEFAULT_USERNAME, DEFAULT_PASSWORD };
