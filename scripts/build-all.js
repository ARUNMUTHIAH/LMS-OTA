// Builds one setup exe for both libraries: "2CQR GARUDA Setup <version>.exe" in
// dist-all\. When run, it asks which software to install (Manuals or Books library), then runs
// that software's own installer, so the install flow, app name, folders, license and data stay
// exactly as with the separate installers (see build/chooser.nsi).
//
// Usage: npm run dist:all                (builds both installers first, then the setup exe)
//        npm run dist:all -- --skip-build  (wraps the installers already in dist\ and dist-general\)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist-all');
const PRODUCT = '2CQR GARUDA';
const VERSION = require('../package.json').version;

const run = (args) => execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });

if (!process.argv.includes('--skip-build')) {
  run([path.join(__dirname, 'build-technical.js')]);
  run([path.join(__dirname, 'build-general.js')]);
}

// The newest "<name> Setup <version>.exe" in a folder.
function newestSetup(dir, name) {
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.startsWith(`${name} Setup `) && f.endsWith('.exe') && !f.includes('__uninstaller'))
    : [];
  if (!files.length) throw new Error(`No "${name} Setup *.exe" in ${dir}. Build it first (npm run dist / npm run dist:general).`);
  return files.map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

// makensis.exe from electron-builder's NSIS download (it builds the inner installers with it).
function findMakensis() {
  const cache = process.env.ELECTRON_BUILDER_CACHE || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache');
  const dir = path.join(cache, 'nsis');
  const found = fs.existsSync(dir)
    ? fs.readdirSync(dir).map((d) => path.join(dir, d, 'makensis.exe')).filter((p) => fs.existsSync(p))
    : [];
  if (!found.length) throw new Error(`makensis.exe not found under ${dir}. Run "npm run dist" once so electron-builder downloads NSIS.`);
  return found.sort().pop();
}

const tech = newestSetup(path.join(ROOT, 'dist'), '2CQR-GARUDA-Manuals');
const general = newestSetup(path.join(ROOT, 'dist-general'), '2CQR-GARUDA-Books');
fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, `${PRODUCT} Setup ${VERSION}.exe`);

console.log(`\nWrapping:\n  ${tech}\n  ${general}`);
execFileSync(
  findMakensis(),
  [
    '/V2',
    `/DTECH_SETUP=${tech}`,
    `/DGENERAL_SETUP=${general}`,
    `/DOUT=${out}`,
    `/DICON=${path.join(ROOT, 'build', 'icon.ico')}`,
    `/DVERSION=${VERSION}`,
    path.join(ROOT, 'build', 'chooser.nsi'),
  ],
  { cwd: ROOT, stdio: 'inherit' }
);
console.log(`\nDone: ${out}`);
