// Software license: the app opens only with an approved license file whose expiry date has not passed.
//
// How a library gets a license:
//  1. On the License screen the librarian enters the Client ID (kept until they change it).
//  2. The app shows a request code: "[LM-REQ] <client id>|web|<software name>|<software key>".
//     The software key (unique id) is a fixed constant of each version: the same on every
//     computer, never regenerated. Version 1 (Technical) and version 2 (General) share the
//     software name but each has its own key (scripts/build-general.js sets version 2's).
//  3. The librarian emails the request code to the administrator, who sends back a license file:
//     { "success": true, "data": { "signature": { "payload": { client_id, software_key, status,
//       expiry_date, ... }, "sig": "..." } } }
//  4. The file is loaded from the License screen (kept encrypted in the data folder, replacing
//     the one there, so a renewal needs no other step), or pasted into the app's install folder: any
//     *.lmlic file (e.g. IssueReturn_93.lmlic), or license*.json / licence*.json / .lic / .txt.
//
// A license opens the app when: status is Approved, the software key and Client ID are this
// version's / the entered one, the software name and platform are this app's, and today <= expiry_date.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { today, isValidDate } = require('./dates');

// The same name in both versions (Technical and General); the unique id tells them apart.
const SOFTWARE_NAME = 'IssueReturn';
// The unique id of this version. Constant: licenses are issued for it, so never change it.
const SOFTWARE_KEY = 'yjb4ujuzwfcwr6ei25g60o75wc3gzzjofkcdf4813ebaw4odclzeccpe6yuzhyxuenfj2jywn95cfpqlyl4limp9wn8bhrth4olr4zuhgdg7g1rgfflbyy8i52ier5wlh5ez07mhrex9n8vqvsf88tnplthrfmuejz2q5ty8xam4po10x9m2j0xudp1ohn6ohdv98oxwdsp7wc3onsodnyzeepyp6yt7qd09kk5fjsnwq3x990s3utsq90libpaia3t0knabqab6wiflyqhaoerxkymstuzqrtwkivqk8fbhbw6byfvofk7hranosppod2jczgozpep1n8gae4l1po377om9hiqa9iaa1s04jzfghjadxzxzg617yxjx284nfjbg00s1nc1ghtz156ut9mxp3gfbsio9f5w0lq24rng6oveteyn8x1dbxq6v27g1dhuzu3pswvh5a2dmedw2fj1phdmw02kkcggvpj0zqnvdmmiut792k4h9hs0eo8dr2qn9i5ev8a';
// Always 'web', in both versions (Technical and General): the administrator's license system expects it.
const PLATFORM = 'web';
const REQUEST_PREFIX = '[LM-REQ]';
// The license server's secret for "sig" (HMAC-SHA256 of the payload, base64). The same in both
// versions. Set: any change to a license file (expiry date, status, ...) makes "sig" wrong and
// the file is refused. Empty: "sig" must be present but cannot be checked.
const LICENSE_SECRET = '';

const IDENTITY_FILE = 'license-id.json';
// The loaded license is kept encrypted (AES-256-GCM): it cannot be read, and any change to the
// file (e.g. a new expiry date) makes it fail to open, so it no longer counts as a license.
const INSTALLED_FILE = 'license.dat';
const OLD_INSTALLED_FILE = 'license.json'; // readable copies kept by earlier builds: removed
const STORE_SECRET = '25354ae15786c723eb3c4f27fe9b35e151be5c8b485dd6e3da6afade0753a8b5';
const STORE_DAMAGED = 'The saved license has been changed or damaged. Load the license file again.';
// The administrator's file is <software name>_<license id>.lmlic (JSON inside); older names also work.
const LICENSE_NAME = /(\.lmlic|^licen[cs]e.*\.(json|lic|txt))$/i;
const MAX_FILE = 64 * 1024;

class LicenseError extends Error {}

const storeKey = () => crypto.createHash('sha256').update(`${STORE_SECRET}:${SOFTWARE_KEY}`).digest();

function seal(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', storeKey(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

// The text sealed by seal(), or null when the file was changed.
function unseal(b64) {
  try {
    const raw = Buffer.from(b64.trim(), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', storeKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function cleanClientId(v) {
  const id = String(v ?? '').trim();
  if (!id) throw new LicenseError('Enter the Client ID.');
  if (id.length > 50 || !/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(id)) {
    throw new LicenseError('Client ID can have letters, numbers, spaces, - _ . (up to 50 characters).');
  }
  return id;
}

// The { payload, sig } part of a license file, whichever way it is wrapped.
function unwrap(json) {
  const sig = json?.data?.signature ?? json?.signature ?? json;
  if (!sig || typeof sig !== 'object' || !sig.payload || typeof sig.payload !== 'object') return null;
  return sig;
}

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// The payload as the server may have signed it: fields in file order, or sorted by name.
function signedForms(payload) {
  const sorted = Object.fromEntries(Object.keys(payload).sort().map((k) => [k, payload[k]]));
  return [JSON.stringify(payload), JSON.stringify(sorted)];
}

function signatureOk(payload, sig) {
  if (typeof sig !== 'string' || !sig.trim()) return false;
  if (!LICENSE_SECRET) return true;
  const got = Buffer.from(sig, 'base64');
  return signedForms(payload).some((form) => {
    const want = crypto.createHmac('sha256', LICENSE_SECRET).update(form).digest();
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  });
}

class LicenseManager {
  // dataDir: the app's data folder (identity and loaded license). rootDirs: folders where a
  // license file may be pasted by hand (the install folder).
  constructor({ dataDir, rootDirs = [] }) {
    this.dataDir = dataDir;
    this.rootDirs = rootDirs;
    fs.rmSync(path.join(dataDir, OLD_INSTALLED_FILE), { force: true });
    this.identity = null; // { clientId, softwareKey }
    this.best = null; // the most useful license found: { payload, file, error }
    this.reload();
  }

  identityFile() {
    return path.join(this.dataDir, IDENTITY_FILE);
  }

  loadIdentity() {
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(this.identityFile(), 'utf8'));
    } catch {
      saved = null;
    }
    const clientId = saved && typeof saved.clientId === 'string' ? saved.clientId : '';
    this.identity = { clientId, softwareKey: SOFTWARE_KEY };
  }

  saveIdentity() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.identityFile(), JSON.stringify({ clientId: this.identity.clientId }, null, 2));
  }

  // Checks one license file. Returns { payload, error } where error is '' for a usable license
  // (its expiry date is checked separately, on every call, so it ends at midnight).
  check(json) {
    const sig = unwrap(json);
    if (!sig) return { payload: null, error: 'This is not a license file.' };
    const p = sig.payload;
    if (!signatureOk(p, sig.sig)) return { payload: p, error: 'The license file is damaged or has been changed.' };
    if (!same(p.status, 'Approved')) return { payload: p, error: `The license is not approved (status: ${p.status || 'none'}).` };
    if (p.software_key !== this.identity.softwareKey) return { payload: p, error: 'This license was issued for a different software key.' };
    if (!same(p.software_name ?? p.key, SOFTWARE_NAME)) return { payload: p, error: 'This license is for different software.' };
    if (p.platform != null && !same(p.platform, PLATFORM)) return { payload: p, error: 'This license is for a different platform.' };
    if (this.identity.clientId && !same(p.client_id, this.identity.clientId)) {
      return { payload: p, error: `This license is for Client ID “${p.client_id}”, not “${this.identity.clientId}”.` };
    }
    if (!isValidDate(p.expiry_date)) return { payload: p, error: 'The license has no valid expiry date.' };
    return { payload: p, error: '' };
  }

  candidateFiles() {
    const files = [path.join(this.dataDir, INSTALLED_FILE)];
    for (const dir of this.rootDirs) {
      let names = [];
      try {
        names = fs.readdirSync(dir).filter((n) => LICENSE_NAME.test(n));
      } catch {
        names = [];
      }
      for (const n of names) files.push(path.join(dir, n));
    }
    return [...new Set(files)];
  }

  // Reads the identity and every license file; keeps the best one: a working license with the
  // latest expiry, else an expired one (so the screen can say "expired"), else the first error.
  reload() {
    this.loadIdentity();
    let best = null;
    const rank = (c) => (!c.error ? (c.payload.expiry_date >= today() ? 3 : 2) : 1);
    const saved = path.join(this.dataDir, INSTALLED_FILE);
    for (const file of this.candidateFiles()) {
      let json;
      let damaged = false;
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > MAX_FILE) continue;
        let text = fs.readFileSync(file, 'utf8');
        if (file === saved) {
          text = unseal(text);
          damaged = text == null;
        }
        json = damaged ? null : JSON.parse(text);
      } catch (e) {
        if (e.code === 'ENOENT') continue;
        json = null;
      }
      const c = damaged ? { payload: null, error: STORE_DAMAGED, file } : { ...this.check(json), file };
      if (!best || rank(c) > rank(best) || (rank(c) === rank(best) && !c.error && c.payload.expiry_date > best.payload.expiry_date)) best = c;
    }
    this.best = best;
    return this.status();
  }

  // What the License screen shows. state: valid | expired | invalid | missing.
  status() {
    const { clientId } = this.identity;
    const base = { clientId, softwareName: SOFTWARE_NAME, platform: PLATFORM, renewal: !!this.best && !!this.best.payload };
    const b = this.best;
    if (!b) return { ...base, valid: false, state: 'missing', message: 'A license is required to use this software.' };
    if (b.error) return { ...base, valid: false, state: 'invalid', message: b.error };
    const p = b.payload;
    const info = { ...base, expiryDate: p.expiry_date, licensedTo: p.institute_name || p.client_id || '', licenseId: p.license_id ?? null };
    if (p.expiry_date < today()) return { ...info, valid: false, state: 'expired', message: `The license expired on ${p.expiry_date}.` };
    return { ...info, valid: true, state: 'valid', message: '' };
  }

  isValid() {
    return this.status().valid;
  }

  // Saves the Client ID and returns the code to email to the administrator.
  requestCode(clientId) {
    const id = cleanClientId(clientId);
    if (id !== this.identity.clientId) {
      this.identity.clientId = id;
      this.saveIdentity();
      this.reload();
    }
    return `${REQUEST_PREFIX} ${id}|${PLATFORM}|${SOFTWARE_NAME}|${this.identity.softwareKey}`;
  }

  // Checks a license file's text and, if it works, keeps it in the data folder.
  install(text) {
    if (typeof text !== 'string' || text.length > MAX_FILE) throw new LicenseError('This is not a license file.');
    let json;
    try {
      json = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      throw new LicenseError('This is not a license file (it could not be read as JSON).');
    }
    const c = this.check(json);
    if (c.error) throw new LicenseError(c.error);
    if (c.payload.expiry_date < today()) throw new LicenseError(`This license expired on ${c.payload.expiry_date}. Ask the administrator for a renewed license.`);
    if (!this.identity.clientId && c.payload.client_id) {
      this.identity.clientId = String(c.payload.client_id);
      this.saveIdentity();
    }
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(path.join(this.dataDir, INSTALLED_FILE), seal(JSON.stringify(json)));
    return this.reload();
  }
}

module.exports = { LicenseManager, LicenseError, SOFTWARE_NAME, SOFTWARE_KEY, PLATFORM, REQUEST_PREFIX };
