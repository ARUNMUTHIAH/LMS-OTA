// Backup files as a MySQL dump (.sql), laid out like a phpMyAdmin export: CREATE TABLE, INSERT INTO,
// indexes, AUTO_INCREMENT and foreign keys. A backup holds both editions' tables (prefix 'technical_' = technical_books, ...,
// 'general_' = general_books, ...), so either app's backup is one file of the whole database. It can be
// imported in phpMyAdmin, or restored by either app, which takes only its own four tables from it.

const { UserError } = require('./database');

const TABLES = ['books', 'issues', 'settings', 'users']; // dump order, as phpMyAdmin lists them
const MAX_INSERT = 50000; // bytes per INSERT statement before a new one starts
const C = 'COLLATE utf8mb4_unicode_ci';

const COLUMNS = {
  books: [
    ['id', 'int UNSIGNED NOT NULL'],
    ['book_no', `varchar(50) ${C} NOT NULL`],
    ['name', `varchar(200) ${C} NOT NULL`],
    ['author', `varchar(150) ${C} NOT NULL DEFAULT ''`],
    ['publisher', `varchar(150) ${C} NOT NULL DEFAULT ''`],
    ['category', `varchar(100) ${C} NOT NULL DEFAULT ''`],
    ['lf', `varchar(30) ${C} NOT NULL DEFAULT ''`],
    ['location', `varchar(30) ${C} NOT NULL DEFAULT ''`],
    ['rack', `varchar(30) ${C} NOT NULL DEFAULT ''`],
    ['created_by', `varchar(100) ${C} DEFAULT NULL`],
    ['updated_by', `varchar(100) ${C} DEFAULT NULL`],
    ['created_at', 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP'],
    ['updated_at', 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
  ],
  issues: [
    ['id', 'int UNSIGNED NOT NULL'],
    ['book_id', 'int UNSIGNED DEFAULT NULL'],
    ['book_no', `varchar(50) ${C} NOT NULL`],
    ['book_name', `varchar(200) ${C} NOT NULL`],
    ['issue_user', `varchar(100) ${C} NOT NULL`],
    ['issue_rank', `varchar(50) ${C} NOT NULL DEFAULT ''`],
    ['issue_number', `varchar(50) ${C} NOT NULL DEFAULT ''`],
    ['issue_dept', `varchar(50) ${C} NOT NULL DEFAULT ''`],
    ['issue_date', 'date NOT NULL'],
    ['issue_time', 'time DEFAULT NULL'],
    ['duration', 'int NOT NULL'],
    ['due_date', 'date NOT NULL'],
    ['issue_remarks', `varchar(250) ${C} NOT NULL DEFAULT ''`],
    ['issued_by', `varchar(100) ${C} DEFAULT NULL`],
    ['return_date', 'date DEFAULT NULL'],
    ['return_time', 'time DEFAULT NULL'],
    ['return_user', `varchar(100) ${C} DEFAULT NULL`],
    ['return_remarks', `varchar(250) ${C} DEFAULT NULL`],
    ['returned_by', `varchar(100) ${C} DEFAULT NULL`],
    ['returned_late', "tinyint(1) NOT NULL DEFAULT '0'"],
    ['issued_at', 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP'],
    ['returned_at', 'datetime DEFAULT NULL'],
  ],
  settings: [
    ['key', `varchar(50) ${C} NOT NULL`],
    ['value', `mediumtext ${C} NOT NULL`],
    ['updated_at', 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
  ],
  users: [
    ['id', 'int UNSIGNED NOT NULL'],
    ['username', `varchar(30) ${C} NOT NULL`],
    ['password_hash', `char(128) ${C} NOT NULL`],
    ['salt', `char(32) ${C} NOT NULL`],
    ['active', "tinyint(1) NOT NULL DEFAULT '1'"],
    ['role', `varchar(20) ${C} NOT NULL DEFAULT 'librarian'`],
    ['permissions', `varchar(255) ${C} DEFAULT NULL`],
    ['created_at', 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP'],
    ['updated_at', 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
  ],
};

const INDEXES = (p) => ({
  books: ['ADD PRIMARY KEY (`id`)', `ADD UNIQUE KEY \`uq_${p}books_book_no\` (\`book_no\`)`],
  issues: ['ADD PRIMARY KEY (`id`)', `ADD KEY \`idx_${p}issues_book\` (\`book_id\`)`, `ADD KEY \`idx_${p}issues_open\` (\`return_date\`)`],
  settings: ['ADD PRIMARY KEY (`key`)'],
  users: ['ADD PRIMARY KEY (`id`)', `ADD UNIQUE KEY \`uq_${p}users_username\` (\`username\`)`],
});

const RULE = '-- --------------------------------------------------------';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Nov 03, 2026 at 11:14 AM"
function stamp(d) {
  const h = d.getHours() % 12 || 12;
  const pad = (n) => String(n).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${pad(d.getDate())}, ${d.getFullYear()} at ${pad(h)}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  // eslint-disable-next-line no-control-regex -- NUL and Ctrl+Z are escaped too, as MySQL does
  const s = String(v).replace(/[\0\n\r\x1a'\\]/g, (c) => ({ '\0': '\\0', '\n': '\\n', '\r': '\\r', '\x1a': '\\Z', "'": "\\'", '\\': '\\\\' })[c]);
  return `'${s}'`;
}

// sets: [{ prefix, data }] with data = { books, issues, users, settings } (rows as exportData gives
// them), one per edition in the file. Tables are listed by full name, as phpMyAdmin does.
// Returns the dump text.
function toSqlDump(sets, { database = '', title = 'Library' } = {}) {
  const all = sets
    .flatMap(({ prefix, data }) => TABLES.map((name) => ({ prefix, name, table: prefix + name, rows: (data && data[name]) || [] })))
    .sort((a, b) => (a.table < b.table ? -1 : 1));
  const out = [
    `-- ${title} SQL Dump`,
    '--',
    `-- Generation Time: ${stamp(new Date())}`,
    '',
    'SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";',
    'START TRANSACTION;',
    'SET time_zone = "+00:00";',
    '',
    '',
    '/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;',
    '/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;',
    '/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;',
    '/*!40101 SET NAMES utf8mb4 */;',
    '',
  ];
  if (database) out.push('--', `-- Database: \`${database}\``, '--', '');

  for (const { name, table, rows } of all) {
    const cols = COLUMNS[name];
    out.push(RULE, '', '--', `-- Table structure for table \`${table}\``, '--', '');
    out.push(`CREATE TABLE \`${table}\` (`);
    out.push(cols.map(([c, def]) => `  \`${c}\` ${def}`).join(',\n'));
    out.push(') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;', '');

    if (!rows.length) continue;
    out.push('--', `-- Dumping data for table \`${table}\``, '--', '');
    const head = `INSERT INTO \`${table}\` (${cols.map(([c]) => `\`${c}\``).join(', ')}) VALUES\n`;
    let chunk = [];
    let size = 0;
    const flush = () => {
      out.push(head + chunk.join(',\n') + ';');
      chunk = [];
      size = 0;
    };
    for (const row of rows) {
      const tuple = `(${cols.map(([c]) => sqlValue(row[c])).join(', ')})`;
      if (chunk.length && size + tuple.length > MAX_INSERT) flush();
      chunk.push(tuple);
      size += tuple.length + 2;
    }
    flush();
    out.push('');
  }

  out.push('--', '-- Indexes for dumped tables', '--');
  for (const { prefix, name, table } of all) {
    out.push('', '--', `-- Indexes for table \`${table}\``, '--', `ALTER TABLE \`${table}\``);
    out.push(INDEXES(prefix)[name].map((s) => `  ${s}`).join(',\n') + ';');
  }

  out.push('', '--', '-- AUTO_INCREMENT for dumped tables', '--');
  for (const { table, rows } of all.filter((x) => x.name !== 'settings')) {
    const next = Math.max(0, ...rows.map((r) => Number(r.id) || 0)) + 1;
    out.push('', '--', `-- AUTO_INCREMENT for table \`${table}\``, '--', `ALTER TABLE \`${table}\``);
    out.push(`  MODIFY \`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=${next};`);
  }

  out.push('', '--', '-- Constraints for dumped tables', '--');
  for (const { prefix, table } of all.filter((x) => x.name === 'issues')) {
    out.push('', '--', `-- Constraints for table \`${table}\``, '--', `ALTER TABLE \`${table}\``);
    out.push(`  ADD CONSTRAINT \`fk_${prefix}issues_book\` FOREIGN KEY (\`book_id\`) REFERENCES \`${prefix}books\` (\`id\`) ON DELETE SET NULL;`);
  }
  out.push('COMMIT;', '');
  out.push(
    '/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;',
    '/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;',
    '/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;',
    ''
  );
  return out.join('\n');
}

// ---------- Reading a dump back ----------

const UNESCAPE = { 0: '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' };

// Splits the text into statements, skipping comments; quotes and backticks are kept intact.
function statements(text) {
  const list = [];
  let cur = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && text[j] !== c) j += text[j] === '\\' && c !== '`' ? 2 : 1;
      cur += text.slice(i, j + 1);
      i = j + 1;
    } else if ((c === '-' && text[i + 1] === '-' && /\s/.test(text[i + 2] || ' ')) || c === '#') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*' && text[i + 2] !== '!') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else if (c === ';') {
      if (cur.trim()) list.push(cur.trim());
      cur = '';
      i++;
    } else {
      cur += c;
      i++;
    }
  }
  if (cur.trim()) list.push(cur.trim());
  return list;
}

// The value tuples after VALUES: [[v, v, ...], ...] with strings unescaped, NULL as null, numbers as numbers.
function tuples(s) {
  const rows = [];
  let i = 0;
  const n = s.length;
  const fail = () => {
    throw new Error('bad VALUES');
  };
  while (i < n) {
    while (i < n && /[\s,]/.test(s[i])) i++;
    if (i >= n) break;
    if (s[i] !== '(') fail();
    i++;
    const row = [];
    for (;;) {
      while (/\s/.test(s[i])) i++;
      if (s[i] === "'") {
        let v = '';
        i++;
        while (i < n) {
          if (s[i] === '\\') {
            v += UNESCAPE[s[i + 1]] ?? s[i + 1];
            i += 2;
          } else if (s[i] === "'" && s[i + 1] === "'") {
            v += "'";
            i += 2;
          } else if (s[i] === "'") break;
          else v += s[i++];
        }
        if (i >= n) fail();
        i++;
        row.push(v);
      } else {
        const m = /^[^,)\s]+/.exec(s.slice(i, i + 64));
        if (!m) fail();
        const raw = m[0];
        i += raw.length;
        if (/^null$/i.test(raw)) row.push(null);
        else if (/^-?[\d.]+$/.test(raw) && Number.isFinite(Number(raw))) row.push(Number(raw));
        else fail();
      }
      while (/\s/.test(s[i])) i++;
      if (s[i] === ',') i++;
      else if (s[i] === ')') {
        i++;
        break;
      } else fail();
    }
    rows.push(row);
  }
  return rows;
}

// Reads this edition's four tables out of a .sql dump: { books, issues, users, settings }.
// oldPrefix: the table prefix older backups used for this edition (Technical tables had none), tried
// when the file has no tables with `prefix`.
function parseSqlDump(text, { prefix = '', oldPrefix = null } = {}) {
  try {
    return parseTables(text, prefix);
  } catch (e) {
    if (oldPrefix === null || oldPrefix === prefix || !(e instanceof UserError) || !/no table/.test(e.message)) throw e;
    return parseTables(text, oldPrefix);
  }
}

function parseTables(text, prefix) {
  const wanted = Object.fromEntries(TABLES.map((name) => [prefix + name, name]));
  const data = {};
  try {
    for (const st of statements(String(text))) {
      const create = /^CREATE\s+TABLE\s+(IF\sNOT\sEXISTS\s)?\s*`?(\w+)/i.exec(st);
      if (create && wanted[create[2]]) data[wanted[create[2]]] = data[wanted[create[2]]] || [];
      const ins = /^INSERT\s+(IGNORE\s)?\s*INTO\s+`?(\w+)`?\s*\(([^)]*)\)\s*VALUES\s*/i.exec(st);
      if (!ins || !wanted[ins[2]]) continue;
      const cols = ins[3].split(',').map((c) => c.trim().replace(/^`|`$/g, ''));
      const list = (data[wanted[ins[2]]] = data[wanted[ins[2]]] || []);
      for (const vals of tuples(st.slice(ins[0].length))) {
        if (vals.length !== cols.length) throw new Error('column count');
        list.push(Object.fromEntries(cols.map((c, k) => [c, vals[k]])));
      }
    }
  } catch {
    throw new UserError('The selected file is not a valid library backup.');
  }
  const missing = TABLES.filter((name) => !data[name]).map((name) => prefix + name);
  if (missing.length) throw new UserError(`The selected file is not a backup of this library (no table ${missing.join(', ')}).`);
  return data;
}

module.exports = { toSqlDump, parseSqlDump };
