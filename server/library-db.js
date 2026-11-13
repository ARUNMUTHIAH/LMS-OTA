// Library database on MySQL: the same business rules as src/database.js (the app's local SQLite
// version), with async queries. One instance per edition; `prefix` picks the tables:
//   Technical Library (version 1): technical_books, technical_issues, technical_users, technical_settings
//   General Library   (version 2): general_books, general_issues, general_users, general_settings
// DATE / DATETIME columns are read as strings ('YYYY-MM-DD', 'YYYY-MM-DD HH:MM:SS'), as the app expects.

const crypto = require('crypto');
const { today, isValidDate, addDays, display, daysBetween } = require('../src/dates');
const { checks, access, bookValue } = require('../renderer/rules');

const DEFAULT_USERNAME = 'admin';
const TABLES = ['books', 'issues', 'users', 'settings'];

// Audit log: every change made in the software, kept for one year, then removed automatically.
// Not part of TABLES on purpose: a backup restore never replaces or empties it, and the app has
// no way to edit or delete an entry (server/api.js only adds and reads). The triggers below make
// MySQL itself refuse any UPDATE, and any DELETE of an entry younger than one year.
const AUDIT_KEEP_DAYS = 365;
const AUDIT_LIST_LIMIT = 5000;
const auditSchema = (t) => `CREATE TABLE IF NOT EXISTS ${t} (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      logged_at   DATETIME     NOT NULL,
      username    VARCHAR(100) NOT NULL DEFAULT '',
      computer    VARCHAR(100) NOT NULL DEFAULT '',
      category    VARCHAR(30)  NOT NULL DEFAULT '',
      action      VARCHAR(60)  NOT NULL DEFAULT '',
      record      VARCHAR(200) NOT NULL DEFAULT '',
      details     TEXT         NULL,
      result      VARCHAR(10)  NOT NULL DEFAULT 'Success',
      PRIMARY KEY (id),
      KEY idx_${t}_at (logged_at),
      KEY idx_${t}_user (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
const auditTriggers = (t) => [
  [`${t}_no_update`, `CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit log entries cannot be changed.'`],
  [`${t}_no_delete`, `CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} FOR EACH ROW
    BEGIN
      IF OLD.logged_at >= NOW() - INTERVAL 364 DAY THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit log entries are kept for one year and cannot be deleted.';
      END IF;
    END`],
];

// Lists that show books are in Barcode No order: by letter prefix A-Z, then by number
// (BAG-001, CAG-001, CAG-002, CAG-010, DAG-001). Capitals, spaces and dashes are ignored, so
// "cag 001", "CAG001" and "CAG-001" sort together. Ties keep the query's own order.
const barcodeOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base', ignorePunctuation: true });
const byBarcode = (rows) => rows.sort((a, b) => barcodeOrder.compare(String(a.book_no || ''), String(b.book_no || '')));

class UserError extends Error {}

// User access: each account has a list of permissions (screens and actions, see access in
// renderer/rules.js), enforced in server/api.js. The old role column is kept in step: "librarian" for
// Full access, "viewer" for anything less, so an older copy of the app treats a limited account as
// View only rather than giving it everything.
const ROLES = ['librarian', 'viewer'];
const checkRole = (r) => (ROLES.includes(r) ? null : 'Choose an access level: Librarian or View only.');
const roleFor = (perms) => (perms.length === access.ALL.length ? 'librarian' : 'viewer');
// A users row as the app sees it: { id, username, active, role, perms }.
function userOut(u) {
  const perms = access.permsOf(u);
  return { id: u.id, username: u.username, active: u.active === 1 || u.active === true, role: roleFor(perms), perms };
}
// The permissions asked for: a list, or (older callers) a role; else the fallback.
function wantedPerms({ perms, role }, fallback) {
  if (Array.isArray(perms)) return access.normalizePerms(perms);
  if (role != null) {
    check(checkRole(role));
    return access.permsOf({ role });
  }
  return fallback;
}
const USER_COLS = 'id, username, active, role, permissions';

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

const ISSUE_COLS = `id, book_id, book_no, book_name, issue_user, issue_rank, issue_number, issue_dept, issue_date, issue_time, duration,
  due_date, issue_remarks, issued_by, return_date, return_time, return_user, return_remarks, returned_by, returned_late, issued_at, returned_at`;
// Fills issue_time / return_time from issued_at / returned_at where they are empty (rows from before
// these columns, older backups, or rows added by hand in phpMyAdmin).
const fillTimes = (t) => [
  `UPDATE ${t} SET issue_time = TIME(issued_at) WHERE issue_time IS NULL AND issued_at IS NOT NULL`,
  `UPDATE ${t} SET return_time = TIME(returned_at) WHERE return_time IS NULL AND returned_at IS NOT NULL`,
];

function schema(p) {
  return [
    `CREATE TABLE IF NOT EXISTS ${p}books (
      id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
      book_no     VARCHAR(768) NOT NULL,
      name        TEXT         NOT NULL,
      author      VARCHAR(150) NOT NULL DEFAULT '',
      publisher   VARCHAR(150) NOT NULL DEFAULT '',
      category    TEXT         NOT NULL,
      lf          TEXT         NOT NULL,
      location    TEXT         NOT NULL,
      rack        TEXT         NOT NULL,
      created_by  VARCHAR(100) NULL,
      updated_by  VARCHAR(100) NULL,
      created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_${p}books_book_no (book_no)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS ${p}issues (
      id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
      book_id         INT UNSIGNED NULL,
      book_no         VARCHAR(768) NOT NULL,
      book_name       TEXT         NOT NULL,
      issue_user      VARCHAR(100) NOT NULL,
      issue_rank      VARCHAR(50)  NOT NULL DEFAULT '',
      issue_number    VARCHAR(50)  NOT NULL DEFAULT '',
      issue_dept      VARCHAR(50)  NOT NULL DEFAULT '',
      issue_date      DATE         NOT NULL,
      issue_time      TIME         NULL,
      duration        INT          NOT NULL,
      due_date        DATE         NOT NULL,
      issue_remarks   VARCHAR(250) NOT NULL DEFAULT '',
      issued_by       VARCHAR(100) NULL,
      return_date     DATE         NULL,
      return_time     TIME         NULL,
      return_user     VARCHAR(100) NULL,
      return_remarks  VARCHAR(250) NULL,
      returned_by     VARCHAR(100) NULL,
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
      role          VARCHAR(20)  NOT NULL DEFAULT 'librarian',
      permissions   VARCHAR(255) NULL,
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_${p}users_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS ${p}settings (
      \`key\`   VARCHAR(50)  NOT NULL,
      \`value\` MEDIUMTEXT   NOT NULL,
      updated_at DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    this.audit = prefix + 'audit_log';
  }

  // Creates missing tables and adds columns introduced after the first release.
  // One look at the database first: on a remote server every query costs a round trip, so the
  // tables are only created / altered when something is actually missing.
  async init() {
    const [cols] = await this.pool.query(
      'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS d, CHARACTER_MAXIMUM_LENGTH AS l FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)',
      [[...Object.values(this.t), this.audit]]
    );
    const tables = new Set(cols.map((r) => r.t));
    const issueCols = cols.filter((r) => r.t === this.t.issues).map((r) => r.c);
    const bookCols = cols.filter((r) => r.t === this.t.books).map((r) => r.c);
    const userCols = cols.filter((r) => r.t === this.t.users).map((r) => r.c);
    const settingCols = cols.filter((r) => r.t === this.t.settings).map((r) => r.c);
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
    // Issue and return time of day, beside their dates (the full timestamps stay in issued_at / returned_at).
    if (tables.has(this.t.issues) && !issueCols.includes('issue_time')) {
      await this.pool.query(`ALTER TABLE ${this.t.issues} ADD COLUMN issue_time TIME NULL AFTER issue_date,
        ADD COLUMN return_time TIME NULL AFTER return_date`);
      for (const sql of fillTimes(this.t.issues)) await this.pool.query(sql);
    }
    // The signed-in account (username) that recorded the issue / the return.
    if (tables.has(this.t.issues) && !issueCols.includes('issued_by')) {
      await this.pool.query(`ALTER TABLE ${this.t.issues} ADD COLUMN issued_by VARCHAR(100) NULL AFTER issue_remarks,
        ADD COLUMN returned_by VARCHAR(100) NULL AFTER return_remarks`);
    }
    // The signed-in account (username) that added the book / last edited it.
    if (tables.has(this.t.books) && !bookCols.includes('created_by')) {
      await this.pool.query(`ALTER TABLE ${this.t.books} ADD COLUMN created_by VARCHAR(100) NULL AFTER rack,
        ADD COLUMN updated_by VARCHAR(100) NULL AFTER created_by`);
    }
    // Book fields had length limits (VARCHAR 30-200): Barcode No is widened to VARCHAR(768) and
    // Description, LF / Title, CAT / Author, LOC, Rack become TEXT (no practical limit).
    const colType = (t, c) => cols.find((r) => r.t === t && r.c === c);
    const isVarchar = (col) => col && String(col.d).toLowerCase() === 'varchar';
    const bookNo = colType(this.t.books, 'book_no');
    if (bookNo && Number(bookNo.l) < 768) {
      await this.pool.query(`ALTER TABLE ${this.t.books} MODIFY book_no VARCHAR(768) NOT NULL`);
    }
    const toText = ['name', 'category', 'lf', 'location', 'rack'].filter((c) => isVarchar(colType(this.t.books, c)));
    if (toText.length) {
      await this.pool.query(`ALTER TABLE ${this.t.books} ${toText.map((c) => `MODIFY ${c} TEXT NOT NULL`).join(', ')}`);
    }
    const issueNo = colType(this.t.issues, 'book_no');
    const issueName = colType(this.t.issues, 'book_name');
    const issueAlter = [
      issueNo && Number(issueNo.l) < 768 ? 'MODIFY book_no VARCHAR(768) NOT NULL' : '',
      isVarchar(issueName) ? 'MODIFY book_name TEXT NOT NULL' : '',
    ].filter(Boolean);
    if (issueAlter.length) await this.pool.query(`ALTER TABLE ${this.t.issues} ${issueAlter.join(', ')}`);
    if (tables.has(this.t.users) && !userCols.includes('role')) {
      await this.pool.query(`ALTER TABLE ${this.t.users} ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'librarian' AFTER active`);
      userCols.push('role');
    }
    if (tables.has(this.t.users) && !userCols.includes('permissions')) {
      await this.pool.query(`ALTER TABLE ${this.t.users} ADD COLUMN permissions VARCHAR(255) NULL AFTER role`);
    }
    // Timestamps on users and settings (books and issues have theirs from the start). Rows that
    // existed before get the time the column was added.
    if (tables.has(this.t.users) && !userCols.includes('created_at')) {
      await this.pool.query(`ALTER TABLE ${this.t.users} ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER permissions,
        ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER created_at`);
    }
    // Settings values hold the uploaded logo (a data URL) too: wider than the first VARCHAR(255).
    const valueCol = cols.find((r) => r.t === this.t.settings && r.c === 'value');
    if (valueCol && String(valueCol.d).toLowerCase() === 'varchar') {
      await this.pool.query(`ALTER TABLE ${this.t.settings} MODIFY \`value\` MEDIUMTEXT NOT NULL`);
    }
    if (tables.has(this.t.settings) && !settingCols.includes('updated_at')) {
      await this.pool.query(`ALTER TABLE ${this.t.settings} ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER \`value\``);
    }
    // A missing default_duration reads as 14 days anyway (getSettings), so only a new table needs it.
    if (created) await this.pool.query(`INSERT IGNORE INTO ${this.t.settings} (\`key\`, \`value\`) VALUES ('default_duration', '14')`);
    if (!tables.has(this.audit)) await this.pool.query(auditSchema(this.audit));
    await this._auditTriggers();
  }

  // Database-level protection of the audit log. Creating triggers needs the TRIGGER privilege
  // (scripts/db-audit-log.sql does it as the admin account); without it the app's own rules
  // still apply (no edit / delete anywhere in the software).
  async _auditTriggers() {
    try {
      const [have] = await this.pool.query(
        'SELECT TRIGGER_NAME AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = ?',
        [this.audit]
      );
      const names = new Set(have.map((r) => r.n));
      for (const [name, sql] of auditTriggers(this.audit)) if (!names.has(name)) await this.pool.query(sql);
    } catch (e) {
      if (!this._triggerWarned) console.warn(`Audit log triggers not created on ${this.audit} (${e.code || e.message}). Run scripts/db-audit-log.sql as the MySQL admin.`);
      this._triggerWarned = true;
    }
  }

  // ---------- Audit log (add and read only) ----------
  async addAudit({ username = '', computer = '', category = '', action = '', record = '', details = '', result = 'Success' } = {}) {
    const cut = (v, n) => String(v == null ? '' : v).slice(0, n);
    await this.run(
      `INSERT INTO ${this.audit} (logged_at, username, computer, category, action, record, details, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [now(), cut(username, 100), cut(computer, 100), cut(category, 30), cut(action, 60), cut(record, 200), cut(details, 4000), result === 'Failed' ? 'Failed' : 'Success']
    );
  }

  // Removes entries older than one year, one date at a time, oldest date first: each day the
  // date that has just passed one year drops off. Returns the dates removed ('YYYY-MM-DD').
  async purgeAudit() {
    const d = new Date();
    d.setDate(d.getDate() - AUDIT_KEEP_DAYS);
    const keepFrom = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // first date kept
    const removed = [];
    for (let i = 0; i < AUDIT_KEEP_DAYS + 31; i++) {
      const row = await this.get(`SELECT DATE_FORMAT(MIN(logged_at), '%Y-%m-%d') AS day FROM ${this.audit} WHERE logged_at < ?`, [`${keepFrom} 00:00:00`]);
      if (!row || !row.day) break;
      await this.run(`DELETE FROM ${this.audit} WHERE logged_at >= ? AND logged_at < ? AND logged_at < ?`,
        [`${row.day} 00:00:00`, `${addDays(row.day, 1)} 00:00:00`, `${keepFrom} 00:00:00`]);
      removed.push(row.day);
    }
    return removed;
  }

  // Newest first. from / to: 'YYYY-MM-DD' (inclusive); at most AUDIT_LIST_LIMIT rows.
  async auditLog({ from = '', to = '', username = '', category = '', result = '', q = '' } = {}) {
    const where = [];
    const params = [];
    if (isValidDate(from)) {
      where.push('logged_at >= ?');
      params.push(`${from} 00:00:00`);
    }
    if (isValidDate(to)) {
      where.push('logged_at <= ?');
      params.push(`${to} 23:59:59`);
    }
    // Login / section / result: one value or a list (any of them); empty = all.
    const anyOf = (col, v, allowed = null) => {
      const list = (Array.isArray(v) ? v : [v]).map(clean).filter(Boolean).filter((x) => !allowed || allowed.includes(x)).slice(0, 200);
      if (!list.length) return;
      where.push(`${col} IN (${list.map(() => '?').join(', ')})`);
      params.push(...list);
    };
    anyOf('username', username);
    anyOf('category', category);
    anyOf('result', result, ['Success', 'Failed']);
    if (clean(q)) {
      where.push('(username LIKE ? OR computer LIKE ? OR action LIKE ? OR record LIKE ? OR details LIKE ?)');
      const p = likeParam(clean(q));
      params.push(p, p, p, p, p);
    }
    const sqlWhere = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [rows, count, users, oldest] = await Promise.all([
      this.all(`SELECT id, logged_at, username, computer, category, action, record, details, result FROM ${this.audit} ${sqlWhere}
                ORDER BY logged_at DESC, id DESC LIMIT ${AUDIT_LIST_LIMIT}`, params),
      this.get(`SELECT COUNT(*) AS n FROM ${this.audit} ${sqlWhere}`, params),
      this.all(`SELECT DISTINCT username FROM ${this.audit} WHERE username <> '' ORDER BY username`),
      this.get(`SELECT MIN(logged_at) AS at FROM ${this.audit}`),
    ]);
    return { rows, total: Number(count.n) || 0, limit: AUDIT_LIST_LIMIT, users: users.map((u) => u.username), oldest: oldest.at, keepDays: AUDIT_KEEP_DAYS };
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
      `INSERT INTO ${this.t.settings} (\`key\`, \`value\`, updated_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = VALUES(updated_at)`,
      [key, String(value), now()],
      cx
    );
  }

  async getSettings() {
    const [user, rows] = await Promise.all([
      this.get(`SELECT username FROM ${this.t.users} ORDER BY id LIMIT 1`),
      this.all(`SELECT \`key\`, \`value\` FROM ${this.t.settings} WHERE \`key\` IN ('default_duration', 'default_credentials', 'return_by_other')`),
    ]);
    const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      defaultDuration: Number(s.default_duration) || 14,
      username: user ? user.username : '',
      defaultCredentials: s.default_credentials === '1',
      // May a book issued to one person be returned under another person's name? (Settings page)
      allowOtherReturner: s.return_by_other !== '0',
    };
  }

  async setDefaultDuration(days) {
    check(checks.duration(days));
    await this._setSetting('default_duration', Number(days));
    return this.getSettings();
  }

  // ---------- Logo (Settings → Logo): shown on the sign-in page and in the sidebar ----------
  // Kept as a PNG / JPEG data URL in the settings table, so every PC on this library shows it.
  async getLogo() {
    return (await this.getSetting('logo')) || null;
  }

  async setLogo(dataUrl) {
    if (dataUrl == null || dataUrl === '') {
      await this.run(`DELETE FROM ${this.t.settings} WHERE \`key\` = 'logo'`);
      return null;
    }
    const v = String(dataUrl);
    check(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(v) ? null : 'The logo must be a PNG or JPEG image.');
    check(v.length <= 2 * 1024 * 1024 ? null : 'The logo image is too large. Use a smaller picture.');
    await this._setSetting('logo', v);
    return v;
  }

  async setAllowOtherReturner(allow) {
    await this._setSetting('return_by_other', allow ? '1' : '0');
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

  // The username must match exactly, capitals included (the column itself compares without case).
  async verifyLogin(username, password) {
    const user = await this.get(`SELECT ${USER_COLS}, password_hash, salt FROM ${this.t.users} WHERE username COLLATE utf8mb4_bin = ?`, [
      clean(username),
    ]);
    if (!user || typeof password !== 'string') return null;
    const a = Buffer.from(hashPassword(password, user.salt), 'hex');
    const b = Buffer.from(user.password_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return userOut(user);
  }

  async getUser(id) {
    const u = await this.get(`SELECT ${USER_COLS} FROM ${this.t.users} WHERE id = ?`, [Number(id)]);
    return u ? userOut(u) : null;
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
      await this.run(`UPDATE ${this.t.users} SET username = ?, password_hash = ?, salt = ?, updated_at = ? WHERE id = ?`, [username, hash, salt, now(), userId], cx);
      if (newPassword) await this._setSetting('default_credentials', '0', cx);
    });
    return { id: userId, username };
  }

  // ---------- User management ----------
  async listUsers() {
    const rows = await this.all(`SELECT ${USER_COLS} FROM ${this.t.users} ORDER BY username`);
    return rows.map(userOut);
  }

  async createUser({ username, password, active = true, role, perms } = {}) {
    const name = username == null ? '' : String(username).trim();
    check(checks.username(name), password ? checks.newPassword(password) : 'Password is required.');
    const list = wantedPerms({ perms, role }, access.ALL);
    check(list.length ? null : 'Choose at least one screen this user can open.');
    if (await this.get(`SELECT id FROM ${this.t.users} WHERE username = ?`, [name])) {
      throw new UserError('That username is already in use.');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const res = await this.run(
      `INSERT INTO ${this.t.users} (username, password_hash, salt, active, role, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, hashPassword(password, salt), salt, active === false ? 0 : 1, roleFor(list), list.join(','), now(), now()]
    );
    return { id: res.insertId, username: name, active: active !== false, role: roleFor(list), perms: list };
  }

  async updateUser(id, { username, password, active, role, perms } = {}, currentUserId = null) {
    const user = await this.get(`SELECT ${USER_COLS}, password_hash, salt FROM ${this.t.users} WHERE id = ?`, [Number(id)]);
    if (!user) throw new UserError('This user no longer exists.');
    const isActive = active == null ? user.active === 1 : active !== false;
    if (!isActive && user.id === currentUserId) throw new UserError('You cannot make the account you are signed in with inactive.');
    const list = wantedPerms({ perms, role }, access.permsOf(user));
    check(list.length ? null : 'Choose at least one screen this user can open.');
    if (!list.includes('settings') && user.id === currentUserId) {
      throw new UserError('You cannot take Settings access away from the account you are signed in with.');
    }
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
        `UPDATE ${this.t.users} SET username = ?, password_hash = ?, salt = ?, active = ?, role = ?, permissions = ?, updated_at = ? WHERE id = ?`,
        [name, hash, salt, isActive ? 1 : 0, roleFor(list), list.join(','), now(), user.id],
        cx
      );
      if (password && user.username.toLowerCase() === DEFAULT_USERNAME) await this._setSetting('default_credentials', '0', cx);
    });
    return { id: user.id, username: name, active: isActive, role: roleFor(list), perms: list };
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
    const all = await this.listUsers();
    const users = all.filter((u) => wanted.includes(u.id));
    if (!users.length) throw new UserError('The selected users no longer exist.');
    if (users.length >= all.length) throw new UserError('At least one user account must remain. Leave one account unselected.');
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
    return `SELECT b.id, b.book_no, b.name, b.author, b.publisher, b.category, b.lf, b.location, b.rack, b.created_by, b.updated_by, b.created_at, b.updated_at,
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
      where.push('(b.book_no LIKE ? OR b.name LIKE ? OR b.lf LIKE ? OR b.category LIKE ? OR b.location LIKE ? OR b.created_by LIKE ? OR b.updated_by LIKE ?)');
      const p = likeParam(q);
      params.push(p, p, p, p, p, p, p);
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
    return byBarcode(await this.all(`${this._bookSelect()} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.id DESC`, params));
  }

  async getBook(id) {
    return this.get(`${this._bookSelect()} WHERE b.id = ?`, [Number(id)]);
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

  // savedBy / importedBy: the signed-in account's username (set by server/api.js from the session, never by the app).
  async saveBook(input = {}) {
    const by = input.savedBy ? clean(input.savedBy) : null;
    const book = {
      id: input.id ? Number(input.id) : null,
      book_no: bookValue(input.book_no),
      name: bookValue(input.name),
      lf: bookValue(input.lf),
      category: bookValue(input.category),
      location: bookValue(input.location),
      rack: bookValue(input.rack),
    };
    check(
      checks.bookNo(book.book_no),
      checks.category(book.category)
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
          `UPDATE ${this.t.books} SET book_no = ?, name = ?, lf = ?, category = ?, location = ?, rack = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
          [book.book_no, book.name, book.lf, book.category, book.location, book.rack, by, now(), book.id],
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
        `INSERT INTO ${this.t.books} (book_no, name, author, lf, category, location, rack, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [book.book_no, book.name, book.lf, book.category, book.location, book.rack, by, by, stamp, stamp],
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
        book_no: bookValue(v.book_no),
        lf: bookValue(v.lf),
        category: bookValue(v.category),
        name: bookValue(v.name),
        location: bookValue(v.location),
        rack: bookValue(v.rack),
      };
      const messages = [
        ...(Array.isArray(r.issues) ? r.issues : []),
        checks.bookNo(book.book_no),
        checks.category(book.category)
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

  async importBooks(rows, importedBy = null) {
    const by = importedBy ? clean(importedBy) : null;
    const { ready, errors } = await this.validateImport(rows);
    if (!ready.length && !errors.length) throw new UserError('There are no rows to import.');
    if (ready.length) {
      const stamp = now();
      await this._transaction(async (cx) => {
        for (const b of ready) {
          await this.run(
            `INSERT INTO ${this.t.books} (book_no, name, author, lf, category, location, rack, created_by, updated_by, created_at, updated_at)
             VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`,
            [b.book_no, b.name, b.lf, b.category, b.location, b.rack, by, by, stamp, stamp],
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

  // Barcode No suggestions while typing on the Issue / Return pages: books whose Barcode No
  // contains the typed text, those starting with it first. status 'Available' (Issue page) or
  // 'Issued' (Return page) leaves out books that cannot be issued / returned.
  async suggestBooks({ query = '', status = '', limit = 8 } = {}) {
    const q = clean(query);
    if (!q) return [];
    const n = Math.min(Math.max(Number(limit) || 8, 1), 20);
    const where = ['b.book_no LIKE ?'];
    if (status === 'Available') where.push('i.id IS NULL');
    if (status === 'Issued') where.push('i.id IS NOT NULL');
    const prefix = `${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    return this.all(
      `SELECT b.book_no, b.name, i.issue_user, i.due_date, CASE WHEN i.id IS NULL THEN 'Available' ELSE 'Issued' END AS status
       FROM ${this.t.books} b LEFT JOIN ${this.t.issues} i ON i.book_id = b.id AND i.return_date IS NULL
       WHERE ${where.join(' AND ')}
       ORDER BY (b.book_no LIKE ?) DESC, CHAR_LENGTH(b.book_no), b.book_no LIMIT ${n}`,
      [likeParam(q), prefix]
    );
  }

  // ---------- Circulation ----------
  async lookupForCirculation(bookNo) {
    const book = await this.getBookByNumber(bookNo);
    if (!book) return { book: null };
    const t = today();
    const overdueDays = book.issue_id && book.due_date < t ? daysBetween(book.due_date, t) : 0;
    return { book, overdueDays, today: t };
  }

  // issuedBy / returnedBy: the signed-in account's username (set by server/api.js from the session, never by the app).
  async issueBook({ bookNo, userName, rank = '', number = '', dept = '', duration, remarks, issuedBy = null } = {}) {
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
      const at = now();
      const issueDate = at.slice(0, 10);
      const dueDate = addDays(issueDate, days);
      const res = await this.run(
        `INSERT INTO ${this.t.issues} (book_id, book_no, book_name, issue_user, issue_rank, issue_number, issue_dept, issue_date,
           issue_time, duration, due_date, issue_remarks, issued_by, issued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [book.id, book.book_no, book.name, clean(userName), clean(rank), clean(number), clean(dept), issueDate, at.slice(11), days, dueDate,
          clean(remarks), issuedBy ? clean(issuedBy) : null, at],
        cx
      );
      return this.get(`SELECT ${ISSUE_COLS} FROM ${this.t.issues} WHERE id = ?`, [res.insertId], cx);
    });
  }

  async returnBook({ bookNo, userName, remarks, returnedBy = null } = {}) {
    const at = now();
    const returnDate = at.slice(0, 10);
    return this._transaction(async (cx) => {
      // Read and lock the book (and its open issue) in one query, so two librarians cannot act on it at once.
      const book = clean(bookNo) ? await this.get(`${this._bookSelect()} WHERE b.book_no = ? FOR UPDATE`, [clean(bookNo)], cx) : null;
      if (!book) throw new UserError(`No book found with Barcode No "${clean(bookNo)}".`);
      if (!book.issue_id) throw new UserError(`Book "${book.book_no}" is not currently issued.`);
      check(checks.person(userName, 'Name'), checks.remarks(remarks));
      if ((await this.getSetting('return_by_other', cx)) === '0' && clean(userName).toLowerCase() !== clean(book.issue_user).toLowerCase()) {
        throw new UserError(`This book was issued to ${book.issue_user}. Only ${book.issue_user} can return it (Settings → Borrower on return).`);
      }
      const late = returnDate > book.due_date ? 1 : 0;
      await this.run(
        `UPDATE ${this.t.issues} SET return_date = ?, return_time = ?, return_user = ?, return_remarks = ?, returned_by = ?,
               returned_late = ?, returned_at = ?
          WHERE id = ?`,
        [returnDate, at.slice(11), clean(userName), clean(remarks), returnedBy ? clean(returnedBy) : null, late, at, book.issue_id],
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

  // Borrowers seen before, one per Number (their latest issue): picking a Number on the Issue page
  // fills in Name, Rank and Dept.
  async borrowerDetails() {
    return this.all(
      `SELECT i.issue_number AS number, i.issue_user AS name, i.issue_rank AS \`rank\`, i.issue_dept AS dept
       FROM ${this.t.issues} i
       JOIN (SELECT MAX(id) AS id FROM ${this.t.issues} WHERE issue_number <> '' GROUP BY issue_number) latest ON latest.id = i.id
       ORDER BY i.issue_number`
    );
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
    if (kind === 'issue') return this.all(`SELECT ${ISSUE_COLS} FROM ${this.t.issues} WHERE issue_date = ? ORDER BY issued_at DESC, id DESC`, [t]);
    return this.all(`SELECT ${ISSUE_COLS} FROM ${this.t.issues} WHERE return_date = ? ORDER BY returned_at DESC, id DESC`, [t]);
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
    return { today: t, total, issued, available: total - issued, overdue: Number(counts.overdue), dueSoon: byBarcode(dueSoon), recent };
  }

  // ---------- Reports ----------
  async overdueList(asOn = today(), { userName = '', bookNo = '', q = '' } = {}) {
    asOn = asOn || today();
    if (!isValidDate(asOn)) throw new UserError('Please choose a valid "As on" date.');
    const where = ['issue_date <= ?', 'due_date < ?', '(return_date IS NULL OR return_date > ?)'];
    const params = [asOn, asOn, asOn];
    this._textFilters(where, params, { userName, bookNo, q });
    // Latest action at top: newest issue date-time first.
    return this.all(
      `SELECT book_no, book_name, issue_user, issue_rank, issue_number, issue_dept, issue_date,
              IFNULL(issue_time, TIME(issued_at)) AS issue_time, due_date, return_date, issue_remarks, issued_by,
              DATEDIFF(?, due_date) AS days_overdue
         FROM ${this.t.issues}
        WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(issued_at, TIMESTAMP(issue_date, IFNULL(issue_time, '00:00:00'))) DESC, id DESC`,
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
      const cols = ['book_no', 'book_name', 'issue_user', "IFNULL(return_user, '')", 'issue_remarks', "IFNULL(return_remarks, '')",
        "IFNULL(issued_by, '')", "IFNULL(returned_by, '')"];
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
    // Latest action at top: each row's return time if returned, otherwise its issue time, newest first.
    const order = `COALESCE(returned_at, TIMESTAMP(return_date, IFNULL(return_time, '00:00:00')), issued_at,
                    TIMESTAMP(issue_date, IFNULL(issue_time, '00:00:00'))) DESC, id DESC`;
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
      books: ['id', 'book_no', 'name', 'author', 'publisher', 'category', 'lf', 'location', 'rack', 'created_by', 'updated_by', 'created_at', 'updated_at'],
      issues: ['id', 'book_id', 'book_no', 'book_name', 'issue_user', 'issue_rank', 'issue_number', 'issue_dept', 'issue_date', 'issue_time',
        'duration', 'due_date', 'issue_remarks', 'issued_by', 'return_date', 'return_time', 'return_user', 'return_remarks', 'returned_by',
        'returned_late', 'issued_at', 'returned_at'],
      users: ['id', 'username', 'password_hash', 'salt', 'active', 'role', 'permissions', 'created_at', 'updated_at'],
      settings: ['key', 'value', 'updated_at'],
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
    for (const sql of fillTimes(this.t.issues)) await this.run(sql); // backups from before issue_time / return_time
    return true;
  }
}

// Values for columns that older backups do not have.
function defaults(table, col) {
  if (['created_at', 'updated_at', 'issued_at'].includes(col)) return now();
  if (col === 'active') return 1;
  if (col === 'role') return 'librarian';
  if (col === 'returned_late') return 0;
  if (['return_date', 'return_user', 'return_remarks', 'returned_at', 'book_id', 'permissions', 'issue_time', 'return_time',
    'issued_by', 'returned_by', 'created_by', 'updated_by'].includes(col)) return null;
  return '';
}

module.exports = { MySqlLibraryDB, UserError, DEFAULT_USERNAME };
