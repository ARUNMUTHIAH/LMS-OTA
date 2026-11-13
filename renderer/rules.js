// Validation rules shared by the screens (window.Rules) and the database layer (require).
// Each check takes the raw value and returns an error message, or '' when valid.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LIMITS = {
    // Barcode No is the unique key, so the database column needs a size: 768 (the most MySQL can keep unique) is far above any real
    // barcode. Description, LF / Title, CAT / Author, LOC and Rack have no length limit (TEXT columns).
    bookNo: 768,
    author: 150,
    publisher: 150,
    person: 100,
    detail: 50,
    remarks: 250,
    durationMin: 1,
    durationMax: 365,
    passwordMin: 4,
    passwordMax: 64,
  };

  const clean = (v) => (v == null ? '' : String(v)).trim().replace(/\s+/g, ' ');
  const hasLetter = (v) => /\p{L}/u.test(v);
  const tooLong = (v, max, label) => (v.length > max ? `${label} must be ${max} characters or fewer.` : '');
  // A book field value as saved: spaces tidied, and a lone hyphen ("-", "–", "—": not known yet,
  // to be filled in later) saved as blank.
  const bookValue = (v) => {
    const s = clean(v);
    return /^[-–—]+$/.test(s) ? '' : s;
  };

  const checks = {
    // Barcode No is the only required book field; Description, LF, CAT, LOC, Rack may be blank.
    bookNo(raw) {
      const v = bookValue(raw);
      if (!v) return 'Barcode No is required.';
      if (v.length > LIMITS.bookNo) return 'Barcode No is too long.';
      if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(v)) {
        return 'Barcode No can contain only letters, numbers and - / _ . (no spaces).';
      }
      return '';
    },
    author(raw) {
      const v = clean(raw);
      if (!v) return 'Author is required.';
      if (!hasLetter(v)) return 'Author name must contain letters.';
      return tooLong(v, LIMITS.author, 'Author');
    },
    publisher(raw) {
      const v = clean(raw);
      if (v && !hasLetter(v)) return 'Publisher must contain letters.';
      return tooLong(v, LIMITS.publisher, 'Publisher');
    },
    category(raw) {
      const v = bookValue(raw);
      return v && !hasLetter(v) ? 'CAT must contain letters.' : '';
    },
    person(raw, label = 'Name') {
      const v = clean(raw);
      if (!v) return `${label} is required.`;
      if (v.length < 2) return `${label} must be at least 2 characters.`;
      if (v.length > LIMITS.person) return tooLong(v, LIMITS.person, label);
      if (!hasLetter(v)) return `${label} must contain letters.`;
      if (!/^[\p{L}\p{M}0-9 .'()/-]+$/u.test(v)) {
        return `${label} can contain only letters, numbers, spaces and . ' - ( ) /`;
      }
      return '';
    },
    // Optional borrower details on an issue: Rank, Number, Dept.
    detail(raw, label) {
      const v = clean(raw);
      if (v.length > LIMITS.detail) return tooLong(v, LIMITS.detail, label);
      if (v && !/^[\p{L}\p{M}0-9 .'()/&-]+$/u.test(v)) {
        return `${label} can contain only letters, numbers, spaces and . ' - ( ) / &`;
      }
      return '';
    },
    remarks(raw) {
      return tooLong(clean(raw), LIMITS.remarks, 'Remarks');
    },
    duration(raw) {
      const s = raw == null ? '' : String(raw).trim();
      if (!s) return 'Duration is required.';
      if (!/^\d+$/.test(s)) return 'Duration must be a whole number of days.';
      const n = Number(s);
      if (n < LIMITS.durationMin || n > LIMITS.durationMax) {
        return `Duration must be between ${LIMITS.durationMin} and ${LIMITS.durationMax} days.`;
      }
      return '';
    },
    backupKeep(raw) {
      const s = raw == null ? '' : String(raw).trim();
      if (!/^\d+$/.test(s) || Number(s) < 1 || Number(s) > 365) return 'Enter a whole number from 1 to 365.';
      return '';
    },
    username(raw) {
      const v = raw == null ? '' : String(raw).trim();
      if (!v) return 'Username is required.';
      if (!/^[A-Za-z0-9._-]{3,30}$/.test(v)) {
        return 'Username must be 3–30 characters: letters, numbers, . _ - (no spaces).';
      }
      return '';
    },
    newPassword(raw) {
      const v = raw == null ? '' : String(raw);
      if (!v) return '';
      if (v.length < LIMITS.passwordMin) return `Password must be at least ${LIMITS.passwordMin} characters.`;
      if (v.length > LIMITS.passwordMax) return `Password must be ${LIMITS.passwordMax} characters or fewer.`;
      if (v !== v.trim()) return 'Password cannot start or end with a space.';
      return '';
    },
  };

  // ---------- User access: which screens and actions each account may use ----------
  // Saved per user as a comma list in users.permissions (NULL on accounts made before this: then the
  // old role decides, "viewer" = View only, anything else = Full access).
  const PERMISSIONS = [
    { key: 'dashboard', label: 'Dashboard', desc: 'Overview, due soon and overdue list' },
    { key: 'books', label: 'Book Entry — view', desc: 'Search and look at books' },
    { key: 'books_edit', label: 'Book Entry — add / edit / import', desc: 'Add books, change them, import from Excel' },
    { key: 'books_delete', label: 'Book Entry — delete', desc: 'Delete books' },
    { key: 'issue', label: 'Issue Book', desc: 'Issue books to borrowers' },
    { key: 'return', label: 'Return Book', desc: 'Receive books back' },
    { key: 'reports', label: 'Reports', desc: 'View and export reports' },
    { key: 'settings', label: 'Settings', desc: 'Users, loan rules, backup and restore, audit log' },
  ];
  const ALL = PERMISSIONS.map((p) => p.key);
  const PRESETS = [
    { key: 'full', label: 'Full access', perms: ALL },
    { key: 'staff', label: 'Counter staff', perms: ['dashboard', 'books', 'issue', 'return', 'reports'] },
    { key: 'viewer', label: 'View only', perms: ['dashboard', 'books', 'reports'] },
  ];
  const VIEW_ONLY = PRESETS[2].perms;

  // A clean, ordered list: known keys only; editing or deleting books needs the Book Entry screen.
  function normalizePerms(list) {
    const set = new Set((Array.isArray(list) ? list : String(list || '').split(',')).map((s) => String(s).trim()));
    if (set.has('books_edit') || set.has('books_delete')) set.add('books');
    return ALL.filter((k) => set.has(k));
  }
  // The permissions of a user: an account as the server sends it ({ perms: [...] }) or a users
  // table row ({ role, permissions }).
  function permsOf(user) {
    if (!user) return [];
    if (Array.isArray(user.perms)) return normalizePerms(user.perms);
    if (user.permissions != null && user.permissions !== '') return normalizePerms(user.permissions);
    return user.role === 'viewer' ? [...VIEW_ONLY] : [...ALL];
  }
  // A short name for a set of permissions: the matching preset, or "Custom".
  function accessLabel(perms) {
    const key = normalizePerms(perms).join(',');
    const p = PRESETS.find((x) => x.perms.join(',') === key);
    return p ? p.label : 'Custom';
  }
  const access = { PERMISSIONS, ALL, PRESETS, VIEW_ONLY, normalizePerms, permsOf, accessLabel };

  return { LIMITS, clean, bookValue, checks, access };
});
