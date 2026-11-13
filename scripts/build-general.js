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
const VERSION = '1.0.0';

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

// ---------- Book fields: Serial No, LF, Book Name, Author, Version, LOC ----------
// Same columns as version 1, other names: book_no = Serial No, name = Book Name, category = Author,
// rack = Version (version 2 has no Rack). LF and LOC keep their names. No length limits (as version 1).

// Replaces a run of whole lines, whatever the file's line endings are.
const lines = (s, from, to) => {
  const nl = s.includes('\r\n') ? '\r\n' : '\n';
  return mustReplace(s, from.join(nl), to.join(nl));
};

// 1. Field order. These edits match version 1's text, so they run before the renaming below.
edit('renderer/books.js', (s) => {
  s = mustReplace(
    s,
    '<th>Barcode No</th><th>LF</th><th>CAT</th><th>Description of Manual</th><th>LOC</th><th>Rack</th>',
    '<th>Serial No</th><th>LF</th><th>Book Name</th><th>Author</th><th>Version</th><th>LOC</th>'
  );
  s = lines(
    s,
    [
      `            <td class="nowrap">\${esc(b.category) || '<span class="muted">—</span>'}</td>`,
      '            <td class="strong wrap">${esc(b.name)}</td>',
      `            <td class="nowrap">\${esc(b.location) || '<span class="muted">—</span>'}</td>`,
      `            <td class="nowrap">\${esc(b.rack) || '<span class="muted">—</span>'}</td>`,
    ],
    [
      '            <td class="strong wrap">${esc(b.name)}</td>',
      `            <td class="nowrap">\${esc(b.category) || '<span class="muted">—</span>'}</td>`,
      `            <td class="nowrap">\${esc(b.rack) || '<span class="muted">—</span>'}</td>`,
      `            <td class="nowrap">\${esc(b.location) || '<span class="muted">—</span>'}</td>`,
    ]
  );
  s = mustReplace(
    s,
    'Columns: Barcode No, LF, CAT, Description of Manual, LOC, Rack. Only Barcode No is required; a cell with just - is saved as blank.',
    'Columns: Serial No, LF, Book Name, Author, Version, LOC. Only Serial No is required; a cell with just - is saved as blank.'
  );
  // Book entry form, in the order Serial No, LF, Book Name, Author, Version, LOC.
  return lines(
    s,
    [
      `      <label class="field"><span>Barcode No <em>*</em></span><input name="book_no" spellcheck="false" value="\${esc(b.book_no)}" placeholder="e.g. OTA-0001" />`,
      '        <span class="hint">Must be unique. Letters, numbers and - / _ . only.</span></label>',
      '      <div class="row-2">',
      '        <label class="field"><span>LF</span><input name="lf" spellcheck="false" value="${esc(b.lf)}" placeholder="e.g. 001-06" /></label>',
      '        <label class="field"><span>CAT</span><input name="category" spellcheck="false" value="${esc(b.category)}" placeholder="e.g. DOR-MM" /></label>',
      '      </div>',
      '      <label class="field"><span>Description of Manual</span><input name="name" value="${esc(b.name)}" placeholder="e.g. Airplane Maintenance Manual Vol-I (CG-780)" /></label>',
      '      <div class="row-2">',
      '        <label class="field"><span>LOC</span><input name="location" spellcheck="false" value="${esc(b.location)}" placeholder="e.g. B2" /></label>',
      '        <label class="field"><span>Rack</span><input name="rack" spellcheck="false" value="${esc(b.rack)}" placeholder="e.g. 6" /></label>',
      '      </div>',
    ],
    [
      '      <div class="row-2">',
      `        <label class="field"><span>Serial No <em>*</em></span><input name="book_no" spellcheck="false" value="\${esc(b.book_no)}" placeholder="e.g. GEN-0001" />`,
      '          <span class="hint">Must be unique. Letters, numbers and - / _ . only.</span></label>',
      '        <label class="field"><span>LF</span><input name="lf" spellcheck="false" value="${esc(b.lf)}" placeholder="e.g. 001-06" /></label>',
      '      </div>',
      '      <label class="field"><span>Book Name</span><input name="name" value="${esc(b.name)}" placeholder="e.g. Wings of Fire" /></label>',
      '      <div class="row-3">',
      '        <label class="field"><span>Author</span><input name="category" spellcheck="false" value="${esc(b.category)}" placeholder="e.g. A. P. J. Abdul Kalam" /></label>',
      '        <label class="field"><span>Version</span><input name="rack" spellcheck="false" value="${esc(b.rack)}" placeholder="e.g. 2nd Edition" /></label>',
      '        <label class="field"><span>LOC</span><input name="location" spellcheck="false" value="${esc(b.location)}" placeholder="e.g. B2" /></label>',
      '      </div>',
    ]
  );
});
edit('src/importer.js', (s) => {
  // Accepted Excel headers; the order is also the column order of the "..._not_imported" file.
  s = s.replace(/const FIELDS = \[[\s\S]*?\r?\n\];/, () =>
    [
      'const FIELDS = [',
      "  { key: 'book_no', label: 'Serial No', required: true, aliases: ['serialno', 'serialnumber', 'barcodeno', 'barcodenumber', 'barcode', 'accessionno', 'accessionnumber', 'accession', 'accno', 'accnumber'] },",
      "  { key: 'lf', label: 'LF', aliases: ['lf', 'lfno'] },",
      "  { key: 'name', label: 'Book Name', aliases: ['bookname', 'booktitle', 'title', 'descriptionofmanual', 'descriptionsofmanual', 'description', 'descriptions', 'manual'] },",
      "  { key: 'category', label: 'Author', aliases: ['author', 'authors', 'authorname', 'cat', 'category'] },",
      "  { key: 'rack', label: 'Version', aliases: ['version', 'edition', 'ver', 'rack', 'rackno', 'racknumber'] },",
      "  { key: 'location', label: 'LOC', aliases: ['loc', 'location'] },",
      '];',
    ].join('\n')
  );
  if (!s.includes("label: 'Version'")) throw new Error('Expected text not found: const FIELDS');
  s = lines(
    s,
    [
      "    { header: 'Barcode No', width: 16 },",
      "    { header: 'LF', width: 12 },",
      "    { header: 'CAT', width: 12 },",
      "    { header: 'Description of Manual', width: 56 },",
      "    { header: 'LOC', width: 10 },",
      "    { header: 'Rack', width: 10 },",
    ],
    [
      "    { header: 'Serial No', width: 16 },",
      "    { header: 'LF', width: 12 },",
      "    { header: 'Book Name', width: 48 },",
      "    { header: 'Author', width: 28 },",
      "    { header: 'Version', width: 14 },",
      "    { header: 'LOC', width: 10 },",
    ]
  );
  s = lines(
    s,
    [
      "  ws.addRow(['OTA-0001', '001-06', 'DOR-MM', 'AIRPLANE MAINTENANCE MANUAL VOL-I (CG-780)', 'B2', '6']);",
      "  ws.addRow(['OTA-0002', '001-07', 'DOR-MM', 'AIRPLANE MAINTENANCE MANUAL VOL-I (CG-786)', 'B2', '6']);",
    ],
    [
      "  ws.addRow(['GEN-0001', '001-06', 'WINGS OF FIRE', 'A. P. J. ABDUL KALAM', '1ST EDITION', 'B2']);",
      "  ws.addRow(['GEN-0002', '001-07', 'IGNITED MINDS', 'A. P. J. ABDUL KALAM', '2ND EDITION', 'B2']);",
    ]
  );
  return lines(
    s,
    [
      "    ['Barcode No *', 'Required. Must be unique (not already in the library, not repeated in the file). Letters, numbers and - / _ . only, no spaces.'],",
      "    ['LF', 'Optional, e.g. 001-06.'],",
      "    ['CAT', 'Optional. Must contain letters, e.g. DOR-MM.'],",
      "    ['Description of Manual', 'Optional.'],",
      "    ['LOC', 'Optional, e.g. B2.'],",
      "    ['Rack', 'Optional, e.g. 6.'],",
    ],
    [
      "    ['Serial No *', 'Required. Must be unique (not already in the library, not repeated in the file). Letters, numbers and - / _ . only, no spaces.'],",
      "    ['LF', 'Optional, e.g. 001-06.'],",
      "    ['Book Name', 'Optional.'],",
      "    ['Author', 'Optional. Must contain letters.'],",
      "    ['Version', 'Optional, e.g. 2nd Edition.'],",
      "    ['LOC', 'Optional, e.g. B2.'],",
    ]
  );
});
edit('src/reports.js', (s) => {
  s = lines(
    s,
    [
      "      { key: 'category', label: 'CAT', width: 12 },",
      "      { key: 'name', label: 'Description of Manual', width: 48 },",
      "      { key: 'location', label: 'LOC', width: 8 },",
      "      { key: 'rack', label: 'Rack', width: 8 },",
    ],
    [
      "      { key: 'name', label: 'Book Name', width: 40 },",
      "      { key: 'category', label: 'Author', width: 22 },",
      "      { key: 'rack', label: 'Version', width: 12 },",
      "      { key: 'location', label: 'LOC', width: 8 },",
    ]
  );
  return lines(
    s,
    ["      parts.push(`LOC: ${f.location || 'All'}`);", "      parts.push(`Rack: ${f.rack || 'All'}`);"],
    ["      parts.push(`Rack: ${f.rack || 'All'}`);", "      parts.push(`LOC: ${f.location || 'All'}`);"]
  );
});
edit('renderer/circulation.js', (s) =>
  mustReplace(
    s,
    "${spec('LF', b.lf)}${spec('CAT', b.category)}${spec('LOC', b.location)}${spec('Rack', b.rack)}",
    "${spec('LF', b.lf)}${spec('Author', b.category)}${spec('Version', b.rack)}${spec('LOC', b.location)}"
  )
);
edit('renderer/index.html', (s) =>
  lines(
    s,
    [
      '            <label class="field inline"><span>LOC</span><select id="rf-location" class="select"><option value="">All</option></select></label>',
      '            <label class="field inline"><span>Rack</span><select id="rf-rack" class="select"><option value="">All</option></select></label>',
    ],
    [
      '            <label class="field inline"><span>Rack</span><select id="rf-rack" class="select"><option value="">All</option></select></label>',
      '            <label class="field inline"><span>LOC</span><select id="rf-location" class="select"><option value="">All</option></select></label>',
    ]
  )
);

// No S.No column beside Serial No (books list, issue / return records, overdue list, reports and
// their print-out). The audit log and the users list keep theirs: they have no Serial No.
const noSNo = (s, cells) => cells.reduce((acc, [from, to]) => mustReplace(acc, from, to), s);
for (const rel of ['renderer/books.js', 'renderer/dashboard.js', 'renderer/circulation.js', 'renderer/reports.js']) {
  edit(rel, (s) =>
    noSNo(s, [
      ['<th class="idx">S.No</th>', ''],
      ['<td class="idx muted">${start + i + 1}</td>', ''],
    ])
  );
}
edit('src/reports.js', (s) =>
  noSNo(s, [
    ['<tr><td class="idx">${i + 1}</td>${rep.columns', '<tr>${rep.columns'],
    ['<th class="idx">S.No</th>${head}', '${head}'],
    ['colspan="${rep.columns.length + 1}"', 'colspan="${rep.columns.length}"'],
  ])
);
edit('test/smoke.js', (s) =>
  mustReplace(
    s,
    "assert.ok((await reports.toHtml(db, 'books', {})).includes('>S.No</th>'), 'PDF report numbers rows under S.No');",
    "assert.ok(!(await reports.toHtml(db, 'books', {})).includes('>S.No</th>'), 'version 2: no S.No column in the PDF report');"
  )
);

// 2. Names everywhere else: lists, reports, messages, audit log, import checks, tests.
const labelFiles = [
  'renderer/index.html',
  'renderer/app.js',
  'renderer/books.js',
  'renderer/circulation.js',
  'renderer/dashboard.js',
  'renderer/reports.js',
  'renderer/rules.js',
  'server/audit.js',
  'src/reports.js',
  'src/importer.js',
  'src/database.js',
  'test/smoke.js',
];
const screenFiles = new Set(['renderer/index.html', 'renderer/circulation.js', 'renderer/dashboard.js']);
for (const rel of labelFiles) {
  edit(rel, (s) => {
    s = s
      .replace(/\bBarcode No/g, 'Serial No')
      .replace(/\bDescription of Manual\b/g, 'Book Name')
      .replace(/\bDescription\b/g, 'Book Name')
      .replace(/\bCAT\b/g, 'Author')
      .replace(/\bRack\b/g, 'Version');
    // Search box hints ("Search barcode no, description or ..."); not in import header spellings.
    if (screenFiles.has(rel)) s = s.replace(/\bbarcode no\b/g, 'serial no').replace(/\bdescription\b/g, 'book name');
    return s;
  });
}
// Messages from the library server (worded for version 1) shown with version 2's names.
edit('src/remote.js', (s) =>
  mustReplace(
    s,
    'const RELABEL = [];',
    "const RELABEL = [['Barcode No', 'Serial No'], ['Description of Manual', 'Book Name'], ['CAT must', 'Author must']];"
  )
);

// Shown name: "2CQR GARUDA" everywhere, as in version 1. Only the short tag differs (backup
// file names). NEW_NAME above stays internal: it names version 2's data folder in main.js.
edit('main.js', (s) => mustReplace(s, "const EDITION_TAG = 'Manuals';", "const EDITION_TAG = 'Books';"));

// ---------- Package / installer identity ----------
// Windows needs the two apps to differ: "2CQR GARUDA (2)" in Apps, shortcuts and the installer.
const PRODUCT = '2CQR GARUDA (2)';
const ARTIFACT = '2CQR-GARUDA-Books Setup ${version}.exe';
edit('package.json', (s) => {
  const pkg = JSON.parse(s);
  pkg.name = 'general-library';
  pkg.version = VERSION;
  pkg.productName = PRODUCT;
  pkg.description = '2CQR GARUDA — CGAS Chennai (Books)';
  pkg.build.appId = 'com.otacampus.generallibrary';
  pkg.build.productName = PRODUCT;
  pkg.build.executableName = 'CGAS-General';
  pkg.build.directories.output = OUT;
  pkg.build.nsis.shortcutName = PRODUCT;
  pkg.build.nsis.artifactName = ARTIFACT;
  return JSON.stringify(pkg, null, 2) + '\n';
});

// ---------- Check, protect, then build ----------
checkProtectBuild(STAGE);
console.log(`\nDone: ${OUT}\\${ARTIFACT.replace('${version}', VERSION)}`);
