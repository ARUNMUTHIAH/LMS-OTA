// Connection from the desktop app to the library API server (server/index.js).
// Every library method runs on the server; this sends { args } and returns the reply's data.
// A wrong entry raises UserError (shown to the librarian as is); an ended session raises AuthError.

const { UserError } = require('./database');

// Version 1 = "technical" (tables technical_books, technical_issues, ...), version 2 = "general" (general_books, ...).
const EDITION = 'technical';
const DEFAULT_SERVER_URL = 'http://76.13.198.196:4000';
const TIMEOUT_MS = 30000;

class AuthError extends UserError {}

// The server words its messages with version 1's field names (Barcode No, Description of Manual, ...).
// Version 2 shows some fields under other names: its build fills this list with [from, to] pairs.
const RELABEL = [];
const relabel = (msg) => RELABEL.reduce((s, [from, to]) => s.split(from).join(to), String(msg));
// Applies relabel to a reply: import checks return their row problems as data ({ errors: [{ messages }] }).
function relabelData(data) {
  if (!RELABEL.length || !data || !Array.isArray(data.errors)) return data;
  return { ...data, errors: data.errors.map((e) => (Array.isArray(e && e.messages) ? { ...e, messages: e.messages.map(relabel) } : e)) };
}

class RemoteDB {
  constructor(serverUrl = DEFAULT_SERVER_URL, edition = EDITION) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.edition = edition;
    this.token = null;
  }

  async call(method, ...args) {
    let res;
    try {
      res = await fetch(`${this.serverUrl}/api/${this.edition}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        body: JSON.stringify({ args }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new UserError(`Cannot reach the library server (${this.serverUrl}). Check the internet connection and try again.`);
    }
    let body;
    try {
      body = await res.json();
    } catch {
      throw new UserError(`The library server sent an unexpected reply (HTTP ${res.status}).`);
    }
    if (body.ok) return relabelData(body.data);
    if (body.auth) {
      this.token = null;
      throw new AuthError(body.error || 'Your session has ended. Please sign in again.');
    }
    throw new UserError(relabel(body.error || 'The library server could not complete the request.'));
  }
}

// Report builders (src/reports.js) call db.searchBooks(...) etc.; this gives them the same names.
function asLibrary(remote) {
  return new Proxy(
    {},
    {
      get: (_t, name) => (...args) => remote.call(String(name), ...args),
    }
  );
}

module.exports = { RemoteDB, AuthError, asLibrary, relabel, relabelData, EDITION, DEFAULT_SERVER_URL };
