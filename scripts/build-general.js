// Builds the second edition, "General Library - CGAS Chennai" (version 2), as its own installer.
// The Technical Library build (npm run dist -> dist\) is not touched: this copies the app into a
// staging folder, renames the library and the LF / CAT labels there, and builds into dist-general\.
// It installs as a separate app (own appId, install folder, shortcuts and data folder).
//
// Usage: npm run dist:general

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STAGE = path.join(ROOT, '.build-general');
const OUT = path.join(ROOT, 'dist-general');

const OLD_NAME = 'Technical Library - CGAS Chennai';
const NEW_NAME = 'General Library - CGAS Chennai';
const VERSION = '2.5.0';

// ---------- Stage a copy of the app ----------
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE);
for (const item of ['main.js', 'preload.js', 'package.json', 'src', 'renderer', 'test', 'build']) {
  fs.cpSync(path.join(ROOT, item), path.join(STAGE, item), { recursive: true });
}
for (const item of ['server/api.js', 'server/library-db.js', 'db-config.json']) fs.cpSync(path.join(ROOT, item), path.join(STAGE, item));
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(STAGE, 'node_modules'), 'junction');

function edit(rel, fn) {
  const file = path.join(STAGE, rel);
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  fs.writeFileSync(file, after);
}

function mustReplace(s, from, to) {
  if (!s.includes(from)) throw new Error(`Expected text not found: ${from}`);
  return s.split(from).join(to);
}

// ---------- Library name ----------
const textFiles = ['main.js', 'src/reports.js', 'src/importer.js', 'renderer/index.html', 'test/smoke.js'];
for (const rel of textFiles) edit(rel, (s) => s.split(OLD_NAME).join(NEW_NAME));

// A separate library on the same server: version 2 uses the general_* tables.
edit('src/remote.js', (s) => mustReplace(s, "const EDITION = 'technical';", "const EDITION = 'general';"));

// ---------- Labels: LF -> Title, CAT -> Author ----------
const labelFiles = [
  'renderer/index.html',
  'renderer/books.js',
  'renderer/circulation.js',
  'renderer/reports.js',
  'renderer/rules.js',
  'src/reports.js',
  'src/importer.js',
  'test/smoke.js',
];
for (const rel of labelFiles) {
  edit(rel, (s) => s.replace(/\bLF\b/g, 'Title').replace(/\bCAT\b/g, 'Author'));
}
// Import: "Title" / "Author" column headers now belong to these two fields.
edit('src/importer.js', (s) => {
  s = mustReplace(s, "aliases: ['lf', 'lfno']", "aliases: ['title', 'lf', 'lfno']");
  s = mustReplace(s, "aliases: ['cat', 'category']", "aliases: ['author', 'cat', 'category']");
  return mustReplace(s, "'descriptions', 'title', 'bookname'", "'descriptions', 'bookname'");
});

// ---------- Package / installer identity ----------
edit('package.json', (s) => {
  const pkg = JSON.parse(s);
  pkg.name = 'general-library';
  pkg.version = VERSION;
  pkg.productName = NEW_NAME;
  pkg.description = `${NEW_NAME} — Library Management System`;
  pkg.build.appId = 'com.otacampus.generallibrary';
  pkg.build.productName = NEW_NAME;
  pkg.build.executableName = 'CGAS-General';
  pkg.build.directories.output = OUT;
  pkg.build.nsis.shortcutName = NEW_NAME;
  return JSON.stringify(pkg, null, 2) + '\n';
});

// ---------- Check, then build ----------
const run = (cmd) => execSync(cmd, { cwd: STAGE, stdio: 'inherit' });
run('node test/smoke.js');
run('npx electron-builder --win nsis --x64');
console.log(`\nDone: ${OUT}\\${NEW_NAME} Setup ${VERSION}.exe`);
