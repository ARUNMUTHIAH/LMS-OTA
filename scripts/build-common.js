// Shared build steps for both installers (scripts/build-technical.js, scripts/build-general.js).
// The installer never ships readable source: the app is copied into a staging folder, the
// database settings are built into main.js (no db-config.json in the package), and every app
// script is obfuscated there. The project's own files are not touched.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// Copies what the app needs into `stage` (emptied first).
function stageApp(stage) {
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage);
  for (const item of ['main.js', 'preload.js', 'package.json', 'src', 'renderer', 'test', 'build']) {
    fs.cpSync(path.join(ROOT, item), path.join(stage, item), { recursive: true });
  }
  fs.mkdirSync(path.join(stage, 'server'));
  for (const item of ['server/api.js', 'server/library-db.js', 'db-config.json']) {
    if (fs.existsSync(path.join(ROOT, item))) fs.cpSync(path.join(ROOT, item), path.join(stage, item));
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(stage, 'node_modules'), 'junction');
}

function edit(stage, rel, fn) {
  const file = path.join(stage, rel);
  fs.writeFileSync(file, fn(fs.readFileSync(file, 'utf8')));
}

function mustReplace(s, from, to) {
  if (!s.includes(from)) throw new Error(`Expected text not found: ${from}`);
  return s.split(from).join(to);
}

// Scripts that go into the installer (tests and build scripts do not).
function appScripts(stage) {
  const list = ['main.js', 'preload.js', 'server/api.js', 'server/library-db.js'];
  for (const dir of ['src', 'renderer']) {
    for (const name of fs.readdirSync(path.join(stage, dir))) if (name.endsWith('.js')) list.push(`${dir}/${name}`);
  }
  return list.filter((rel) => fs.existsSync(path.join(stage, rel)));
}

const OBFUSCATE = {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false, // screen scripts share one global scope (renderer/start.js); see protect()
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 1,
  splitStrings: true,
  splitStringsChunkLength: 8,
  transformObjectKeys: false,
  controlFlowFlattening: false, // keeps searches and reports fast
  deadCodeInjection: false,
  selfDefending: false,
  unicodeEscapeSequence: false,
};

function protect(stage) {
  // Database settings: into main.js (then obfuscated) instead of a readable db-config.json.
  const cfgFile = path.join(stage, 'db-config.json');
  if (fs.existsSync(cfgFile)) {
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    edit(stage, 'main.js', (s) => mustReplace(s, "await readJson(path.join(__dirname, 'db-config.json'))", JSON.stringify(cfg)));
    fs.rmSync(cfgFile);
  }
  edit(stage, 'package.json', (s) => {
    const pkg = JSON.parse(s);
    pkg.build.files = pkg.build.files.filter((f) => f !== 'db-config.json');
    return JSON.stringify(pkg, null, 2) + '\n';
  });

  const JavaScriptObfuscator = require('javascript-obfuscator');
  for (const rel of appScripts(stage)) {
    const target = rel.startsWith('renderer/') ? 'browser' : 'node';
    edit(stage, rel, (code) => JavaScriptObfuscator.obfuscate(code, { ...OBFUSCATE, target, renameGlobals: target === 'node' }).getObfuscatedCode());
  }
}

// Test the staged copy, protect it, test the protected copy, then build the installer.
function checkProtectBuild(stage) {
  const run = (cmd) => execSync(cmd, { cwd: stage, stdio: 'inherit' });
  run('node test/smoke.js');
  protect(stage);
  run('node test/smoke.js');
  run('npx electron-builder --win nsis --x64');
}

module.exports = { ROOT, stageApp, edit, mustReplace, checkProtectBuild };
