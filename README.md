# Technical Library - CGAS Chennai — Library Management System

Offline library management desktop app for Windows 10/11 (64-bit). Built with Electron, with a local SQLite database via sql.js.

## Features
- **Dashboard**: Total, In Circulation, Available and Overdue tiles that refresh on every change. Click Overdue to see the list.
- **Book Entry**: add, edit, search and delete books. Book Number is unique. A book that is currently issued can't be deleted.
- **Issue / Return**: scan or type the Book Number (USB barcode scanners work as a keyboard + Enter). Issue date and due date are set automatically, and late returns are marked **Returned Late**.
- **Reports**: Total Books, Circulation and Overdue reports, with filters, printing, and export to Excel (.xlsx) and PDF.
- **Settings**: change the login, set the default loan duration (14 days), and back up or restore the data.

First start: there is no built-in login. The app asks you to create the first librarian account (username and password), then you can add more users in Settings → Users. Databases from earlier versions keep their existing accounts.

Data is stored in `%APPDATA%\Technical Library - CGAS Chennai\library.db`. On first start after a rename, an existing database from an earlier data folder (`Technical Library CGAS Chennai`, `Dornier Aircraft Publication Library`, then `OTA Campus Library`) is copied across automatically.

## License
The app opens only with an approved license whose expiry date has not passed (it works through the expiry date itself). Without one, the License screen is shown instead of the sign-in:
1. Enter the **Client ID** (kept until you change it) and click **Register License** (or **Renew License** once a license has been used).
2. Copy the request code, `[LM-REQ] <client id>|web|<software>|<unique id>`, and email it to the administrator. The unique id (software key) is a fixed constant of each version, the same on every computer: both versions use the software name `IssueReturn`; Technical's key is `SOFTWARE_KEY` in `src/license.js`, General's is `GENERAL_SOFTWARE_KEY` in `scripts/build-general.js`. Never change them: licenses are issued for them.
3. Load the license file the administrator sends with **Load License File** (it is kept encrypted in the data folder as `license.dat` and replaces the previous one, so renewals need nothing else; an edited `license.dat` stops counting as a license), or paste it into the install folder (next to the .exe; the project folder with `npm start`) and click **Check Again**. The administrator's file is `<software>_<license id>.lmlic`, e.g. `IssueReturn_93.lmlic` (JSON inside).

The license must be `Approved` and match this version's unique id, Client ID, software name and platform. To check the license server's signature, set `LICENSE_SECRET` in `src/license.js` (HMAC-SHA256 of the payload). The sign-in screen shows the expiry date; after sign-in a reminder appears in the last 30 days.

## Development
```
npm install
npm start          # run the app
npm test           # business-rule smoke tests
npm run lint       # ESLint (also run by CI on every push / pull request)
npm run dist       # build dist\Technical Library - CGAS Chennai Setup <version>.exe
```
> When running from a VS Code terminal, `ELECTRON_RUN_AS_NODE` may be set. Unset it first if `npm start` fails with "Cannot find module 'electron'".
