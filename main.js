const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const { LibraryDB, UserError } = require('./src/database');
const { RemoteDB, AuthError, asLibrary, EDITION, DEFAULT_SERVER_URL } = require('./src/remote');
const { DirectDB } = require('./src/direct');
const reports = require('./src/reports');
const importer = require('./src/importer');
const { today } = require('./src/dates');

const APP_NAME = 'Technical Library - CGAS Chennai';
const APP_TITLE = `${APP_NAME} — Library Management System`;

// All library data lives on the library server (MySQL); see server/ and src/remote.js.
let remote = null; // RemoteDB: holds the signed-in session token
let lib = null; // the same server, with the library's method names (lib.searchBooks(...), ...)
let mainWindow = null;
let session = null; // { id, username } of the logged-in librarian
let pendingImport = null; // rows read from the last chosen import file, until imported or cancelled

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#f4f6fb',
    title: APP_TITLE,
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged, // no DevTools in the installed app
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  const page = mainWindow.webContents;
  // Never navigate away from the app or open new windows inside it.
  page.on('will-navigate', (e) => e.preventDefault());
  page.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Reloading would sign the librarian out and lose the screen: F5, Ctrl+R, Ctrl+Shift+R do nothing.
  page.on('before-input-event', (e, input) => {
    const key = (input.key || '').toLowerCase();
    if (input.type === 'keyDown' && (key === 'f5' || ((input.control || input.meta) && key === 'r'))) e.preventDefault();
  });
  // Right-click menu: cut / copy / paste / select all in text boxes, copy for selected text.
  page.on('context-menu', (_e, p) => {
    const items = p.isEditable
      ? [
          { role: 'cut', enabled: p.editFlags.canCut },
          { role: 'copy', enabled: p.editFlags.canCopy },
          { role: 'paste', enabled: p.editFlags.canPaste },
          { type: 'separator' },
          { role: 'selectAll' },
        ]
      : p.selectionText.trim()
        ? [{ role: 'copy' }]
        : [];
    if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });
  page.on('render-process-gone', (_e, details) => log('Screen stopped', details.reason, details.exitCode));
  page.on('console-message', (e) => {
    if (e.level === 'error') log('Screen error', e.message);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Save / open dialogs that give the keyboard back to the page when they close, so text boxes
// keep working afterwards.
const fileDialog = {
  showSaveDialog: (...a) => dialog.showSaveDialog(...a).finally(focusPage),
  showOpenDialog: (...a) => dialog.showOpenDialog(...a).finally(focusPage),
};
function focusPage() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    mainWindow.webContents.focus();
  }
}

// Errors go to app.log in the data folder (%APPDATA%\<app name>\app.log) for support.
const LOG_MAX = 2 * 1024 * 1024;
function log(...parts) {
  const line = `${new Date().toISOString()}  ${parts.map((p) => (p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
  try {
    const file = path.join(app.getPath('userData'), 'app.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX) fs.renameSync(file, file + '.old');
    fs.appendFileSync(file, line);
  } catch {
    // logging must never break the app
  }
}
const consoleError = console.error.bind(console);
console.error = (...a) => {
  consoleError(...a);
  log(...a);
};
process.on('uncaughtException', (e) => log('Uncaught', e));
process.on('unhandledRejection', (e) => log('Unhandled', e));

// Wraps IPC handlers so the renderer always receives { ok, data } or { ok: false, error }.
function handle(channel, fn, { auth = true } = {}) {
  ipcMain.handle(channel, async (_event, ...args) => {
    if (auth && !session) return { ok: false, auth: true, error: 'Your session has ended. Please sign in again.' };
    try {
      const data = await fn(...args);
      return { ok: true, data };
    } catch (e) {
      if (e instanceof AuthError) {
        session = null;
        return { ok: false, auth: true, error: e.message };
      }
      if (!(e instanceof UserError)) console.error(`[${channel}]`, e);
      return {
        ok: false,
        error: e instanceof UserError ? e.message : 'Something went wrong. Please try again. If it keeps happening, restart the app (details are saved in app.log).',
      };
    }
  });
}

const exists = (p) => fsp.access(p).then(() => true, () => false);

function safeFileName(s) {
  return s.replace(/[^\w-]+/g, '_');
}

async function renderReportWindow(type, filters) {
  const html = await reports.toHtml(lib, type, filters);
  const tmp = path.join(os.tmpdir(), `ota-library-report-${Date.now()}.html`);
  await fsp.writeFile(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  await win.loadFile(tmp);
  return {
    win,
    cleanup() {
      if (!win.isDestroyed()) win.close();
      fsp.rm(tmp, { force: true }).catch((e) => console.warn('Could not remove temporary report file', tmp, e.message));
    },
  };
}

function registerIpc() {
  // ----- Auth -----
  // The server checks the password and returns a session token; the user always comes from that token.
  const signIn = (res) => {
    remote.token = res.token;
    session = res.user;
    runAutoBackup().catch(() => {}); // today's backup, now that the data can be read
    return { user: res.user, settings: res.settings };
  };
  handle('auth:login', async ({ username, password } = {}) => signIn(await remote.call('login', { username, password })), { auth: false });
  handle('auth:logout', async () => {
    await remote.call('logout').catch(() => {});
    remote.token = null;
    session = null;
    return true;
  });
  handle('auth:loginHint', () => remote.call('loginHint'), { auth: false });
  // First start on a new library: there are no accounts until the librarian creates one.
  handle('auth:setupNeeded', () => remote.call('needsSetup'), { auth: false });
  handle('auth:setup', async (payload) => signIn(await remote.call('setup', payload || {})), { auth: false });
  handle('auth:changeCredentials', async (payload) => {
    const res = await remote.call('changeCredentials', payload || {});
    session = res.user;
    return res.settings;
  });

  // ----- Users -----
  handle('users:list', () => lib.listUsers());
  handle('users:create', (payload) => lib.createUser(payload || {}));
  handle('users:update', async (id, payload) => {
    const user = await lib.updateUser(id, payload || {});
    if (user.id === session.id) session = user;
    return user;
  });
  handle('users:delete', (id) => lib.deleteUser(id));
  handle('users:deleteMany', (ids) => lib.deleteUsers(ids));

  // ----- Settings -----
  handle('settings:get', () => lib.getSettings());
  handle('settings:setDuration', (days) => lib.setDefaultDuration(days));

  // ----- Dashboard -----
  handle('dashboard:stats', () => lib.dashboard());
  handle('dashboard:overdue', () => lib.overdueList(today()));

  // ----- Books -----
  handle('books:search', (filters) => lib.searchBooks(filters || {}));
  handle('books:save', (book) => lib.saveBook(book || {}));
  handle('books:delete', (id) => lib.deleteBook(id));
  handle('books:categories', () => lib.categories());
  handle('books:shelfValues', () => lib.shelfValues());

  // ----- Bulk import from Excel -----
  handle('books:importTemplate', async () => {
    const { canceled, filePath } = await fileDialog.showSaveDialog(mainWindow, {
      title: 'Save Import Template',
      defaultPath: path.join(app.getPath('documents'), 'Book_Import_Template.xlsx'),
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return null;
    try {
      await importer.writeTemplate(filePath);
    } catch (e) {
      if (e.code === 'EBUSY' || e.code === 'EPERM') throw new UserError('Could not save the template. Close it in Excel and try again.');
      throw e;
    }
    return filePath;
  });
  handle('books:importPreview', async () => {
    const { canceled, filePaths } = await fileDialog.showOpenDialog(mainWindow, {
      title: 'Choose Excel File to Import',
      properties: ['openFile'],
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePaths.length) return null;
    pendingImport = null;
    const sheet = await importer.readBookSheet(filePaths[0]);
    const { total, ready, errors } = await lib.validateImport(sheet.rows);
    pendingImport = { rows: sheet.rows, errors, source: filePaths[0] };
    const { rows, ...info } = sheet;
    return { ...info, total, readyCount: ready.length, errors };
  });
  // Saves the valid rows; the wrong rows are written to "<file>_not_imported_<date>.xlsx"
  // next to the source file (or in Documents if that folder is read-only).
  handle('books:importCommit', async () => {
    if (!pendingImport) throw new UserError('Choose the Excel file again before importing.');
    const { rows, source } = pendingImport;
    const { imported, skipped, errors } = await lib.importBooks(rows);
    pendingImport = null;
    let rejectsFile = null;
    if (errors.length) {
      for (const dir of [path.dirname(source), app.getPath('documents')]) {
        try {
          rejectsFile = importer.rejectsPath(dir, source, today());
          await importer.writeErrorReport(rejectsFile, rows, errors);
          break;
        } catch (e) {
          rejectsFile = null;
        }
      }
    }
    return { imported, skipped, rejectsFile };
  });
  handle('books:importCancel', () => {
    pendingImport = null;
    return true;
  });
  handle('books:importErrors', async () => {
    if (!pendingImport || !pendingImport.errors.length) throw new UserError('There are no import errors to save.');
    const { canceled, filePath } = await fileDialog.showSaveDialog(mainWindow, {
      title: 'Save Import Error Report',
      defaultPath: path.join(app.getPath('documents'), `Book_Import_Errors_${today()}.xlsx`),
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return null;
    try {
      await importer.writeErrorReport(filePath, pendingImport.rows, pendingImport.errors);
    } catch (e) {
      if (e.code === 'EBUSY' || e.code === 'EPERM') throw new UserError('Could not save the report. Close it in Excel and try again.');
      throw e;
    }
    return filePath;
  });

  // ----- Circulation -----
  handle('circ:lookup', (bookNo) => lib.lookupForCirculation(bookNo));
  handle('circ:issue', (payload) => lib.issueBook(payload || {}));
  handle('circ:return', (payload) => lib.returnBook(payload || {}));
  handle('circ:today', (kind) => lib.todaysActivity(kind));
  handle('circ:list', (filters) => lib.circulationList(filters || {}));
  handle('circ:borrowers', () => lib.borrowerNames());

  // ----- Reports -----
  handle('reports:get', (type, filters) => reports.buildReport(lib, type, filters || {}));

  handle('reports:excel', async (type, filters) => {
    const title = reports.REPORTS[type]?.title || 'Report';
    const { canceled, filePath } = await fileDialog.showSaveDialog(mainWindow, {
      title: 'Export to Excel',
      defaultPath: path.join(app.getPath('documents'), `${safeFileName(title)}_${today()}.xlsx`),
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return null;
    try {
      await reports.toExcel(lib, type, filters || {}, filePath);
    } catch (e) {
      if (e.code === 'EBUSY' || e.code === 'EPERM') {
        throw new UserError('Could not save the file. Please close it in Excel and try again.');
      }
      throw e;
    }
    return filePath;
  });

  handle('reports:pdf', async (type, filters) => {
    const title = reports.REPORTS[type]?.title || 'Report';
    const { canceled, filePath } = await fileDialog.showSaveDialog(mainWindow, {
      title: 'Export to PDF',
      defaultPath: path.join(app.getPath('documents'), `${safeFileName(title)}_${today()}.pdf`),
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return null;
    const { win, cleanup } = await renderReportWindow(type, filters || {});
    try {
      const pdf = await win.webContents.printToPDF({
        landscape: true,
        pageSize: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate:
          '<div style="font-size:8px;width:100%;text-align:center;color:#64748b;font-family:Segoe UI,Arial">' +
          `${reports.ORG_NAME} &nbsp;·&nbsp; Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
        margins: { top: 0.5, bottom: 0.6, left: 0.45, right: 0.45 },
      });
      try {
        await fsp.writeFile(filePath, pdf);
      } catch (e) {
        if (e.code === 'EBUSY' || e.code === 'EPERM') {
          throw new UserError('Could not save the PDF. Please close it in your PDF viewer and try again.');
        }
        throw e;
      }
    } finally {
      cleanup();
    }
    return filePath;
  });

  handle('shell:open', async (filePath) => {
    if (typeof filePath !== 'string' || !(await exists(filePath))) throw new UserError('File not found.');
    return shell.openPath(filePath);
  });
  // Fixed address only: the renderer cannot pass a URL.
  handle('shell:website', () => shell.openExternal('https://2cqr.in/').then(() => true), { auth: false });
  handle('shell:showInFolder', (filePath) => {
    if (typeof filePath === 'string') shell.showItemInFolder(filePath);
    return true;
  });

  // ----- Backup / restore -----
  handle('db:backup', async () => {
    const { canceled, filePath } = await fileDialog.showSaveDialog(mainWindow, {
      title: 'Save Library Backup',
      defaultPath: path.join(app.getPath('documents'), `${APP_NAME} Backup ${today()}.db`),
      filters: [{ name: 'Library Backup', extensions: ['db'] }],
    });
    if (canceled || !filePath) return null;
    await fsp.writeFile(filePath, await backupBytes());
    return filePath;
  });

  handle('db:restore', async () => {
    const { canceled, filePaths } = await fileDialog.showOpenDialog(mainWindow, {
      title: 'Restore Library Backup',
      properties: ['openFile'],
      filters: [{ name: 'Library Backup', extensions: ['db'] }],
    });
    if (canceled || !filePaths.length) return null;
    // Check the file and bring it up to the current layout before anything on the server changes.
    const local = await LibraryDB.open(null);
    local.restoreFrom(await fsp.readFile(filePaths[0]));
    const data = local.exportData();
    // Keep a safety copy of the server's current data before replacing it.
    const safety = path.join(app.getPath('userData'), `before-restore-${Date.now()}.db`);
    await fsp.mkdir(path.dirname(safety), { recursive: true });
    await fsp.writeFile(safety, await backupBytes());
    await lib.replaceData(data);
    remote.token = null;
    session = null; // credentials may differ in the restored data
    return filePaths[0];
  });

  handle('backup:getAuto', () => autoBackupView());
  handle('backup:setAuto', async ({ enabled, keep } = {}) => {
    const n = Number(keep);
    if (!Number.isInteger(n) || n < 1 || n > 365) throw new UserError('Keep must be between 1 and 365 backups.');
    await saveAutoBackupConfig({ ...autoBackup, enabled: !!enabled, keep: n });
    if (autoBackup.enabled) await runAutoBackup();
    return autoBackupView();
  });
  handle('backup:chooseFolder', async () => {
    const { canceled, filePaths } = await fileDialog.showOpenDialog(mainWindow, {
      title: 'Choose Auto Backup Folder',
      defaultPath: autoBackup.folder,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths.length) return null;
    await saveAutoBackupConfig({ ...autoBackup, folder: filePaths[0] });
    if (autoBackup.enabled) await runAutoBackup();
    return autoBackupView();
  });
  handle('backup:runNow', async () => {
    const file = await runAutoBackup({ force: true });
    return { file, ...autoBackupView() };
  });

  handle('app:info', () => ({
    version: app.getVersion(),
    dataFile: `Library database ${remote.serverUrl} (${EDITION === 'general' ? 'tables general_books, general_issues, general_users' : 'tables books, issues, users'})`,
  }));
}

// ---------- Automatic backup ----------
// Settings live in the data folder (auto-backup.json), not in the library database, so a restore
// never changes where backups go. One file per day in the chosen folder, written at start-up,
// when the day changes and on exit; the oldest are deleted beyond "keep".
const AUTO_BACKUP_PREFIX = `${APP_NAME} Auto Backup `;
let autoBackup = null; // { enabled, folder, keep, last, lastFile, error }

const autoBackupFile = () => path.join(app.getPath('userData'), 'auto-backup.json');

async function loadAutoBackupConfig() {
  const defaults = { enabled: true, folder: path.join(app.getPath('documents'), `${APP_NAME} Backups`), keep: 30, last: '', lastFile: '', error: '' };
  try {
    autoBackup = { ...defaults, ...JSON.parse(await fsp.readFile(autoBackupFile(), 'utf8')) };
  } catch {
    autoBackup = defaults;
  }
}

async function saveAutoBackupConfig(next) {
  autoBackup = next;
  await fsp.mkdir(path.dirname(autoBackupFile()), { recursive: true });
  await fsp.writeFile(autoBackupFile(), JSON.stringify(autoBackup, null, 2));
}

function autoBackupView() {
  const { enabled, folder, keep, last, lastFile, error } = autoBackup;
  return { enabled, folder, keep, last, lastFile, error };
}

// A backup file in the usual format (SQLite .db), made from all of the server's data.
async function backupBytes() {
  const local = await LibraryDB.open(null);
  local.replaceData(await lib.exportData());
  return local.exportBytes();
}

// Writes today's backup unless one exists already (force: overwrite it with the current data).
// Needs a signed-in session: the server only gives its data to a librarian.
async function runAutoBackup({ force = false } = {}) {
  if (!session || !autoBackup || (!autoBackup.enabled && !force)) return null;
  const day = today();
  if (!force && autoBackup.last === day) return null;
  const file = path.join(autoBackup.folder, `${AUTO_BACKUP_PREFIX}${day}.db`);
  try {
    await fsp.mkdir(autoBackup.folder, { recursive: true });
    await fsp.writeFile(file + '.tmp', await backupBytes());
    await fsp.rename(file + '.tmp', file);
    const old = (await fsp.readdir(autoBackup.folder))
      .filter((f) => f.startsWith(AUTO_BACKUP_PREFIX) && f.endsWith('.db'))
      .sort()
      .slice(0, -autoBackup.keep);
    for (const f of old) await fsp.unlink(path.join(autoBackup.folder, f)).catch(() => {});
    await saveAutoBackupConfig({ ...autoBackup, last: day, lastFile: file, error: '' });
    return file;
  } catch (e) {
    console.error('Automatic backup failed:', e);
    await saveAutoBackupConfig({ ...autoBackup, error: `${day}: ${e.message}` }).catch(() => {});
    if (force) throw new UserError('Could not write the backup: ' + e.message);
    return null;
  }
}

// Where the library data lives: the live MySQL database in db-config.json, built into the app
// ({ host, port, user, password, database }). Version 1 and version 2 use their own tables there.
// Without that file: the API server (built-in address, or server.json in the data folder).
async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function connectLibrary() {
  const db = await readJson(path.join(__dirname, 'db-config.json'));
  if (db && db.host && db.user && db.database) return new DirectDB(db, EDITION);
  const cfg = await readJson(path.join(app.getPath('userData'), 'server.json'));
  const url = cfg && typeof cfg.url === 'string' && /^https?:\/\//.test(cfg.url) ? cfg.url : DEFAULT_SERVER_URL;
  return new RemoteDB(url, EDITION);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // The screens need no camera, microphone, location, notifications or other browser features.
  const browser = require('electron').session.defaultSession;
  browser.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  browser.setPermissionCheckHandler(() => false);
  remote = await connectLibrary();
  if (remote.warmUp) remote.warmUp();
  lib = asLibrary(remote);
  await loadAutoBackupConfig();
  setInterval(() => runAutoBackup(), 60 * 60 * 1000); // picks up the new day if left open overnight
  registerIpc();
  createWindow();
});

// On exit: refresh today's backup with the latest data, then end the session on the server.
app.on('window-all-closed', () => {
  const pending = session
    ? (autoBackup && autoBackup.enabled ? runAutoBackup({ force: true }) : Promise.resolve()).finally(() => remote.call('logout'))
    : Promise.resolve();
  pending
    .catch((e) => console.error('Could not finish on exit:', e.message))
    .then(() => (remote && remote.close ? remote.close() : null)) // close the database connections
    .catch(() => {})
    .finally(() => app.quit());
});
