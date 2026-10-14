// Builds the second edition, "General Library - CGAS Chennai" (version 2), as its own installer.
// The Technical Library build (npm run dist -> dist\) is not touched: this copies the app into a
// staging folder, renames the library and the LF / CAT labels there, and builds into dist-general\
// from a protected copy (see scripts/build-common.js).
// It installs as a separate app (own appId, install folder, shortcuts and data folder).
//
// Usage: npm run dist:general

const path = require('path');
const { ROOT, stageApp, edit: editIn, mustReplace, checkProtectBuild } = require('./build-common');

const STAGE = path.join(ROOT, '.build-general');
const OUT = path.join(ROOT, 'dist-general');

const OLD_NAME = 'Technical Library - CGAS Chennai';
const NEW_NAME = 'General Library - CGAS Chennai';
const VERSION = '2.5.0';

stageApp(STAGE);
const edit = (rel, fn) => editIn(STAGE, rel, fn);

// ---------- Library name ----------
const textFiles = ['main.js', 'src/reports.js', 'src/importer.js', 'renderer/index.html', 'test/smoke.js'];
for (const rel of textFiles) edit(rel, (s) => s.split(OLD_NAME).join(NEW_NAME));

// A separate library on the same server: version 2 uses the general_* tables.
edit('src/remote.js', (s) => mustReplace(s, "const EDITION = 'technical';", "const EDITION = 'general';"));
// Its own unique id (software key) in the license request / license file; the software name
// (IssueReturn) is the same as version 1's. The key is a constant of version 2: licenses are
// issued for it, so never change it.
const GENERAL_SOFTWARE_KEY = 'l8prutppkpq5scv15r5e612bslqmy516otfczgcocwi5e18epuaiu1gbwwg1gsqeeq0wt3zvs7nsgc701p92tdesrx166fl5wfpn0946el7u5s7l2l8vs6zsfod0gjuhjm07laewtgpia17wwpq4a27or8tvxr3ccvqq2vumky12bfavvogn6juji2afgdy58netave1hq2p73ud7tyv126f5fgnjq2j53dyd6eld2bqs8u9sepwi0f0nkhfi9dfm63mya2k46l5ian45oahjmwsnt41izi3rkidj5dme34y1ulj1fr3io9usuncnzmf3jhul0fwwegc4ab7t40412m8o06v0blk21ps4kxulhl9dbckfzv71zalxy1sa4c62pv9i3qsnf25olunvzwipj1wfr0aw06l9sqee9qwddjqirxf0p2jx7p4b2nw4r6pd54jahslzv6v9x1as2snbpb7pgk8wexcftcdl6tvw8080ubrqs9stcu2a7g6yub8o2ufnknu09';
edit('src/license.js', (s) => {
  const keyLine = /^const SOFTWARE_KEY = '[a-z0-9]+';$/m;
  if (!keyLine.test(s)) throw new Error('Expected text not found: const SOFTWARE_KEY');
  return s.replace(keyLine, () => `const SOFTWARE_KEY = '${GENERAL_SOFTWARE_KEY}';`);
});

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

// ---------- Check, protect, then build ----------
checkProtectBuild(STAGE);
console.log(`\nDone: ${OUT}\\${NEW_NAME} Setup ${VERSION}.exe`);
