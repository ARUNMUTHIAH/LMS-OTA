// Library API server (optional): lets the desktop apps reach the database over HTTP instead of
// connecting to MySQL themselves.
//   POST /api/<edition>/<method>   body: { "args": [...] }   header: Authorization: Bearer <token>
// Replies are { ok: true, data } or { ok: false, error, auth? }. Methods and sessions: server/api.js.
//
// Settings come from server/.env (see .env.example). Start with: node index.js

const fs = require('fs');
const path = require('path');
const http = require('http');

loadEnv(path.join(__dirname, '.env'));
process.env.TZ = process.env.TZ || 'Asia/Kolkata'; // "today" and due dates follow the library's local date

const mysql = require('mysql2/promise');
const { createApi, AuthRequired, UserError } = require('./api');

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 25 * 1024 * 1024; // a full restore sends every row at once

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

// JSON only, never a page: nothing may frame it, sniff it, run it or send a referrer from it.
// Strict-Transport-Security is only meaningful once the server is behind HTTPS (set it there).
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new UserError('The request is too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 10,
    dateStrings: true, // DATE -> 'YYYY-MM-DD', DATETIME -> 'YYYY-MM-DD HH:MM:SS'
    charset: 'utf8mb4',
  });
  const api = createApi(pool, { sessionHours: Number(process.env.SESSION_HOURS) || 12 });
  await api.init();

  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
    const m = req.url.match(/^\/api\/([a-z]+)\/([A-Za-z]+)$/);
    if (req.method !== 'POST' || !m || !api.hasEdition(m[1])) return send(res, 404, { ok: false, error: 'Not found.' });
    const [, edition, method] = m;
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const data = await api.call({
        edition,
        method,
        args: Array.isArray(body.args) ? body.args : [],
        token: (req.headers.authorization || '').replace(/^Bearer\s+/i, ''),
        ip: req.socket.remoteAddress || '',
      });
      return send(res, 200, { ok: true, data });
    } catch (e) {
      if (e instanceof AuthRequired) return send(res, 401, { ok: false, auth: true, error: e.message });
      if (e instanceof SyntaxError) return send(res, 400, { ok: false, error: 'Bad request.' });
      if (e instanceof UserError) return send(res, 200, { ok: false, error: e.message });
      console.error(`[${edition}.${method}]`, e);
      return send(res, 500, { ok: false, error: 'Server error. Please try again.' });
    }
  });
  server.listen(PORT, HOST, () => console.log(`Library API listening on http://${HOST}:${PORT} (database ${process.env.DB_NAME})`));
}

main().catch((e) => {
  console.error('Could not start the library API:', e.message);
  process.exit(1);
});
