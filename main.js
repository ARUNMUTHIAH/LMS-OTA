const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard, safeStorage, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const { LibraryDB, UserError } = require('./src/database');
const { isSettingsPassword, SETTINGS_USERNAME } = require('./server/api');
const { RemoteDB, AuthError, asLibrary, EDITION, DEFAULT_SERVER_URL } = require('./src/remote');
const { DirectDB, testConnection } = require('./src/direct');
const reports = require('./src/reports');
const importer = require('./src/importer');
const { today } = require('./src/dates');
const { toSqlDump, parseSqlDump } = require('./src/sqldump');
const { LicenseManager, LicenseError } = require('./src/license');

// The name people see everywhere (window title, screens, reports, backup files).
const APP_TITLE = '2CQR GARUDA';
// Which of the two libraries this copy is, shown only as a short tag where the two must differ
// (backup file names). scripts/build-general.js sets "Books" for the second edition.
const EDITION_TAG = 'Manuals';
const BACKUP_NAME = `${APP_TITLE} ${EDITION_TAG}`;
// The data folder (license, database connection, backup settings) keeps its original name, so
// installs from before the rename find everything where it was. Internal only, never shown.
// scripts/build-general.js swaps in the second edition's folder.
app.setPath('userData', path.join(app.getPath('appData'), 'Technical Library - CGAS Chennai'));

// All library data lives on the library server (MySQL); see server/ and src/remote.js.
let remote = null; // RemoteDB: holds the signed-in session token
let lib = null; // the same server, with the library's method names (lib.searchBooks(...), ...)
let mainWindow = null;
let session = null; // { id, username, role, perms } of the logged-in user (perms: screens / actions allowed)
let pendingImport = null; // rows read from the last chosen import file, until imported or cancelled
let license = null; // LicenseManager: nothing but the License screen works without a valid license

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
// Without a valid license (missing, expired, or for another installation) only the license:*
// channels answer; anything else signs the librarian out and sends the screen to the License page.
// Opened with the Settings password while the library database could not be reached: only what
// works without the database answers (connection, license, automatic-backup options).
const OFFLINE_CHANNELS = new Set([
  'auth:logout', 'auth:settingsLogin', 'app:info', 'brand:logo',
  'dbconn:get', 'dbconn:test', 'dbconn:save', 'dbconn:reset',
  'backup:getAuto', 'backup:setAuto', 'backup:chooseFolder', 'shell:open', 'shell:website',
]);

// The Settings password (sign-in screen gear and sidebar Settings): at most 10 wrong in 15 minutes.
const settingsTries = { count: 0, until: 0 };
function checkSettingsPassword(password) {
  if (settingsTries.until > Date.now() && settingsTries.count >= 10) throw new UserError('Too many wrong passwords. Please wait 15 minutes and try again.');
  if (!isSettingsPassword(password)) {
    if (settingsTries.until < Date.now()) Object.assign(settingsTries, { count: 1, until: Date.now() + 15 * 60e3 });
    else settingsTries.count += 1;
    throw new UserError('Incorrect password.');
  }
  settingsTries.count = 0;
  return true;
}

// Audit log entry for something done on this PC (report exported, backup saved, ...): the server
// adds the signed-in account and the PC name. Never stops or slows the action itself.
function auditNote(kind, data = {}) {
  if (!session || session.offline || !lib) return;
  lib.logEvent(kind, data).catch(() => {});
}
// Report / audit filters as short text for the audit log: "from: 2026-01-01 | status: Issued".
const filterText = (f) =>
  Object.entries(f || {})
    .filter(([, v]) => v !== '' && v != null && v !== false && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join(' | ') || 'No filters';

function handle(channel, fn, { auth = true, licensed = true } = {}) {
  ipcMain.handle(channel, async (_event, ...args) => {
    if (licensed) {
      const lic = license.status();
      if (!lic.valid) {
        if (session) {
          remote.call('logout').catch(() => {});
          remote.token = null;
          session = null;
        }
        return { ok: false, license: true, error: lic.message };
      }
    }
    if (auth && !session) return { ok: false, auth: true, error: 'Your session has ended. Please sign in again.' };
    if (session && session.offline && !channel.startsWith('license:') && !OFFLINE_CHANNELS.has(channel)) {
      return { ok: false, error: 'Not connected to the library database. Fix the database connection first.' };
    }
    try {
      const data = await fn(...args);
      return { ok: true, data };
    } catch (e) {
      if (e instanceof AuthError) {
        session = null;
        return { ok: false, auth: true, error: e.message };
      }
      if (e instanceof LicenseError) return { ok: false, error: e.message };
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
  // ----- License -----
  const open = { auth: false, licensed: false };
  handle('license:status', () => license.reload(), open);
  handle('license:request', (clientId) => license.requestCode(clientId), open);
  handle('license:copy', (text) => {
    if (typeof text !== 'string' || text.length > 4096) throw new UserError('Nothing to copy.');
    clipboard.writeText(text);
    return true;
  }, open);
  handle('license:load', async () => {
    const { canceled, filePaths } = await fileDialog.showOpenDialog(mainWindow, {
      title: 'Choose License File',
      properties: ['openFile'],
      filters: [{ name: 'License File (.lmlic)', extensions: ['lmlic', 'json', 'lic', 'txt'] }, { name: 'All Files', extensions: ['*'] }],
    });
    if (canceled || !filePaths.length) return null;
    const stat = await fsp.stat(filePaths[0]);
    if (stat.size > 64 * 1024) throw new UserError('This is not a license file.');
    return license.install(await fsp.readFile(filePaths[0], 'utf8'));
  }, open);

  // ----- Auth -----
  // The server checks the password and returns a session token; the user always comes from that token.
  const signIn = (res) => {
    remote.token = res.token;
    session = res.user;
    runAutoBackup().catch(() => {}); // today's backup, now that the data can be read
    return { user: res.user, settings: res.settings };
  };
  handle('auth:login', async ({ username, password } = {}) => signIn(await remote.call('login', { username, password })), { auth: false });
  // Settings password from the sign-in screen: a session that can only use the Settings page.
  // The password is checked here first, so Settings opens even when the database cannot be reached
  // (then only the database connection and automatic backup options work, until it is fixed).
  handle('auth:settingsLogin', async (password) => {
    const pw = typeof password === 'string' ? password : '';
    try {
      checkSettingsPassword(pw);
    } catch (e) {
      // Wrong password: the server checks it again, which records the failed attempt in the audit log.
      remote.call('settingsLogin', pw).catch(() => {});
      throw e;
    }
    if (session) await remote.call('logout').catch(() => {});
    try {
      const res = await remote.call('settingsLogin', pw);
      remote.token = res.token;
      session = res.user;
      return { user: res.user, settings: res.settings };
    } catch (e) {
      // Database down (or an older API server): Settings without the library data.
      remote.token = null;
      session = { id: 0, username: SETTINGS_USERNAME, settingsOnly: true, offline: true };
      return { user: session, settings: null, error: e.message };
    }
  }, { auth: false });
  handle('auth:logout', async (reason) => {
    await remote.call('logout', reason === 'idle' ? 'idle' : '').catch(() => {});
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
  // The sidebar Settings asks for the same Settings password as the gear on the sign-in screen.
  handle('settings:unlock', (password) => {
    try {
      checkSettingsPassword(typeof password === 'string' ? password : '');
    } catch (e) {
      auditNote('settings_unlock_failed');
      throw e;
    }
    auditNote('settings_opened');
    return true;
  });
  handle('settings:get', () => lib.getSettings());
  handle('settings:setDuration', (days) => lib.setDefaultDuration(days));
  handle('settings:setReturnPolicy', (allow) => lib.setAllowOtherReturner(!!allow));

  // ----- Logo (Settings → Logo) -----
  // The library's own logo, kept in the database (every PC shows it) and shown on the sign-in page
  // and in the sidebar only. The app icon, window icon and installers stay the 2CQR GARUDA eagle.
  // A copy is kept in the data folder, so the sign-in page still shows it while the database is down.
  const logoCache = () => path.join(app.getPath('userData'), 'logo-cache.txt');
  handle('brand:logo', async () => {
    try {
      const logo = await remote.call('brandLogo');
      if (logo) await fsp.writeFile(logoCache(), logo);
      else await fsp.rm(logoCache(), { force: true });
      return logo || null;
    } catch {
      return (await fsp.readFile(logoCache(), 'utf8').catch(() => '')) || null;
    }
  }, open);
  handle('brand:choose', async () => {
    const { canceled, filePaths } = await fileDialog.showOpenDialog(mainWindow, {
      title: 'Choose Logo',
      properties: ['openFile'],
      filters: [{ name: 'Logo picture (PNG, JPG)', extensions: ['png', 'jpg', 'jpeg'] }],
    });
    if (canceled || !filePaths.length) return undefined;
    const stat = await fsp.stat(filePaths[0]);
    if (stat.size > 10 * 1024 * 1024) throw new UserError('The picture is too large (over 10 MB). Use a smaller one.');
    let img = nativeImage.createFromPath(filePaths[0]);
    if (img.isEmpty()) throw new UserError('This file is not a picture the app can read. Use a PNG or JPG.');
    // Shrunk to at most 512 px: plenty for the sign-in page, and small enough for the database.
    const { width, height } = img.getSize();
    if (width > 512 || height > 512) img = img.resize(width >= height ? { width: 512, quality: 'best' } : { height: 512, quality: 'best' });
    const saved = await lib.setLogo('data:image/png;base64,' + img.toPNG().toString('base64'));
    await fsp.writeFile(logoCache(), saved).catch(() => {});
    return saved;
  });
  handle('brand:reset', async () => {
    await lib.setLogo(null);
    await fsp.rm(logoCache(), { force: true });
    return null;
  });

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
  handle('circ:suggest', (filters) => lib.suggestBooks(filters || {}));
  handle('circ:lookup', (bookNo) => lib.lookupForCirculation(bookNo));
  handle('circ:issue', (payload) => lib.issueBook(payload || {}));
  handle('circ:return', (payload) => lib.returnBook(payload || {}));
  handle('circ:today', (kind) => lib.todaysActivity(kind));
  handle('circ:list', (filters) => lib.circulationList(filters || {}));
  handle('circ:borrowers', () => lib.borrowerNames());
  handle('circ:borrowerDetails', () => lib.borrowerDetails());

  // ----- Audit log (read only) -----
  handle('audit:list', (filters) => lib.auditLog(filters || {}));
  handle('audit:excel', async (filters) => {
    const { canceled, filePath } = await fileDialog.showSaveDialog(mainWindow, {
      title: 'Export Audit Log to Excel',
      defaultPath: path.join(app.getPath('documents'), `Audit_Log_${today()}.xlsx`),
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return null;
    const data = await lib.auditLog(filters || {});
    try {
      await reports.auditToExcel(data.rows, filterText(filters), filePath);
    } catch (e) {
      if (e.code === 'EBUSY' || e.code === 'EPERM') throw new UserError('Could not save the file. Please close it in Excel and try again.');
      throw e;
    }
    auditNote('audit_excel', { filters: filterText(filters) });
    return filePath;
  });

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
    auditNote('report_excel', { title, filters: filterText(filters) });
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
    auditNote('report_pdf', { title, filters: filterText(filters) });
    return filePath;
  });

  handle('shell:open', async (filePath) => {
    if (typeof filePath !== 'string' || !(await exists(filePath))) throw new UserError('File not found.');
    return shell.openPath(filePath);
  });
  // Fixed address only: the renderer cannot pass a URL.
  handle('shell:website', () => shell.openExternal('https://2cqr.in/').then(() => true), { auth: false, licensed: false });
  handle('shell:showInFolder', (filePath) => {
    if (typeof filePath === 'string') shell.showItemInFolder(filePath);
    return true;
  });

  // ----- Backup / restore -----
  handle('db:backup', async () => {
    const { canceled, filePath } = await fileDialog.showSaveDialog(mainWindow, {
      title: 'Save Library Backup',
      defaultPath: path.join(app.getPath('documents'), `${BACKUP_NAME} Backup ${today()}.sql`),
      filters: [{ name: 'Library Backup (SQL)', extensions: ['sql'] }],
    });
    if (canceled || !filePath) return null;
    await fsp.writeFile(filePath, await backupSql());
    auditNote('backup_saved', { file: path.basename(filePath) });
    return filePath;
  });

  handle('db:restore', async () => {
    const { canceled, filePaths } = await fileDialog.showOpenDialog(mainWindow, {
      title: 'Restore Library Backup',
      properties: ['openFile'],
      filters: [{ name: 'Library Backup', extensions: ['sql', 'db'] }],
    });
    if (canceled || !filePaths.length) return null;
    // Check the file before anything on the server changes: a .sql dump (this version's tables), or an
    // older .db backup, brought up to the current layout.
    const bytes = await fsp.readFile(filePaths[0]);
    let data;
    if (/\.sql$/i.test(filePaths[0])) data = parseSqlDump(bytes.toString('utf8'), { prefix: TABLE_PREFIX, oldPrefix: EDITION === 'general' ? null : '' });
    else {
      const local = await LibraryDB.open(null);
      local.restoreFrom(bytes);
      data = local.exportData();
    }
    // Keep a safety copy of the server's current data before replacing it (the last 5 are kept).
    const safety = path.join(app.getPath('userData'), `before-restore-${Date.now()}.sql`);
    await fsp.mkdir(path.dirname(safety), { recursive: true });
    await fsp.writeFile(safety, await backupSql());
    await rotate(path.dirname(safety), 'before-restore-', 5);
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
    auditNote('auto_backup_changed', { enabled: !!enabled, keep: n });
    if (autoBackup.enabled) await runAutoBackup();
    await rotateAutoBackups(); // a smaller "keep" applies straight away
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
    auditNote('auto_backup_changed', { enabled: autoBackup.enabled, keep: autoBackup.keep, folder: filePaths[0] });
    if (autoBackup.enabled) await runAutoBackup();
    return autoBackupView();
  });
  handle('backup:runNow', async () => {
    const file = await runAutoBackup({ force: true });
    return { file, ...(await autoBackupView()) };
  });

  // ----- Database connection -----
  const dbOpen = { auth: false };
  handle('dbconn:get', async () => {
    await mayChangeDb();
    const c = dbConfig || {};
    return {
      host: c.host || '', port: Number(c.port) || 3306, user: c.user || '', database: c.database || '',
      hasPassword: !!c.password, source: dbSource, hasBuiltIn: !!(await builtInDb()),
    };
  }, dbOpen);
  handle('dbconn:test', async (p) => {
    await mayChangeDb();
    return testConnection(dbInput(p || {}));
  }, dbOpen);
  handle('dbconn:save', async (p) => {
    await mayChangeDb();
    const cfg = dbInput(p || {});
    await testConnection(cfg); // never switch to a connection that does not work
    auditNote('db_connection_changed', { details: `New connection: ${cfg.host}:${cfg.port || 3306} / ${cfg.database} (user ${cfg.user})` });
    await writeSavedDb(cfg);
    await reconnect();
    return true;
  }, dbOpen);
  handle('dbconn:reset', async () => {
    await mayChangeDb();
    if (!(await builtInDb())) throw new UserError('This copy of the app has no built-in connection.');
    auditNote('db_connection_changed', { details: 'Back to the built-in connection' });
    await fsp.rm(dbConnFile(), { force: true });
    await reconnect();
    return true;
  }, dbOpen);

  handle('app:info', () => ({
    version: app.getVersion(),
    dataFile: `Library database ${remote.serverUrl} (${EDITION === 'general' ? 'tables general_books, general_issues, general_users' : 'tables technical_books, technical_issues, technical_users'})`,
  }));
}

// ---------- Automatic backup ----------
// Settings live in the data folder (auto-backup.json), not in the library database, so a restore
// never changes where backups go. Rotational: one file per day in the chosen folder, written at
// start-up, when the day changes and on exit (the same day's file is refreshed); only the latest
// "keep" files are kept — each new day's file pushes the oldest one out.
const AUTO_BACKUP_PREFIX = `${BACKUP_NAME} Auto Backup `;
let autoBackup = null; // { enabled, folder, keep, last, lastFile, error }

const autoBackupFile = () => path.join(app.getPath('userData'), 'auto-backup.json');

async function loadAutoBackupConfig() {
  // keepVersion 2: the rotation keeps 10 days by default (it was 30).
  const defaults = { enabled: true, folder: path.join(app.getPath('documents'), `${BACKUP_NAME} Backups`), keep: 10, keepVersion: 2, last: '', lastFile: '', error: '' };
  try {
    const saved = JSON.parse(await fsp.readFile(autoBackupFile(), 'utf8'));
    // Settings saved before keepVersion 2 still holding the old default of 30 move to the new 10 once;
    // a number the librarian chose themselves is kept.
    if (!saved.keepVersion) {
      if (saved.keep === 30) saved.keep = 10;
      saved.keepVersion = 2;
    }
    autoBackup = { ...defaults, ...saved };
  } catch {
    autoBackup = defaults;
  }
}

async function saveAutoBackupConfig(next) {
  autoBackup = next;
  await fsp.mkdir(path.dirname(autoBackupFile()), { recursive: true });
  await fsp.writeFile(autoBackupFile(), JSON.stringify(autoBackup, null, 2));
}

// The view for the Settings page, with how many rotation files are in the folder now.
async function autoBackupView() {
  const { enabled, folder, keep, last, lastFile, error } = autoBackup;
  const count = (await backupFiles(folder, AUTO_BACKUP_PREFIX)).length;
  return { enabled, folder, keep, last, lastFile, error, count };
}

// Backup files in `dir` named "<prefix>*.sql" (or older "*.db"), oldest first (the names end in a date or a time).
async function backupFiles(dir, prefix) {
  const names = await fsp.readdir(dir).catch(() => []);
  return names.filter((f) => f.startsWith(prefix) && /\.(sql|db)$/.test(f)).sort();
}

// Deletes the oldest backup files beyond the newest `keep`.
async function rotate(dir, prefix, keep) {
  const old = (await backupFiles(dir, prefix)).slice(0, -keep);
  for (const f of old) await fsp.unlink(path.join(dir, f)).catch((e) => console.warn('Could not delete old backup', f, e.message));
}

const rotateAutoBackups = () => rotate(autoBackup.folder, AUTO_BACKUP_PREFIX, autoBackup.keep);

// Tables of this version in the library database: technical_books, ... or general_books, ...
const TABLE_PREFIX = EDITION === 'general' ? 'general_' : 'technical_';

// A backup file: a MySQL dump (.sql) of the whole library database, both versions' tables, so the
// Technical and General apps make the same file. An API server without exportAllData (older
// version) gives this version's tables only.
async function backupSql() {
  const database = dbConfig ? dbConfig.database : '';
  let sets;
  try {
    const all = await lib.exportAllData();
    sets = [{ prefix: 'technical_', data: all.technical }, { prefix: 'general_', data: all.general }];
  } catch (e) {
    if (!(e instanceof UserError) || e instanceof AuthError) throw e;
    sets = [{ prefix: TABLE_PREFIX, data: await lib.exportData() }];
  }
  return toSqlDump(sets, { database, title: 'Library Database' });
}

// Writes today's backup unless one exists already (force: overwrite it with the current data).
// Needs a signed-in session: the server only gives its data to a librarian (not to a View only account).
async function runAutoBackup({ force = false } = {}) {
  if (!session || (!session.settingsOnly && !(session.perms || []).includes('settings')) || !autoBackup || (!autoBackup.enabled && !force)) return null;
  const day = today();
  if (!force && autoBackup.last === day) return null;
  const file = path.join(autoBackup.folder, `${AUTO_BACKUP_PREFIX}${day}.sql`);
  try {
    await fsp.mkdir(autoBackup.folder, { recursive: true });
    await fsp.writeFile(file + '.tmp', await backupSql());
    await fsp.rename(file + '.tmp', file);
    await rotateAutoBackups();
    await saveAutoBackupConfig({ ...autoBackup, last: day, lastFile: file, error: '' });
    auditNote('auto_backup_made', { file: path.basename(file) });
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

// ---------- Database connection (Settings → Database connection) ----------
// The connection built into the app (db-config.json, built into main.js by the installer build) can
// be replaced from Settings without changing any code: the new one is kept in db-connection.json in
// the data folder (each version has its own), its password encrypted for this Windows account.
// Deleting that file ("Use built-in connection") goes back to the built-in one.
const dbConnFile = () => path.join(app.getPath('userData'), 'db-connection.json');
let dbSource = 'built-in'; // 'custom' while a connection saved in Settings is in use
let dbConfig = null; // the MySQL settings in use (null: the API server)

async function builtInDb() {
  const db = await readJson(path.join(__dirname, 'db-config.json'));
  return db && db.host && db.user && db.database ? db : null;
}

async function savedDb() {
  const c = await readJson(dbConnFile());
  if (!c || !c.host || !c.user || !c.database) return null;
  try {
    const password = c.passwordEnc ? safeStorage.decryptString(Buffer.from(c.passwordEnc, 'base64')) : c.password || '';
    return { host: c.host, port: c.port, user: c.user, database: c.database, password };
  } catch (e) {
    console.error('Saved database connection cannot be read (made on another computer or account?):', e.message);
    return null;
  }
}

async function writeSavedDb(cfg) {
  const { password, ...rest } = cfg;
  const secret = safeStorage.isEncryptionAvailable()
    ? { passwordEnc: safeStorage.encryptString(password).toString('base64') }
    : { password };
  await fsp.mkdir(path.dirname(dbConnFile()), { recursive: true });
  await fsp.writeFile(dbConnFile(), JSON.stringify({ ...rest, ...secret, savedAt: new Date().toISOString() }, null, 2));
}

// Checks what was typed in the Database connection form. A blank password keeps the current one.
function dbInput(p = {}) {
  const s = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
  const host = s(p.host);
  const user = s(p.user);
  const database = s(p.database);
  const port = Number(s(p.port) || 3306);
  if (!host || /\s/.test(host) || host.length > 255) throw new UserError('Enter the server address (no spaces).');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UserError('Port must be a whole number from 1 to 65535.');
  if (!/^[\w$-]{1,64}$/.test(database)) throw new UserError('Enter the database name: letters, numbers, _ $ - (up to 64).');
  if (!user || user.length > 80) throw new UserError('Enter the database username.');
  const typed = typeof p.password === 'string' ? p.password : '';
  if (typed.length > 256) throw new UserError('The password is too long.');
  const password = typed || (dbConfig ? dbConfig.password : '');
  return { host, port, user, database, password };
}

// Signed in (Settings, behind its password): always. Signed out: only while the database in use
// cannot be reached — then nobody could sign in to reach Settings, so the sign-in screen offers it.
async function mayChangeDb() {
  if (session) return;
  if (dbConfig) {
    try {
      await testConnection(dbConfig);
    } catch {
      return;
    }
  }
  throw new UserError('The database is working. Sign in and open Settings to change it.');
}

// Switches to the connection now configured. Everyone signs in again: the accounts are in the database.
async function reconnect() {
  const old = remote;
  if (session && old) await old.call('logout').catch(() => {});
  session = null;
  remote = await connectLibrary();
  lib = asLibrary(remote);
  if (remote.warmUp) remote.warmUp();
  if (old && old.close) old.close().catch(() => {});
}

async function connectLibrary() {
  const custom = await savedDb();
  const db = custom || (await builtInDb());
  dbSource = custom ? 'custom' : 'built-in';
  dbConfig = db;
  if (db) return new DirectDB(db, EDITION);
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
  // The license may be loaded from the License screen (kept in the data folder) or pasted by hand
  // into the install folder (next to the .exe; the project folder when run with npm start).
  license = new LicenseManager({
    dataDir: app.getPath('userData'),
    rootDirs: [app.isPackaged ? path.dirname(process.execPath) : __dirname],
  });
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
