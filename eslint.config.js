const js = require('@eslint/js');
const globals = require('globals');
const security = require('eslint-plugin-security');

module.exports = [
  { ignores: ['node_modules/', 'dist/'] },
  js.configs.recommended,
  security.configs.recommended,
  {
    // Main process, preload, database layer and tests run under Node / Electron.
    files: ['main.js', 'preload.js', 'src/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    // Screens: plain browser scripts loaded by renderer/index.html.
    files: ['renderer/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser, module: 'readonly' } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      // Object lookups here use fixed keys from the code, not user input.
      'security/detect-object-injection': 'off',
      // Desktop app: file paths come from the user's own Save/Open dialogs and the app data folder.
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
];
