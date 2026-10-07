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

## Development
```
npm install
npm start          # run the app
npm test           # business-rule smoke tests
npm run lint       # ESLint (also run by CI on every push / pull request)
npm run dist       # build dist\Technical Library - CGAS Chennai Setup <version>.exe
```
> When running from a VS Code terminal, `ELECTRON_RUN_AS_NODE` may be set. Unset it first if `npm start` fails with "Cannot find module 'electron'".
