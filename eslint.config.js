const js = require('@eslint/js');
const globals = require('globals');
const security = require('eslint-plugin-security');

module.exports = [
  { ignores: ['node_modules/', 'dist/'] },
  js.configs.recommended,
  security.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      // Object lookups here use fixed keys from the code, not user input.
      'security/detect-object-injection': 'off',
      // Desktop app: file paths come from the user's own Save/Open dialogs and the app data folder.
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    // Main process, preload, database layer and tests run under Node / Electron.
    files: ['main.js', 'preload.js', 'src/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    // Screens: plain browser scripts loaded in order by renderer/index.html. They share one global
    // scope, so names defined in one file and used in another are expected.
    files: ['renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly', DOMPurify: 'readonly' },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
    },
  },
];
