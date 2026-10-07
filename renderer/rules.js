// Validation rules shared by the screens (window.Rules) and the database layer (require).
// Each check takes the raw value and returns an error message, or '' when valid.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LIMITS = {
    bookNo: 50,
    bookName: 200,
    author: 150,
    publisher: 150,
    category: 100,
    lf: 30,
    location: 30,
    rack: 30,
    person: 100,
    remarks: 250,
    durationMin: 1,
    durationMax: 365,
    passwordMin: 4,
    passwordMax: 64,
  };

  const clean = (v) => (v == null ? '' : String(v)).trim().replace(/\s+/g, ' ');
  const hasLetter = (v) => /\p{L}/u.test(v);
  const tooLong = (v, max, label) => (v.length > max ? `${label} must be ${max} characters or fewer.` : '');

  const checks = {
    bookNo(raw) {
      const v = clean(raw);
      if (!v) return 'Accession Number is required.';
      if (v.length > LIMITS.bookNo) return tooLong(v, LIMITS.bookNo, 'Accession Number');
      if (!/^[A-Za-z0-9][A-Za-z0-9\-\/_.]*$/.test(v)) {
        return 'Accession Number can contain only letters, numbers and - / _ . (no spaces).';
      }
      return '';
    },
    bookName(raw) {
      const v = clean(raw);
      if (!v) return 'Description of Manual is required.';
      return tooLong(v, LIMITS.bookName, 'Description of Manual');
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
      const v = clean(raw);
      if (v && !hasLetter(v)) return 'CAT must contain letters.';
      return tooLong(v, LIMITS.category, 'CAT');
    },
    lf(raw) {
      return tooLong(clean(raw), LIMITS.lf, 'LF');
    },
    location(raw) {
      return tooLong(clean(raw), LIMITS.location, 'LOC');
    },
    rack(raw) {
      return tooLong(clean(raw), LIMITS.rack, 'Rack');
    },
    person(raw, label = 'User Name') {
      const v = clean(raw);
      if (!v) return `${label} is required.`;
      if (v.length < 2) return `${label} must be at least 2 characters.`;
      if (v.length > LIMITS.person) return tooLong(v, LIMITS.person, label);
      if (!hasLetter(v)) return `${label} must contain letters.`;
      if (!/^[\p{L}\p{M}0-9 .'()\/-]+$/u.test(v)) {
        return `${label} can contain only letters, numbers, spaces and . ' - ( ) /`;
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

  return { LIMITS, clean, checks };
});
