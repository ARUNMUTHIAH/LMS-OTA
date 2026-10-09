# Library API server

Both desktop apps keep their data in MySQL through this server:

| App | Tables |
|---|---|
| Version 1 – Technical Library | `books`, `issues`, `users`, `settings` |
| Version 2 – General Library | `general_books`, `general_issues`, `general_users`, `general_settings` |

The apps connect to `http://76.13.198.196:4000`. They never get the MySQL password; only this server has it.

## Install on the server (76.13.198.196)

Needs Node.js 18 or newer (`node -v`).

1. Copy these from the project to the server, keeping the folder layout:
   ```
   server/            (this folder, without node_modules)
   src/dates.js
   renderer/rules.js
   ```
   e.g. to `/opt/library/server`, `/opt/library/src/dates.js`, `/opt/library/renderer/rules.js`.

2. Create a MySQL user for the server (in MySQL as root):
   ```sql
   CREATE DATABASE IF NOT EXISTS technical_library CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'library_app'@'localhost' IDENTIFIED BY 'choose-a-strong-password';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON technical_library.* TO 'library_app'@'localhost';
   ```
   The server creates any missing tables itself on start, and adds the Rank / Number / Dept columns to an
   existing version 1 `issues` table. Running the files in `sql/` first is optional.

3. Settings:
   ```bash
   cd /opt/library/server
   cp .env.example .env      # then edit .env: DB_USER, DB_PASSWORD, DB_NAME
   npm install --omit=dev
   node index.js             # should print: Library API listening on http://0.0.0.0:4000
   ```

4. Open port 4000 in the firewall (e.g. `ufw allow 4000/tcp`, and in the hosting control panel if it has one).
   Check from a PC: open `http://76.13.198.196:4000/health` in a browser. It should show `{"ok":true}`.

5. Keep it running after logout and reboot (systemd), `/etc/systemd/system/library-api.service`:
   ```ini
   [Unit]
   Description=Library API
   After=network.target mysql.service

   [Service]
   WorkingDirectory=/opt/library/server
   ExecStart=/usr/bin/node index.js
   Restart=always
   User=www-data

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   systemctl daemon-reload && systemctl enable --now library-api
   ```

## Move existing data to the server

Each app starts by asking for a first account if its tables are empty. To bring over the books, issues
and accounts a PC already has:

1. Install the new app version, create a temporary first account, sign in.
2. Settings → Backup & restore → **Restore from backup**, and choose the old database file:
   - Version 1: `%APPDATA%\Technical Library - CGAS Chennai\library.db`
   - Version 2: `%APPDATA%\General Library - CGAS Chennai\library.db`
3. Sign in again with the accounts from that file.

## Notes

- Use a different address: put `{"url": "http://host:port"}` in `server.json` in the app's data folder
  (`%APPDATA%\<app name>\server.json`).
- The connection is plain HTTP, so passwords cross the internet unencrypted. For HTTPS, put the server
  behind nginx with a certificate (needs a domain name) and set the apps' address to `https://…`.
- Server-side backups: schedule `mysqldump technical_library > backup.sql`. Each app also saves a daily
  `.db` backup on its PC (Settings → Automatic backup).
- Check a test server end to end (empty test database only): `LMS_SERVER=http://127.0.0.1:4000 node test/server-check.js`
