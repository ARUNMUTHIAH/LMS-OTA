// Connection from the desktop app straight to the library's MySQL database (no API server).
// Same interface as RemoteDB (src/remote.js): call(method, ...args) and a session token, so
// main.js works the same either way. The business rules are server/library-db.js.

const mysql = require('mysql2/promise');
const { createApi, AuthRequired, UserError: ApiUserError } = require('../server/api');
const { UserError } = require('./database');
const { AuthError } = require('./remote');

// MySQL errors that mean the database cannot be reached or the login is wrong.
const CONNECTION_ERRORS = new Set([
  'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET', 'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_DBACCESS_DENIED_ERROR',
]);

class DirectDB {
  // config: { host, port, user, password, database }
  constructor(config, edition) {
    this.config = config;
    this.edition = edition;
    this.token = null;
    this.serverUrl = `${config.host} / ${config.database}`; // shown in Settings
    this._ready = null;
  }

  // Connects on first use; tables that do not exist yet are created.
  _api() {
    if (!this._ready) {
      const pool = mysql.createPool({
        host: this.config.host,
        port: Number(this.config.port) || 3306,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
        connectionLimit: 8, // screens ask for several things at once
        connectTimeout: 15000,
        enableKeepAlive: true,
        dateStrings: true, // DATE -> 'YYYY-MM-DD', DATETIME -> 'YYYY-MM-DD HH:MM:SS'
        charset: 'utf8mb4',
      });
      const api = createApi(pool);
      this._pool = pool;
      this._ready = api.init().then(
        () => api,
        (e) => {
          this._ready = null; // try again on the next request
          pool.end().catch(() => {});
          throw e;
        }
      );
    }
    return this._ready;
  }

  // Connects in the background as the app opens, so the first sign-in does not wait for it.
  warmUp() {
    this._api().catch(() => {}); // a failure is reported when the librarian signs in
  }

  // Closes the database connections when the app exits.
  async close() {
    const pool = this._pool;
    this._pool = null;
    this._ready = null;
    if (pool) await pool.end();
  }

  async call(method, ...args) {
    try {
      const api = await this._api();
      return await api.call({ edition: this.edition, method, args, token: this.token || '', ip: 'app' });
    } catch (e) {
      if (e instanceof AuthRequired) {
        this.token = null;
        throw new AuthError(e.message);
      }
      if (e instanceof ApiUserError) throw new UserError(e.message);
      if (CONNECTION_ERRORS.has(e.code)) {
        throw new UserError('Cannot connect to the library database. Check the internet connection and try again.');
      }
      throw e;
    }
  }
}

module.exports = { DirectDB };
