'use strict';
// Runs last: wires the sign-in forms and shows the first screen.
// Screen scripts share one global scope and load in order from index.html.

/* ================= Boot ================= */
enhancePasswords($('#login-form'));
enhancePasswords($('#setup-form'));
enterMovesTo($('#login-username'), $('#login-password'));
enterMovesTo($('#setup-username'), $('#setup-password'));
enterMovesTo($('#setup-password'), $('#setup-confirm'));
showLogin();
