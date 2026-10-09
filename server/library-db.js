// Library database on MySQL: the same business rules as src/database.js (the app's local SQLite
// version), with async queries. One instance per edition; `prefix` picks the tables:
//   Technical Library (version 1): books, issues, users, settings
//   General Library   (version 2): general_books, general_issues, general_users, general_settings
// DATE / DATETIME columns are read as strings ('YYYY-MM-DD', 'YYYY-MM-DD HH:MM:SS'), as the app expects.

const crypto = require('crypto');
const { today, isValidDate, addDays, display, daysBetween } = require('../src/dates');
const { checks } = require('../renderer/rules');

const DEFAULT_USERNAME = 'admin';
const TABLES = ['books', 'issues', 'users', 'settings'];

class UserError extends Error {}

function check(...messages) {
  const msg = messages.find(Boolean);
  if (msg) throw new UserError(msg);
}

function clean(v) {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v == null ? '' : String(v).trim();
}

// MySQL's default LIKE escape character is the backslash.
function likeParam(s) {
  return `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

const pad = (n) => String(n).padStart(2, '0');
// Local date-time of the server process (TZ is set from .env), like SQLite's datetime('now','localtime').
function now() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const ISSUE_COLS = `id, book_id, book_no, book_name, issue_user, issue_rank, issue_number, issue_dept, issue_date, duration, due_date,
  issue_remarks, return_date, return_user, return_remarks, returned_late, issued_at, returned_at`;

function schema(p) {
  return [
    `CREATE TABLE IF NOT EXISTS ${p}books (
      id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
      book_no     VARCHAR(50)  NOT NULL,
      name        VARCHAR(200) NOT NULL,
      author      VARCHAR(150) NOT NULL DEFAULT '',
      publisher   VARCHAR(150) NOT NULL DEFAULT '',
      category    VARCHAR(100) NOT NULL DEFAULT '',
      lf          VARCHAR(30)  NOT NULL DEFAULT '',
      location    VARCHAR(30)  NOT NULL DEFAULT '',
      rack        VARCHAR(30)  NOT NULL DEFAULT '',
      created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_${p}books_book_no (book_no)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS ${p}issues (
      id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
      book_id         INT UNSIGNED NULL,
      book_no         VARCHAR(50)  NOT NULL,
      book_name       VARCHAR(200) NOT NULL,
      issue_user      VARCHAR(100) NOT NULL,
      issue_rank      VARCHAR(50)  NOT NULL DEFAULT '',
      issue_number    VARCHAR(50)  NOT NULL DEFAULT '',
      issue_dept      VARCHAR(50)  NOT NULL DEFAULT '',
      issue_date      DATE         NOT NULL,
      duration        INT          NOT NULL,
      due_date        DATE         NOT NULL,
      issue_remarks   VARCHAR(250) NOT NULL DEFAULT '',
      return_date     DATE         NULL,
      return_user     VARCHAR(100) NULL,
      return_remarks  VARCHAR(250) NULL,
      returned_late   TINYINT(1)   NOT NULL DEFAULT 0,
      issued_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      returned_at     DATETIME     NULL,
      PRIMARY KEY (id),
      KEY idx_${p}issues_book (book_id),
      KEY idx_${p}issues_open (return_date),
      CONSTRAINT fk_${p}issues_book FOREIGN KEY (book_id) REFERENCES ${p}books (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS ${p}users (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
      username      VARCHAR(30)  NOT NULL,
      password_hash CHAR(128)    NOT NULL,
      salt          CHAR(32)     NOT NULL,
      active        TINYINT(1)   NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_${p}users_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS ${p}settings (
      \`key\`   VARCHAR(50)  NOT NULL,
      \`value\` VARCHAR(255) NOT NULL,
      PRIMARY KEY (\`key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ];
}

class MySqlLibraryDB {
  constructor(pool, prefix = '') {
    if (!/^[a-z_]*$/.test(prefix)) throw new Error('Invalid table prefix');
    this.pool = pool;
    this.p = prefix;
    // Table names for this edition, used in every query.
    this.t = Object.fromEntries(TABLES.map((n) => [n, prefix + n]));
  }

  // Creates missing tables and adds columns introduced after the first release.
  // One look at the database first: on a remote server every query costs a round trip, so the
  // tables are only created / altered when something is actually missing.
  async init() {
    const [cols] = await this.pool.query(
      'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)',
      [Object.values(this.t)]
    );
    const tables = new Set(cols.map((r) => r.t));
    const issueCols = cols.filter((r) => r.t === this.t.issues).map((r) => r.c);
    const created = !tables.has(this.t.settings);
    if (TABLES.some((n) => !tables.has(this.t[n]))) {
      for (const sql of schema(this.p)) await this.pool.query(sql);
    }
    const add = [
      ['issue_rank', 'issue_user'],
      ['issue_number', 'issue_rank'],
      ['issue_dept', 'issue_number'],
    ];
    for (const [col, after] of add) {
      if (tables.has(this.t.issues) && !issueCols.includes(col)) {
        await this.pool.query(`ALTER TABLE ${this.t.issues} ADD COLUMN ${col} VARCHAR(50) NOT NULL DEFAULT '' AFTER ${after}`);
        issueCols.push(col);
      }
    }
    // A missing default_duration reads as 14 days anyway (getSettings), so only a new table needs it.
    if (created) await this.pool.query(`INSERT IGNORE INTO ${this.t.settings} (\`key\`, \`value\`) VALUES ('default_duration', '14')`);
  }

  // ---------- Query helpers (cx: a connection inside a transaction, or the pool) ----------
  async all(sql, params = [], cx = this.pool) {
    const [rows] = await cx.query(sql, params);
    return rows;
  }

  async get(sql, params = [], cx = this.pool) {
    return (await this.all(sql, params, cx))[0] || null;
  }

  async run(sql, params = [], cx = this.pool) {
    const [res] = await cx.query(sql, params);
    return res;
  }

  async _transaction(fn) {
    const cx = await this.pool.getConnection();
    try {
      await cx.beginTransaction();
      const result = await fn(cx);
      await cx.commit();
      return result;
    } catch (e) {
      await cx.rollback().catch(() => {});
      if (e.code === 'ER_DUP_ENTRY') throw new UserError('That value is already in use. Please refresh and try again.');
      throw e;
    } finally {
      cx.release();
    }
  }

  // ---------- Settings ----------
  async getSetting(key, cx) {
    const row = await this.get(`SELECT \`value\` FROM ${this.t.settings} WHERE \`key\` = ?`, [key], cx);
    return row ? row.value : null;
  }

  async _setSetting(key, value, cx) {
    await this.run(
      `INSERT INTO ${this.t.settings} (\`key\`, \`value\`) VALUES (?, ?) ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
      [key, String(value)],
      cx
    );
  }

  async getSettings() {
    const [user, rows] = await Promise.all([
      this.get(`SELECT username FROM ${this.t.users} ORDER BY id LIMIT 1`),
      this.all(`SELECT \`key\`, \`value\` FROM ${this.t.settings} WHERE \`key\` IN ('default_duration', 'default_credentials')`),
    ]);
    const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      defaultDuration: Number(s.default_duration) || 14,
      username: user ? user.username : '',
      defaultCredentials: s.default_credentials === '1',
    };
  }

  async setDefaultDuration(days) {
    check(checks.duration(days));
    await this._setSetting('default_duration', Number(days));
    return this.getSettings();
  }

  // ---------- Authentication ----------
  async needsSetup() {
    return !(await this.get(`SELECT id FROM ${this.t.users} LIMIT 1`));
  }

  async createFirstUser({ username, password } = {}) {
    if (!(await this.needsSetup())) throw new UserError('The library is already set up. Please sign in.');
    const user = await this.createUser({ username, password, active: true });
    await this._setSetting('default_credentials', '0');
    return user;
  }

  async verifyLogin(username, password) {
    const user = await this.get(`SELECT id, username, password_hash, salt, active FROM ${this.t.users} WHERE username = ?`, [
      clean(username),
    ]);
    if (!user || typeof password !== 'string') return null;
    const a = Buffer.from(hashPassword(password, user.salt), 'hex');
    const b = Buffer.from(user.password_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { id: user.id, username: user.username, active: user.active === 1 };
  }

  async getUser(id) {
    const u = await this.get(`SELECT id, username, active FROM ${this.t.users} WHERE id = ?`, [Number(id)]);
    return u ? { ...u, active: u.active === 1 } : null;
  }

  async changeCredentials(userId, { currentPassword, newUsername, newPassword } = {}) {
    const user = await this.get(`SELECT id, username, password_hash, salt FROM ${this.t.users} WHERE id = ?`, [userId]);
    if (!user) throw new UserError('User not found.');
    if (!(await this.verifyLogin(user.username, currentPassword))) throw new UserError('Current password is incorrect.');
    const username = newUsername == null || String(newUsername).trim() === '' ? user.username : String(newUsername).trim();
    check(checks.username(username), checks.newPassword(newPassword));
    if (await this.get(`SELECT id FROM ${this.t.users} WHERE username = ? AND id <> ?`, [username, userId])) {
      throw new UserError('That username is already in use.');
    }
    let hash = user.password_hash;
    let salt = user.salt;
    if (newPassword) {
      salt = crypto.randomBytes(16).toString('hex');
      hash = hashPassword(newPassword, salt);
    }
    await this._transaction(async (cx) => {
      await this.run(`UPDATE ${this.t.users} SET username = ?, password_hash = ?, salt = ? WHERE id = ?`, [username, hash, salt, userId], cx);
      if (newPassword) await this._setSetting('default_credentials', '0', cx);
    });
    return { id: userId, username };
  }

  // ---------- User management ----------
  async listUsers() {
    const rows = await this.all(`SELECT id, username, active FROM ${this.t.users} ORDER BY username`);
    return rows.map((u) => ({ ...u, active: u.active === 1 }));
  }

  async createUser({ username, password, active = true } = {}) {
    const name = username == null ? '' : String(username).trim();
    check(checks.username(name), password ? checks.newPassword(password) : 'Password is required.');
    if (await this.get(`SELECT id FROM ${this.t.users} WHERE username = ?`, [name])) {
      throw new UserError('That username is already in use.');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const res = await this.run(`INSERT INTO ${this.t.users} (username, password_hash, salt, active) VALUES (?, ?, ?, ?)`, [
      name,
      hashPassword(password, salt),
      salt,
      active === false ? 0 : 1,
    ]);
    return { id: res.insertId, username: name, active: active !== false };
  }

  async updateUser(id, { username, password, active } = {}, currentUserId = null) {
    const user = await this.get(`SELECT id, username, password_hash, salt, active FROM ${this.t.users} WHERE id = ?`, [Number(id)]);
    if (!user) throw new UserError('This user no longer exists.');
    const isActive = active == null ? user.active === 1 : active !== false;
    if (!isActive && user.id === currentUserId) throw new UserError('You cannot make the account you are signed in with inactive.');
    const name = username == null ? '' : String(username).trim();
    check(checks.username(name), checks.newPassword(password));
    if (await this.get(`SELECT id FROM ${this.t.users} WHERE username = ? AND id <> ?`, [name, user.id])) {
      throw new UserError('That username is already in use.');
    }
    let { password_hash: hash, salt } = user;
    if (password) {
      salt = crypto.randomBytes(16).toString('hex');
      hash = hashPassword(password, salt);
    }
    await this._transaction(async (cx) => {
      await this.run(
        `UPDATE ${this.t.users} SET username = ?, password_hash = ?, salt = ?, active = ? WHERE id = ?`,
        [name, hash, salt, isActive ? 1 : 0, user.id],
        cx
      );
      if (password && user.username.toLowerCase() === DEFAULT_USERNAME) await this._setSetting('default_credentials', '0', cx);
    });
    return { id: user.id, username: name, active: isActive };
  }

  async deleteUser(id, currentUserId) {
    const user = await this.get(`SELECT id, username FROM ${this.t.users} WHERE id = ?`, [Number(id)]);
    if (!user) throw new UserError('This user no longer exists.');
    if (user.id === currentUserId) throw new UserError('You cannot delete the account you are signed in with.');
    if ((await this.get(`SELECT COUNT(*) AS n FROM ${this.t.users}`)).n <= 1) throw new UserError('At least one user account must remain.');
    await this._transaction(async (cx) => {
      await this.run(`DELETE FROM ${this.t.users} WHERE id = ?`, [user.id], cx);
      if (user.username.toLowerCase() === DEFAULT_USERNAME) await this._setSetting('default_credentials', '0', cx);
    });
    return true;
  }

  async deleteUsers(ids, currentUserId) {
    const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(Number))];
    if (!wanted.length) throw new UserError('Select at least one user to delete.');
    if (wanted.includes(currentUserId)) throw new UserError('You cannot delete the account you are signed in with.');
    const users = (await this.listUsers()).filter((u) => wanted.includes(u.id));
    if (!users.length) throw new UserError('The selected users no longer exist.');
    await this._transaction(async (cx) => {
      for (const u of users) {
        await this.run(`DELETE FROM ${this.t.users} WHERE id = ?`, [u.id], cx);
        if (u.username.toLowerCase() === DEFAULT_USERNAME) await this._setSetting('default_credentials', '0', cx);
      }
    });
    return users.length;
  }

  // ---------- Books ----------
  _bookSelect() {
    return `SELECT b.id, b.book_no, b.name, b.author, b.publisher, b.category, b.lf, b.location, b.rack, b.created_at, b.updated_at,
              i.id AS issue_id, i.issue_user, i.issue_rank, i.issue_number, i.issue_dept, i.issue_date, i.due_date, i.duration, i.issue_remarks,
              CASE WHEN i.id IS NULL THEN 'Available' ELSE 'Issued' END AS status
            FROM ${this.t.books} b
            LEFT JOIN ${this.t.issues} i ON i.book_id = b.id AND i.return_date IS NULL`;
  }

  async searchBooks({ query = '', category = '', status = '', location = '', rack = '' } = {}) {
    const q = clean(query);
    const where = [];
    const params = [];
    if (q) {
      where.push('(b.book_no LIKE ? OR b.name LIKE ? OR b.lf LIKE ? OR b.category LIKE ?)');
      const p = likeParam(q);
      params.push(p, p, p, p);
    }
    if (clean(category)) {
      where.push('b.category = ?');
      params.push(clean(category));
    }
    if (clean(location)) {
      where.push('b.location = ?');
      params.push(clean(location));
    }
    if (clean(rack)) {
      where.push('b.rack = ?');
      params.push(clean(rack));
    }
    if (status === 'Available') where.push('i.id IS NULL');
    if (status === 'Issued') where.push('i.id IS NOT NULL');
    return this.all(`${this._bookSelect()} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.id DESC`, params);
  }

  async getBookByNumber(bookNo, cx) {
    const n = clean(bookNo);
    if (!n) return null;
    return this.get(`${this._bookSelect()} WHERE b.book_no = ?`, [n], cx);
  }

  async categories() {
    const rows = await this.all(`SELECT DISTINCT category FROM ${this.t.books} WHERE category <> '' ORDER BY category`);
    return rows.map((r) => r.category);
  }

  async saveBook(input = {}) {
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
    const dup = await this.get(`SELECT id FROM ${this.t.books} WHERE book_no = ?`, [book.book_no]);
    if (dup && dup.id !== book.id) {
      throw new UserError(`Barcode No "${book.book_no}" already exists. Each book must have a unique number.`);
    }
    return this._transaction(async (cx) => {
      if (book.id) {
        const existing = await this.get(`SELECT id FROM ${this.t.books} WHERE id = ?`, [book.id], cx);
        if (!existing) throw new UserError('This book no longer exists.');
        await this.run(
          `UPDATE ${this.t.books} SET book_no = ?, name = ?, lf = ?, category = ?, location = ?, rack = ?, updated_at = ? WHERE id = ?`,
          [book.book_no, book.name, book.lf, book.category, book.location, book.rack, now(), book.id],
          cx
        );
        // Keep the open issue's snapshot in step with the edited book.
        await this.run(
          `UPDATE ${this.t.issues} SET book_no = ?, book_name = ? WHERE book_id = ? AND return_date IS NULL`,
          [book.book_no, book.name, book.id],
          cx
        );
        return this.get(`${this._bookSelect()} WHERE b.id = ?`, [book.id], cx);
      }
      const stamp = now();
      const res = await this.run(
        `INSERT INTO ${this.t.books} (book_no, name, author, lf, category, location, rack, created_at, updated_at)
         VALUES (?, ?, '', ?, ?, ?, ?, ?, ?)`,
        [book.book_no, book.name, book.lf, book.category, book.location, book.rack, stamp, stamp],
        cx
      );
      return this.get(`${this._bookSelect()} WHERE b.id = ?`, [res.insertId], cx);
    });
  }

  async validateImport(rows) {
    rows = Array.isArray(rows) ? rows : [];
    const ready = [];
    const errors = [];
    const seen = new Map();
    const existing = new Set((await this.all(`SELECT book_no FROM ${this.t.books}`)).map((b) => b.book_no.toLowerCase()));
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
        ...(Array.isArray(r.issues) ? r.issues : []),
        checks.bookNo(book.book_no),
        checks.lf(book.lf),
        checks.category(book.category),
        checks.bookName(book.name),
        checks.location(book.location),
        checks.rack(book.rack),
      ].filter(Boolean);
      const key = book.book_no.toLowerCase();
      if (key) {
        if (seen.has(key)) messages.push(`Barcode No "${book.book_no}" is repeated (first seen in row ${seen.get(key)}).`);
        else seen.set(key, r.rowNumber);
        if (existing.has(key)) messages.push(`Barcode No "${book.book_no}" already exists in the library.`);
      }
      if (messages.length) errors.push({ rowNumber: r.rowNumber, book_no: book.book_no, messages });
      else ready.push(book);
    }
    return { total: rows.length, ready, errors };
  }

  async importBooks(rows) {
    const { ready, errors } = await this.validateImport(rows);
    if (!ready.length && !errors.length) throw new UserError('There are no rows to import.');
    if (ready.length) {
      const stamp = now();
      await this._transaction(async (cx) => {
        for (const b of ready) {
          await this.run(
            `INSERT INTO ${this.t.books} (book_no, name, author, lf, category, location, rack, created_at, updated_at)
             VALUES (?, ?, '', ?, ?, ?, ?, ?, ?)`,
            [b.book_no, b.name, b.lf, b.category, b.location, b.rack, stamp, stamp],
            cx
          );
        }
      });
    }
    return { imported: ready.length, skipped: errors.length, errors };
  }

  async deleteBook(id) {
    const book = await this.get(`${this._bookSelect()} WHERE b.id = ?`, [Number(id)]);
    if (!book) throw new UserError('This book no longer exists.');
    if (book.issue_id) {
      throw new UserError(`Book "${book.book_no}" is currently issued to ${book.issue_user} and cannot be deleted.`);
    }
    await this._transaction(async (cx) => {
      await this.run(`UPDATE ${this.t.issues} SET book_id = NULL WHERE book_id = ?`, [book.id], cx);
      await this.run(`DELETE FROM ${this.t.books} WHERE id = ?`, [book.id], cx);
    });
    return true;
  }

  // ---------- Circulation ----------
  async lookupForCirculation(bookNo) {
    const book = await this.getBookByNumber(bookNo);
    if (!book) return { book: null };
    const t = today();
    const overdueDays = book.issue_id && book.due_date < t ? daysBetween(book.due_date, t) : 0;
    return { book, overdueDays, today: t };
  }

  async issueBook({ bookNo, userName, rank = '', number = '', dept = '', duration, remarks } = {}) {
    return this._transaction(async (cx) => {
      // Lock the book row so two librarians cannot issue the same book at the same moment.
      // Read and lock the book (and its open issue) in one query, so two librarians cannot act on it at once.
      const book = clean(bookNo) ? await this.get(`${this._bookSelect()} WHERE b.book_no = ? FOR UPDATE`, [clean(bookNo)], cx) : null;
      if (!book) throw new UserError(`No book found with Barcode No "${clean(bookNo)}".`);
      if (book.issue_id) {
        throw new UserError(`Book "${book.book_no}" is already issued to ${book.issue_user} (due ${display(book.due_date)}).`);
      }
      check(
        checks.person(userName, 'Name'),
        checks.detail(rank, 'Rank'),
        checks.detail(number, 'Number'),
        checks.detail(dept, 'Dept'),
        checks.duration(duration),
        checks.remarks(remarks)
      );
      const days = Number(duration);
      const issueDate = today();
      const dueDate = addDays(issueDate, days);
      const res = await this.run(
        `INSERT INTO ${this.t.issues} (book_id, book_no, book_name, issue_user, issue_rank, issue_number, issue_dept, issue_date,
           duration, due_date, issue_remarks, issued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [book.id, book.book_no, book.name, clean(userName), clean(rank), clean(number), clean(dept), issueDate, days, dueDate,
          clean(remarks), now()],
        cx
      );
      return this.get(`SELECT ${ISSUE_COLS} FROM ${this.t.issues} WHERE id = ?`, [res.insertId], cx);
    });
  }

  async returnBook({ bookNo, userName, remarks } = {}) {
    const returnDate = today();
    return this._transaction(async (cx) => {
      // Read and lock the book (and its open issue) in one query, so two librarians cannot act on it at once.
      const book = clean(bookNo) ? await this.get(`${this._bookSelect()} WHERE b.book_no = ? FOR UPDATE`, [clean(bookNo)], cx) : null;
      if (!book) throw new UserError(`No book found with Barcode No "${clean(bookNo)}".`);
      if (!book.issue_id) throw new UserError(`Book "${book.book_no}" is not currently issued.`);
      check(checks.person(userName, 'Name'), checks.remarks(remarks));
      const late = returnDate > book.due_date ? 1 : 0;
      await this.run(
        `UPDATE ${this.t.issues} SET return_date = ?, return_user = ?, return_remarks = ?, returned_late = ?, returned_at = ? WHERE id = ?`,
        [returnDate, clean(userName), clean(remarks), late, now(), book.issue_id],
        cx
      );
      return this.get(`SELECT ${ISSUE_COLS} FROM ${this.t.issues} WHERE id = ?`, [book.issue_id], cx);
    });
  }

  async shelfValues() {
    const values = async (col) =>
      (await this.all(`SELECT DISTINCT ${col} AS v FROM ${this.t.books} WHERE ${col} <> '' ORDER BY ${col}`)).map((r) => r.v);
    const [categories, locations, racks] = await Promise.all([values('category'), values('location'), values('rack')]);
    return { categories, locations, racks };
  }

  async borrowerNames() {
    const rows = await this.all(
      `SELECT name FROM (SELECT issue_user AS name FROM ${this.t.issues}
                         UNION SELECT return_user FROM ${this.t.issues} WHERE return_user IS NOT NULL) AS n
       ORDER BY name`
    );
    return rows.map((r) => r.name);
  }

  async recentActivity(limit = 12) {
    return this.all(
      `SELECT action, book_no, book_name, user_name, at, due_date, late FROM (
         SELECT 'Issued' AS action, book_no, book_name, issue_user AS user_name, issued_at AS at, due_date, 0 AS late FROM ${this.t.issues}
         UNION ALL
         SELECT CASE WHEN returned_late = 1 THEN 'Returned Late' ELSE 'Returned' END, book_no, book_name, return_user, returned_at,
                due_date, returned_late
           FROM ${this.t.issues} WHERE return_date IS NOT NULL
       ) AS a ORDER BY at DESC LIMIT ?`,
      [Number(limit) || 12]
    );
  }

  async todaysActivity(kind) {
    const t = today();
    if (kind === 'issue') return this.all(`SELECT ${ISSUE_COLS} FROM ${this.t.issues} WHERE issue_date = ? ORDER BY id DESC`, [t]);
    return this.all(`SELECT ${ISSUE_COLS} FROM ${this.t.issues} WHERE return_date = ? ORDER BY returned_at DESC`, [t]);
  }

  // ---------- Dashboard ----------
  // Counts, due-soon list and recent activity are fetched at the same time.
  async dashboard() {
    const t = today();
    const [counts, dueSoon, recent] = await Promise.all([
      this.get(
        `SELECT (SELECT COUNT(*) FROM ${this.t.books}) AS total,
                (SELECT COUNT(*) FROM ${this.t.issues} WHERE return_date IS NULL AND book_id IS NOT NULL) AS issued,
                (SELECT COUNT(*) FROM ${this.t.issues} WHERE return_date IS NULL AND book_id IS NOT NULL AND due_date < ?) AS overdue`,
        [t]
      ),
      this.all(
        `SELECT book_no, book_name, issue_user, due_date, DATEDIFF(due_date, ?) AS days_left
           FROM ${this.t.issues} WHERE return_date IS NULL AND book_id IS NOT NULL AND due_date >= ? AND due_date <= ?
           ORDER BY due_date, book_no LIMIT 10`,
        [t, t, addDays(t, 3)]
      ),
      this.recentActivity(8),
    ]);
    const total = Number(counts.total);
    const issued = Number(counts.issued);
    return { today: t, total, issued, available: total - issued, overdue: Number(counts.overdue), dueSoon, recent };
  }

  // ---------- Reports ----------
  async overdueList(asOn = today(), { userName = '', bookNo = '', q = '' } = {}) {
    asOn = asOn || today();
    if (!isValidDate(asOn)) throw new UserError('Please choose a valid "As on" date.');
    const where = ['issue_date <= ?', 'due_date < ?', '(return_date IS NULL OR return_date > ?)'];
    const params = [asOn, asOn, asOn];
    this._textFilters(where, params, { userName, bookNo, q });
    return this.all(
      `SELECT book_no, book_name, issue_user, issue_rank, issue_number, issue_dept, issue_date, due_date, return_date, issue_remarks,
              DATEDIFF(?, due_date) AS days_overdue
         FROM ${this.t.issues}
        WHERE ${where.join(' AND ')}
        ORDER BY days_overdue DESC, book_no`,
      [asOn, ...params]
    );
  }

  _textFilters(where, params, { userName = '', bookNo = '', q = '' }) {
    const u = clean(userName);
    if (u) {
      where.push("(issue_user LIKE ? OR IFNULL(return_user, '') LIKE ?)");
      params.push(likeParam(u), likeParam(u));
    }
    const n = clean(bookNo);
    if (n) {
      where.push('book_no LIKE ?');
      params.push(likeParam(n));
    }
    const t = clean(q);
    if (t) {
      const cols = ['book_no', 'book_name', 'issue_user', "IFNULL(return_user, '')", 'issue_remarks', "IFNULL(return_remarks, '')"];
      where.push('(' + cols.map((c) => `${c} LIKE ?`).join(' OR ') + ')');
      params.push(...cols.map(() => likeParam(t)));
    }
  }

  async circulationList({ from = '', to = '', dateBy = 'issue', userName = '', bookNo = '', status = '', q = '' } = {}) {
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
      `SELECT ${ISSUE_COLS},
              CASE
                   WHEN return_date IS NULL AND due_date < ? THEN 'Overdue'
                   WHEN return_date IS NULL THEN 'Issued'
                   WHEN returned_late = 1 THEN 'Returned Late'
                   ELSE 'Returned' END AS status
         FROM ${this.t.issues} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY ${order}`,
      [t, ...params]
    );
  }

  // ---------- Backup / restore ----------
  // All rows of the four tables, for a backup file made by the app.
  async exportData() {
    const data = {};
    for (const name of TABLES) data[name] = await this.all(`SELECT * FROM ${this.t[name]} ORDER BY 1`);
    return data;
  }

  // Replaces everything with the rows of a backup (validated by the app before it is sent).
  async replaceData(data) {
    const cols = {
      books: ['id', 'book_no', 'name', 'author', 'publisher', 'category', 'lf', 'location', 'rack', 'created_at', 'updated_at'],
      issues: ['id', 'book_id', 'book_no', 'book_name', 'issue_user', 'issue_rank', 'issue_number', 'issue_dept', 'issue_date', 'duration',
        'due_date', 'issue_remarks', 'return_date', 'return_user', 'return_remarks', 'returned_late', 'issued_at', 'returned_at'],
      users: ['id', 'username', 'password_hash', 'salt', 'active'],
      settings: ['key', 'value'],
    };
    for (const name of TABLES) if (!Array.isArray(data && data[name])) throw new UserError('The selected file is not a valid library backup.');
    if (!data.users.length) throw new UserError('The backup has no user accounts, so nobody could sign in. It was not restored.');
    await this._transaction(async (cx) => {
      for (const name of ['issues', 'books', 'users', 'settings']) await this.run(`DELETE FROM ${this.t[name]}`, [], cx);
      for (const name of ['books', 'issues', 'users', 'settings']) {
        const list = cols[name];
        const sql = `INSERT INTO ${this.t[name]} (${list.map((c) => `\`${c}\``).join(', ')}) VALUES (${list.map(() => '?').join(', ')})`;
        for (const row of data[name]) {
          await this.run(sql, list.map((c) => (row[c] === undefined ? defaults(name, c) : row[c])), cx);
        }
      }
    });
    await this.init(); // default settings for anything the backup did not have
    return true;
  }
}

// Values for columns that older backups do not have.
function defaults(table, col) {
  if (['created_at', 'updated_at', 'issued_at'].includes(col)) return now();
  if (col === 'active') return 1;
  if (col === 'returned_late') return 0;
  if (['return_date', 'return_user', 'return_remarks', 'returned_at', 'book_id'].includes(col)) return null;
  return '';
}

module.exports = { MySqlLibraryDB, UserError, DEFAULT_USERNAME };
