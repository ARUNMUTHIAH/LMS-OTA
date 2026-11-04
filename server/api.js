// The library's callable methods and signed-in sessions, shared by the HTTP server (server/index.js)
// and the desktop app when it connects straight to MySQL (src/direct.js).
//   edition "technical" (version 1) -> tables books, issues, users, settings
//   edition "general"   (version 2) -> tables general_books, general_issues, general_users, general_settings
// Only the methods listed here can be called; the signed-in user always comes from the token.

const crypto = require('crypto');
const { MySqlLibraryDB, UserError, DEFAULT_USERNAME } = require('./library-db');
const { access } = require('../renderer/rules');

const EDITIONS = { technical: '', general: 'general_' };
const USER_RECHECK_MS = 60e3;

// Settings password: opens Settings from the sign-in screen without a librarian account.
// Only its scrypt hash is kept here. To change it: node -e "console.log(require('crypto').scryptSync('NEW', 'lms-settings-v1', 32).toString('hex'))"
const SETTINGS_SALT = 'lms-settings-v1';
const SETTINGS_HASH = '9379048f02b2065d0536b9c6d120ba0de4cd10e9977c424d59458e10ac4ca5b1';
const SETTINGS_USERNAME = 'Settings';
// What a Settings-password session may do: the Settings page and nothing else.
const SETTINGS_ONLY_METHODS = new Set([
  'logout', 'listUsers', 'createUser', 'updateUser', 'deleteUser', 'deleteUsers',
  'getSettings', 'setDefaultDuration', 'setAllowOtherReturner', 'exportData', 'exportAllData', 'replaceData',
]);

// The permission each method needs (any one of those listed; see access in renderer/rules.js).
// Methods not listed here only read the library (book search, lookups, circulation lists) and are
// open to every signed-in account. This is the real check, whatever the app's screens show.
const SETTINGS_METHODS = [
  'changeCredentials', 'listUsers', 'createUser', 'updateUser', 'deleteUser', 'deleteUsers', 'verifyPassword',
  'setDefaultDuration', 'setAllowOtherReturner', 'exportData', 'exportAllData', 'replaceData',
];
const METHOD_PERMS = {
  dashboard: ['dashboard'],
  overdueList: ['dashboard', 'reports'],
  saveBook: ['books_edit'],
  validateImport: ['books_edit'],
  importBooks: ['books_edit'],
  deleteBook: ['books_delete'],
  issueBook: ['issue'],
  returnBook: ['return'],
  ...Object.fromEntries(SETTINGS_METHODS.map((m) => [m, ['settings']])),
};
const NO_ACCESS_MESSAGE = 'Your account does not have access to this. Ask the librarian to give it in Settings → Users.';
const samePerms = (a, b) => (a || []).join(',') === (b || []).join(',');

function isSettingsPassword(password) {
  if (typeof password !== 'string' || !password || password.length > 64) return false;
  const typed = crypto.scryptSync(password, SETTINGS_SALT, 32);
  return crypto.timingSafeEqual(typed, Buffer.from(SETTINGS_HASH, 'hex'));
}

// The session is missing, expired, or its account was deleted / made inactive.
class AuthRequired extends Error {
  constructor() {
    super('Your session has ended. Please sign in again.');
  }
}

function createApi(pool, { sessionHours = 12 } = {}) {
  const dbs = {};
  for (const [edition, prefix] of Object.entries(EDITIONS)) dbs[edition] = new MySqlLibraryDB(pool, prefix);
  const sessions = new Map(); // token -> { edition, userId, username, expires }
  const failures = new Map(); // ip -> { count, until }: at most 10 wrong passwords in 15 minutes

  function newSession(edition, user) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {
      edition,
      userId: user.id,
      username: user.username,
      perms: access.permsOf(user),
      expires: Date.now() + sessionHours * 3600e3,
    });
    return token;
  }

  function dropSessions(edition, userId = null) {
    for (const [k, s] of sessions) if (s.edition === edition && (userId === null || s.userId === userId)) sessions.delete(k);
  }

  // Settings as seen by the signed-in user.
  async function settingsFor(db, s) {
    const st = await db.getSettings();
    return { ...st, username: s.username, defaultCredentials: st.defaultCredentials && s.username.toLowerCase() === DEFAULT_USERNAME };
  }

  // Each gets (db, args, ctx) with ctx = { edition, ip, session, token }.
  const PUBLIC = {
    needsSetup: (db) => db.needsSetup(),
    loginHint: async (db) => (await db.getSettings()).defaultCredentials,
    async login(db, [{ username, password } = {}], ctx) {
      const f = failures.get(ctx.ip);
      if (f && f.until > Date.now() && f.count >= 10) throw new UserError('Too many wrong passwords. Please wait 15 minutes and try again.');
      const user = await db.verifyLogin(username, password);
      if (!user) {
        if (!f || f.until < Date.now()) failures.set(ctx.ip, { count: 1, until: Date.now() + 15 * 60e3 });
        else f.count += 1;
        throw new UserError('Invalid username or password.');
      }
      if (!user.active) throw new UserError('This account is inactive. Ask a librarian to make it active in Settings → Users.');
      failures.delete(ctx.ip);
      const token = newSession(ctx.edition, user);
      return { token, user, settings: await settingsFor(db, sessions.get(token)) };
    },
    // The Settings password from the sign-in screen: a session limited to the Settings page.
    // Wrong guesses count towards the same 10-in-15-minutes limit as the sign-in.
    async settingsLogin(db, [password], ctx) {
      const f = failures.get(ctx.ip);
      if (f && f.until > Date.now() && f.count >= 10) throw new UserError('Too many wrong passwords. Please wait 15 minutes and try again.');
      if (!isSettingsPassword(password)) {
        if (!f || f.until < Date.now()) failures.set(ctx.ip, { count: 1, until: Date.now() + 15 * 60e3 });
        else f.count += 1;
        throw new UserError('Incorrect password.');
      }
      failures.delete(ctx.ip);
      const token = crypto.randomBytes(32).toString('hex');
      const session = { edition: ctx.edition, userId: 0, username: SETTINGS_USERNAME, settingsOnly: true, expires: Date.now() + sessionHours * 3600e3 };
      sessions.set(token, session);
      return { token, user: { id: 0, username: SETTINGS_USERNAME, settingsOnly: true }, settings: await settingsFor(db, session) };
    },
    async setup(db, [payload], ctx) {
      const user = await db.createFirstUser(payload || {});
      const token = newSession(ctx.edition, user);
      return { token, user, settings: await settingsFor(db, sessions.get(token)) };
    },
  };

  const METHODS = {
    logout: async (db, args, ctx) => sessions.delete(ctx.token) || true,
    async changeCredentials(db, [payload], ctx) {
      const user = await db.changeCredentials(ctx.session.userId, payload || {});
      ctx.session.username = user.username;
      return { user, settings: await settingsFor(db, ctx.session) };
    },
    listUsers: async (db, args, ctx) => (await db.listUsers()).map((u) => ({ ...u, me: u.id === ctx.session.userId })),
    createUser: (db, [p]) => db.createUser(p || {}),
    async updateUser(db, [id, p], ctx) {
      const before = await db.getUser(id);
      const user = await db.updateUser(id, p || {}, ctx.session.userId);
      if (user.id === ctx.session.userId) {
        ctx.session.username = user.username;
        ctx.session.perms = user.perms;
      }
      // Signed out when made inactive or given different access, so the screens match the new
      // access on the next sign-in.
      else if (!user.active || !before || !samePerms(before.perms, user.perms)) dropSessions(ctx.edition, user.id);
      return user;
    },
    async deleteUser(db, [id], ctx) {
      const ok = await db.deleteUser(id, ctx.session.userId);
      dropSessions(ctx.edition, Number(id));
      return ok;
    },
    async deleteUsers(db, [ids], ctx) {
      const n = await db.deleteUsers(ids, ctx.session.userId);
      for (const id of Array.isArray(ids) ? ids : []) dropSessions(ctx.edition, Number(id));
      return n;
    },
    // The Settings page opens only after the signed-in librarian types their own password again.
    // Wrong guesses count towards the same 10-in-15-minutes limit as the sign-in.
    async verifyPassword(db, [password], ctx) {
      const f = failures.get(ctx.ip);
      if (f && f.until > Date.now() && f.count >= 10) throw new UserError('Too many wrong passwords. Please wait 15 minutes and try again.');
      if (await db.verifyLogin(ctx.session.username, password)) return true;
      if (!f || f.until < Date.now()) failures.set(ctx.ip, { count: 1, until: Date.now() + 15 * 60e3 });
      else f.count += 1;
      throw new UserError('Incorrect password.');
    },
    getSettings: (db, args, ctx) => settingsFor(db, ctx.session),
    setDefaultDuration: (db, [days]) => db.setDefaultDuration(days),
    setAllowOtherReturner: (db, [allow]) => db.setAllowOtherReturner(!!allow),
    dashboard: (db) => db.dashboard(),
    overdueList: (db, [asOn, filters]) => db.overdueList(asOn, filters || {}),
    searchBooks: (db, [f]) => db.searchBooks(f || {}),
    saveBook: (db, [b]) => db.saveBook(b || {}),
    deleteBook: (db, [id]) => db.deleteBook(id),
    categories: (db) => db.categories(),
    shelfValues: (db) => db.shelfValues(),
    validateImport: (db, [rows]) => db.validateImport(rows),
    importBooks: (db, [rows]) => db.importBooks(rows),
    suggestBooks: (db, [f]) => db.suggestBooks(f || {}),
    lookupForCirculation: (db, [bookNo]) => db.lookupForCirculation(bookNo),
    issueBook: (db, [p]) => db.issueBook(p || {}),
    returnBook: (db, [p]) => db.returnBook(p || {}),
    todaysActivity: (db, [kind]) => db.todaysActivity(kind),
    circulationList: (db, [f]) => db.circulationList(f || {}),
    borrowerNames: (db) => db.borrowerNames(),
    borrowerDetails: (db) => db.borrowerDetails(),
    exportData: (db) => db.exportData(),
    // Both editions' tables, for a backup of the whole database: { technical: {...}, general: {...} }.
    async exportAllData() {
      const out = {};
      for (const [edition, db] of Object.entries(dbs)) out[edition] = await db.exportData();
      return out;
    },
    async replaceData(db, [data], ctx) {
      await db.replaceData(data);
      dropSessions(ctx.edition); // accounts may differ in the restored data: everyone signs in again
      return true;
    },
  };

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  return {
    // Creates any missing tables for both editions.
    async init() {
      await Promise.all(Object.values(dbs).map((db) => db.init()));
    },
    hasEdition: (edition) => own(dbs, edition),
    // Runs one method. Throws UserError (a message for the librarian), AuthRequired, or a database error.
    async call({ edition, method, args = [], token = '', ip = '' }) {
      if (!own(dbs, edition)) throw new UserError('Unknown library.');
      const db = dbs[edition];
      if (own(PUBLIC, method)) return PUBLIC[method](db, args, { edition, ip });
      if (!own(METHODS, method)) throw new UserError('Unknown method.');
      const session = sessions.get(token);
      if (!session || session.edition !== edition || session.expires < Date.now()) throw new AuthRequired();
      if (session.settingsOnly) {
        if (!SETTINGS_ONLY_METHODS.has(method)) throw new AuthRequired();
        session.expires = Date.now() + sessionHours * 3600e3;
        return METHODS[method](db, args, { edition, ip, session, token });
      }
      // The account is re-checked at most once a minute (each check is a round trip to the server):
      // an account deleted or made inactive elsewhere is signed out within a minute.
      if (!session.checkedAt || Date.now() - session.checkedAt > USER_RECHECK_MS) {
        const user = await db.getUser(session.userId);
        if (!user || !user.active) {
          sessions.delete(token);
          throw new AuthRequired();
        }
        session.checkedAt = Date.now();
        session.perms = access.permsOf(user); // access changed in Settings → Users applies within a minute
      }
      const need = METHOD_PERMS[method];
      if (need && !need.some((k) => (session.perms || []).includes(k))) throw new UserError(NO_ACCESS_MESSAGE);
      session.expires = Date.now() + sessionHours * 3600e3;
      return METHODS[method](db, args, { edition, ip, session, token });
    },
  };
}

// Expired sessions are dropped when used; nothing else to clean up for a desktop app.
module.exports = { createApi, AuthRequired, UserError, EDITIONS, isSettingsPassword, SETTINGS_USERNAME };
