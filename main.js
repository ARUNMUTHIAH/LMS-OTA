const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fsp = require('fs/promises');
const os = require('os');
const { LibraryDB, UserError, DEFAULT_USERNAME } = require('./src/database');
const reports = require('./src/reports');
const importer = require('./src/importer');
const { today } = require('./src/dates');

const APP_TITLE = 'Technical Library - CGAS Chennai — Library Management System';

let db = null;
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
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  // Never navigate away from the app or open new windows inside it.
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Wraps IPC handlers so the renderer always receives { ok, data } or { ok: false, error }.
function handle(channel, fn, { auth = true } = {}) {
  ipcMain.handle(channel, async (_event, ...args) => {
    if (auth && !session) return { ok: false, auth: true, error: 'Your session has ended. Please sign in again.' };
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      if (!(e instanceof UserError)) console.error(`[${channel}]`, e);
      return { ok: false, error: e instanceof UserError ? e.message : 'Unexpected error: ' + e.message };
    }
  });
}

// Settings as seen by the signed-in user (their own username, not the first account's).
function settingsForSession() {
  const s = db.getSettings();
  // The default-password warning only concerns the built-in "admin" account of older databases.
  return { ...s, username: session.username, defaultCredentials: s.defaultCredentials && session.username.toLowerCase() === DEFAULT_USERNAME };
}

const exists = (p) => fsp.access(p).then(() => true, () => false);

function safeFileName(s) {
  return s.replace(/[^\w-]+/g, '_');
}

async function renderReportWindow(type, filters) {
  const html = reports.toHtml(db, type, filters);
  const tmp = path.join(os.tmpdir(), `ota-library-report-${Date.now()}.html`);
  await fsp.writeFile(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  await win.loadFile(tmp);
  return {
    win,
    cleanup() {
      if (!win.isDestroyed()) win.close();
      fsp.rm(tmp, { force: true }).catch(() => {});
    },
  };
}

function registerIpc() {
  // ----- Auth -----
  handle(
    'auth:login',
    ({ username, password }) => {
      const user = db.verifyLogin(username, password);
      if (!user) throw new UserError('Invalid username or password.');
      if (!user.active) throw new UserError('This account is inactive. Ask a librarian to make it active in Settings → Users.');
      session = user;
      return { user, settings: settingsForSession() };
    },
    { auth: false }
  );
  handle('auth:logout', () => {
    session = null;
    return true;
  });
  handle('auth:loginHint', () => db.getSettings().defaultCredentials, { auth: false });
  // First start on a new database: there are no accounts until the librarian creates one.
  handle('auth:setupNeeded', () => db.needsSetup(), { auth: false });
  handle(
    'auth:setup',
    (payload) => {
      const user = db.createFirstUser(payload || {});
      session = user;
      return { user, settings: settingsForSession() };
    },
    { auth: false }
  );
  handle('auth:changeCredentials', (payload) => {
    session = db.changeCredentials(session.id, payload);
    return settingsForSession();
  });

  // ----- Users -----
  handle('users:list', () => db.listUsers().map((u) => ({ ...u, me: u.id === session.id })));
  handle('users:create', (payload) => db.createUser(payload || {}));
  handle('users:update', (id, payload) => {
    const user = db.updateUser(id, payload || {}, session.id);
    if (user.id === session.id) session = user;
    return user;
  });
  handle('users:delete', (id) => db.deleteUser(id, session.id));
  handle('users:deleteMany', (ids) => db.deleteUsers(ids, session.id));

  // ----- Settings -----
  handle('settings:get', () => settingsForSession());
  handle('settings:setDuration', (days) => db.setDefaultDuration(days));

  // ----- Dashboard -----
  handle('dashboard:stats', () => db.dashboard());
  handle('dashboard:overdue', () => db.overdueList(today()));

  // ----- Books -----
  handle('books:search', (filters) => db.searchBooks(filters || {}));
  handle('books:save', (book) => db.saveBook(book || {}));
  handle('books:delete', (id) => db.deleteBook(id));
  handle('books:categories', () => db.categories());
  handle('books:shelfValues', () => db.shelfValues());

  // ----- Bulk import from Excel -----
  handle('books:importTemplate', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
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
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Excel File to Import',
      properties: ['openFile'],
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePaths.length) return null;
    pendingImport = null;
    const sheet = await importer.readBookSheet(filePaths[0]);
    const { total, ready, errors } = db.validateImport(sheet.rows);
    pendingImport = { rows: sheet.rows, errors, source: filePaths[0] };
    const { rows, ...info } = sheet;
    return { ...info, total, readyCount: ready.length, errors };
  });
  // Saves the valid rows; the wrong rows are written to "<file>_not_imported_<date>.xlsx"
  // next to the source file (or in Documents if that folder is read-only).
  handle('books:importCommit', async () => {
    if (!pendingImport) throw new UserError('Choose the Excel file again before importing.');
    const { rows, source } = pendingImport;
    const { imported, skipped, errors } = db.importBooks(rows);
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
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
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
  handle('circ:lookup', (bookNo) => db.lookupForCirculation(bookNo));
  handle('circ:issue', (payload) => db.issueBook(payload || {}));
  handle('circ:return', (payload) => db.returnBook(payload || {}));
  handle('circ:today', (kind) => db.todaysActivity(kind));
  handle('circ:list', (filters) => db.circulationList(filters || {}));
  handle('circ:borrowers', () => db.borrowerNames());

  // ----- Reports -----
  handle('reports:get', (type, filters) => reports.buildReport(db, type, filters || {}));

  handle('reports:excel', async (type, filters) => {
    const title = reports.REPORTS[type]?.title || 'Report';
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export to Excel',
      defaultPath: path.join(app.getPath('documents'), `${safeFileName(title)}_${today()}.xlsx`),
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return null;
    try {
      await reports.toExcel(db, type, filters || {}, filePath);
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
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
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
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Library Backup',
      defaultPath: path.join(app.getPath('documents'), `Technical Library - CGAS Chennai Backup ${today()}.db`),
      filters: [{ name: 'Library Backup', extensions: ['db'] }],
    });
    if (canceled || !filePath) return null;
    await fsp.writeFile(filePath, db.exportBytes());
    return filePath;
  });

  handle('db:restore', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Restore Library Backup',
      properties: ['openFile'],
      filters: [{ name: 'Library Backup', extensions: ['db'] }],
    });
    if (canceled || !filePaths.length) return null;
    // Keep a safety copy of the current data before replacing it.
    const safety = path.join(app.getPath('userData'), `before-restore-${Date.now()}.db`);
    await fsp.writeFile(safety, db.exportBytes());
    db.restoreFrom(await fsp.readFile(filePaths[0]));
    session = null; // credentials may differ in the restored data
    return filePaths[0];
  });

  handle('app:info', () => ({
    version: app.getVersion(),
    dataFile: db.filePath,
  }));
}

// The app has been renamed, and each name has its own data folder. On first start under the
// current name, copy the library database from the most recent earlier folder (older copies are
// left untouched as a fallback).
const PREVIOUS_DATA_FOLDERS = ['Technical Library CGAS Chennai', 'Dornier Aircraft Publication Library', 'OTA Campus Library'];

async function carryOverOldData(dbFile) {
  if (await exists(dbFile)) return;
  for (const folder of PREVIOUS_DATA_FOLDERS) {
    const oldFile = path.join(app.getPath('appData'), folder, 'library.db');
    if (!(await exists(oldFile))) continue;
    await fsp.mkdir(path.dirname(dbFile), { recursive: true });
    await fsp.copyFile(oldFile, dbFile);
    return;
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const dbFile = path.join(app.getPath('userData'), 'library.db');
  try {
    await carryOverOldData(dbFile);
    db = await LibraryDB.open(dbFile);
  } catch (e) {
    dialog.showErrorBox(APP_TITLE, 'Could not open the library database.\n\n' + e.message);
    app.quit();
    return;
  }
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
