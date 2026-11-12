// Audit log entries: what each library method did, in plain words, for the Audit Log page.
// Used by server/api.js, which writes one entry per change (and per failed attempt) with the
// signed-in account from the session. Reads (searches, lists, reports on screen) are not logged.

const { display } = require('../src/dates');
const { access } = require('../renderer/rules');

const BOOK_FIELDS = [
  ['book_no', 'Barcode No'],
  ['name', 'Description'],
  ['lf', 'LF'],
  ['category', 'CAT'],
  ['location', 'LOC'],
  ['rack', 'Rack'],
];

const txt = (v) => (v == null ? '' : String(v).trim());
const shown = (v) => (txt(v) === '' ? '(blank)' : `"${txt(v)}"`);
const yesNo = (b) => (b ? 'Yes' : 'No');
const permLabels = (perms) => {
  const list = access.normalizePerms(perms || []);
  const preset = access.accessLabel(list);
  return preset !== 'Custom' ? preset : list.map((k) => (access.PERMISSIONS.find((p) => p.key === k) || { label: k }).label).join(', ') || 'No access';
};

function bookSummary(b) {
  return BOOK_FIELDS.filter(([k]) => k !== 'book_no' && txt(b[k]))
    .map(([k, label]) => `${label}: ${txt(b[k])}`)
    .join(' | ');
}

function bookChanges(before, after) {
  const changed = BOOK_FIELDS.filter(([k]) => txt(before[k]) !== txt(after[k])).map(
    ([k, label]) => `${label}: ${shown(before[k])} → ${shown(after[k])}`
  );
  return changed.length ? changed.join(' | ') : 'Saved with no changes';
}

function borrower(r) {
  const extra = [r.issue_rank, r.issue_number, r.issue_dept].map(txt).filter(Boolean);
  return `${txt(r.issue_user)}${extra.length ? ` (${extra.join(', ')})` : ''}`;
}

// Events the app reports itself (things done on the PC, not in the database). The account is
// always the signed-in one; only these kinds exist, and their text is built here.
const EVENTS = {
  settings_opened: { category: 'Settings', action: 'Settings opened' },
  settings_unlock_failed: { category: 'Settings', action: 'Settings unlock', failed: true, details: () => 'Wrong Settings password' },
  report_excel: { category: 'Reports', action: 'Report exported to Excel', record: (d) => d.title, details: (d) => d.filters },
  report_pdf: { category: 'Reports', action: 'Report exported to PDF', record: (d) => d.title, details: (d) => d.filters },
  report_print: { category: 'Reports', action: 'Report printed', record: (d) => d.title, details: (d) => d.filters },
  audit_excel: { category: 'Audit Log', action: 'Audit log exported to Excel', details: (d) => d.filters },
  backup_saved: { category: 'Backup', action: 'Backup saved', record: (d) => d.file },
  auto_backup_made: { category: 'Backup', action: 'Automatic backup made', record: (d) => d.file },
  auto_backup_changed: {
    category: 'Backup',
    action: 'Automatic backup settings changed',
    details: (d) => `Enabled: ${yesNo(d.enabled)} | Keep: ${txt(d.keep)} backups${d.folder ? ` | Folder: ${txt(d.folder)}` : ''}`,
  },
  db_connection_changed: { category: 'Settings', action: 'Database connection changed', details: (d) => d.details },
};

// method -> { category, action (or action(args)), describe(args, result, before) -> { record, details } }
const METHODS = {
  login: {
    category: 'Sign-in',
    action: 'Signed in',
    failAction: 'Sign-in failed',
    record: (args) => txt((args[0] || {}).username),
  },
  settingsLogin: { category: 'Sign-in', action: 'Settings opened with Settings password', failAction: 'Wrong Settings password' },
  setup: { category: 'Users', action: 'First account created', record: (args, res) => (res ? res.user.username : txt((args[0] || {}).username)) },
  logout: { category: 'Sign-in', action: (args) => (args[0] === 'idle' ? 'Signed out automatically (1 hour idle)' : 'Signed out') },
  verifyPassword: { category: 'Settings', action: 'Password confirmed', failAction: 'Wrong password' },
  changeCredentials: {
    category: 'Users',
    action: 'Own sign-in changed',
    record: (args, res, before) => (res ? res.user.username : before),
    details: (args, res, before) => {
      const p = args[0] || {};
      const parts = [];
      if (res && res.user.username !== before) parts.push(`Username: "${before}" → "${res.user.username}"`);
      if (p.newPassword) parts.push('Password changed');
      return parts.join(' | ') || 'No changes';
    },
  },
  createUser: {
    category: 'Users',
    action: 'User created',
    record: (args, res) => (res ? res.username : txt((args[0] || {}).username)),
    details: (args, res) => (res ? `Access: ${permLabels(res.perms)} | Active: ${yesNo(res.active)}` : ''),
  },
  updateUser: {
    category: 'Users',
    action: 'User changed',
    record: (args, res, before) => (res ? res.username : before ? before.username : `id ${args[0]}`),
    details: (args, res, before) => {
      if (!res || !before) return '';
      const parts = [];
      if (before.username !== res.username) parts.push(`Username: "${before.username}" → "${res.username}"`);
      if (before.active !== res.active) parts.push(`Active: ${yesNo(before.active)} → ${yesNo(res.active)}`);
      if (permLabels(before.perms) !== permLabels(res.perms)) parts.push(`Access: ${permLabels(before.perms)} → ${permLabels(res.perms)}`);
      if ((args[1] || {}).password) parts.push('Password reset');
      return parts.join(' | ') || 'Saved with no changes';
    },
  },
  deleteUser: { category: 'Users', action: 'User deleted', record: (args, res, before) => (before ? before.join(', ') : `id ${args[0]}`) },
  deleteUsers: {
    category: 'Users',
    action: 'Users deleted',
    record: (args, res, before) => (before ? before.join(', ') : ''),
    details: (args, res) => (res != null ? `${res} account(s) deleted` : ''),
  },
  setDefaultDuration: {
    category: 'Settings',
    action: 'Default loan duration changed',
    details: (args, res, before) => `${before ? before.defaultDuration : '?'} days → ${res ? res.defaultDuration : txt(args[0])} days`,
  },
  setAllowOtherReturner: {
    category: 'Settings',
    action: 'Return rule changed',
    details: (args) => (args[0] ? 'Anyone may return a book' : 'Only the borrower may return a book'),
  },
  setLogo: { category: 'Settings', action: (args) => (args[0] ? 'Logo changed' : 'Logo removed') },
  saveBook: {
    category: 'Books',
    action: (args) => ((args[0] || {}).id ? 'Book edited' : 'Book added'),
    record: (args, res, before) => txt((res || args[0] || {}).book_no) || (before ? before.book_no : ''),
    details: (args, res, before) => (before ? bookChanges(before, res || args[0] || {}) : bookSummary(res || args[0] || {})),
  },
  importBooks: {
    category: 'Books',
    action: 'Books imported from Excel',
    details: (args, res) => (res ? `${res.imported} book(s) added, ${res.skipped} row(s) skipped` : `${(args[0] || []).length} row(s) in the file`),
  },
  deleteBook: {
    category: 'Books',
    action: 'Book deleted',
    record: (args, res, before) => (before ? before.book_no : `id ${args[0]}`),
    details: (args, res, before) => (before ? bookSummary(before) : ''),
  },
  issueBook: {
    category: 'Circulation',
    action: 'Book issued',
    record: (args, res) => txt((res || args[0] || {}).book_no || (args[0] || {}).bookNo),
    details: (args, res) => {
      if (!res) return `To: ${txt((args[0] || {}).userName)}`;
      const parts = [`To: ${borrower(res)}`, `For ${res.duration} days`, `Due: ${display(res.due_date)}`];
      if (txt(res.issue_remarks)) parts.push(`Remarks: ${txt(res.issue_remarks)}`);
      return parts.join(' | ');
    },
  },
  returnBook: {
    category: 'Circulation',
    action: 'Book returned',
    record: (args, res) => txt((res || {}).book_no || (args[0] || {}).bookNo),
    details: (args, res) => {
      if (!res) return `By: ${txt((args[0] || {}).userName)}`;
      const parts = [`Returned by: ${txt(res.return_user)}`, `Issued to: ${borrower(res)}`, res.returned_late ? `Late (due ${display(res.due_date)})` : 'On time'];
      if (txt(res.return_remarks)) parts.push(`Remarks: ${txt(res.return_remarks)}`);
      return parts.join(' | ');
    },
  },
  replaceData: {
    category: 'Backup',
    action: 'Backup restored (all library data replaced)',
    details: (args) => {
      const d = args[0] || {};
      const n = (k) => (Array.isArray(d[k]) ? d[k].length : 0);
      return `From the backup: ${n('books')} books, ${n('issues')} issue records, ${n('users')} users`;
    },
  },
};

// What to read before the method runs, for "old → new" details. Errors here never stop the method.
async function before(method, db, args, session) {
  switch (method) {
    case 'saveBook':
      return (args[0] || {}).id ? db.getBook(args[0].id) : null;
    case 'deleteBook':
      return db.getBook(args[0]);
    case 'updateUser':
      return db.getUser(args[0]);
    case 'deleteUser': {
      const u = await db.getUser(args[0]);
      return u ? [u.username] : null;
    }
    case 'deleteUsers': {
      const users = await Promise.all((Array.isArray(args[0]) ? args[0] : []).map((id) => db.getUser(id)));
      return users.filter(Boolean).map((u) => u.username);
    }
    case 'setDefaultDuration':
      return db.getSettings();
    case 'changeCredentials':
      return session ? session.username : '';
    default:
      return null;
  }
}

// The entry for one finished (or failed: error set) call, or null when it is not logged.
function entry(method, args, { result, error, before: prev } = {}) {
  const spec = METHODS[method];
  if (!spec) return null;
  const failed = !!error;
  if (method === 'verifyPassword' && !failed) return null; // only wrong guesses matter
  const action = failed && spec.failAction ? spec.failAction : typeof spec.action === 'function' ? spec.action(args) : spec.action;
  const safe = (fn) => {
    try {
      return fn ? txt(fn(args, result, prev)) : '';
    } catch {
      return '';
    }
  };
  const details = safe(spec.details);
  return {
    category: spec.category,
    action,
    record: safe(spec.record),
    details: failed ? [error, details].filter(Boolean).join(' | ') : details,
    result: failed ? 'Failed' : 'Success',
  };
}

// An event reported by the app (logEvent), or null for an unknown kind.
function eventEntry(kind, data) {
  const spec = Object.prototype.hasOwnProperty.call(EVENTS, kind) ? EVENTS[kind] : null;
  if (!spec) return null;
  const d = data && typeof data === 'object' ? data : {};
  const safe = (fn) => {
    try {
      return fn ? txt(fn(d)).slice(0, 1000) : '';
    } catch {
      return '';
    }
  };
  return { category: spec.category, action: spec.action, record: safe(spec.record), details: safe(spec.details), result: spec.failed ? 'Failed' : 'Success' };
}

const CATEGORIES = ['Sign-in', 'Books', 'Circulation', 'Users', 'Settings', 'Reports', 'Backup', 'Audit Log'];

module.exports = { entry, eventEntry, before, logged: (m) => Object.prototype.hasOwnProperty.call(METHODS, m), CATEGORIES };
