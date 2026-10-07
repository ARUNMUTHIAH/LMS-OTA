const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  login: call('auth:login'),
  logout: call('auth:logout'),
  loginHint: call('auth:loginHint'),
  setupNeeded: call('auth:setupNeeded'),
  setup: call('auth:setup'),
  changeCredentials: call('auth:changeCredentials'),

  listUsers: call('users:list'),
  createUser: call('users:create'),
  updateUser: call('users:update'),
  deleteUser: call('users:delete'),
  deleteUsers: call('users:deleteMany'),

  getSettings: call('settings:get'),
  setDefaultDuration: call('settings:setDuration'),

  dashboard: call('dashboard:stats'),
  overdueNow: call('dashboard:overdue'),

  searchBooks: call('books:search'),
  saveBook: call('books:save'),
  deleteBook: call('books:delete'),
  categories: call('books:categories'),
  shelfValues: call('books:shelfValues'),
  importTemplate: call('books:importTemplate'),
  importPreview: call('books:importPreview'),
  importCommit: call('books:importCommit'),
  importCancel: call('books:importCancel'),
  importErrors: call('books:importErrors'),

  lookup: call('circ:lookup'),
  issueBook: call('circ:issue'),
  returnBook: call('circ:return'),
  todaysActivity: call('circ:today'),
  borrowers: call('circ:borrowers'),
  circList: call('circ:list'),

  report: call('reports:get'),
  exportExcel: call('reports:excel'),
  exportPdf: call('reports:pdf'),

  openFile: call('shell:open'),
  showInFolder: call('shell:showInFolder'),
  openWebsite: call('shell:website'),

  backup: call('db:backup'),
  restore: call('db:restore'),
  appInfo: call('app:info'),
});
