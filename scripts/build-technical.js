// Builds the first edition, "Technical Library - CGAS Chennai" (version 1), into dist\, from a
// protected copy of the app (see scripts/build-common.js).
//
// Usage: npm run dist

const path = require('path');
const { ROOT, stageApp, edit, checkProtectBuild } = require('./build-common');

const STAGE = path.join(ROOT, '.build-technical');
const OUT = path.join(ROOT, 'dist');

stageApp(STAGE);
edit(STAGE, 'package.json', (s) => {
  const pkg = JSON.parse(s);
  pkg.build.directories.output = OUT;
  return JSON.stringify(pkg, null, 2) + '\n';
});
checkProtectBuild(STAGE);
const pkg = require('../package.json');
console.log(`\nDone: ${OUT}\\${pkg.build.productName} Setup ${pkg.version}.exe`);
