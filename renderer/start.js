'use strict';
// Runs last: wires the sign-in forms and shows the first screen.
// Used by: renderer/index.html, which loads it with <script src="start.js">.
// Not imported: the screen scripts are plain browser scripts that share one global scope and
// load in this order: ui.js, app.js, dashboard.js, books.js, circulation.js, reports.js,
// settings.js, start.js. Keep that order in index.html when adding or renaming a file.

/* ================= Boot ================= */
enhancePasswords($('#login-form'));
enhancePasswords($('#setup-form'));
enterMovesTo($('#login-username'), $('#login-password'));
enterMovesTo($('#setup-username'), $('#setup-password'));
showLogin();
