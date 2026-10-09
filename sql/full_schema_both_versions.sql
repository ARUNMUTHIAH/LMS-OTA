-- Full database for both apps on the live server (MySQL 8 / MariaDB 10.3+).
--   Version 1 - Technical Library - CGAS Chennai : books, issues, users, settings
--   Version 2 - General Library - CGAS Chennai   : general_books, general_issues, general_users, general_settings
-- Both versions live in one database and never share data.
-- Safe to run more than once: existing tables are left as they are.

CREATE DATABASE IF NOT EXISTS technical_library
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE technical_library;   -- change the name in both lines if your database is called something else

-- =====================================================================
-- VERSION 1 - Technical Library
-- =====================================================================

CREATE TABLE IF NOT EXISTS books (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  book_no     VARCHAR(50)  NOT NULL,              -- Barcode No (unique, case-insensitive)
  name        VARCHAR(200) NOT NULL,              -- Description of Manual
  author      VARCHAR(150) NOT NULL DEFAULT '',
  publisher   VARCHAR(150) NOT NULL DEFAULT '',
  category    VARCHAR(100) NOT NULL DEFAULT '',   -- CAT
  lf          VARCHAR(30)  NOT NULL DEFAULT '',   -- LF
  location    VARCHAR(30)  NOT NULL DEFAULT '',   -- LOC
  rack        VARCHAR(30)  NOT NULL DEFAULT '',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_books_book_no (book_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS issues (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  book_id         INT UNSIGNED NULL,               -- NULL once the book is deleted; history is kept
  book_no         VARCHAR(50)  NOT NULL,           -- snapshot of the Barcode No at issue time
  book_name       VARCHAR(200) NOT NULL,
  issue_user      VARCHAR(100) NOT NULL,           -- Name
  issue_rank      VARCHAR(50)  NOT NULL DEFAULT '',
  issue_number    VARCHAR(50)  NOT NULL DEFAULT '',
  issue_dept      VARCHAR(50)  NOT NULL DEFAULT '',
  issue_date      DATE         NOT NULL,
  duration        INT          NOT NULL,           -- loan period in days (1-365)
  due_date        DATE         NOT NULL,
  issue_remarks   VARCHAR(250) NOT NULL DEFAULT '',
  return_date     DATE         NULL,               -- NULL while the book is out
  return_user     VARCHAR(100) NULL,               -- Name of the person returning it
  return_remarks  VARCHAR(250) NULL,
  returned_late   TINYINT(1)   NOT NULL DEFAULT 0,
  issued_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  returned_at     DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_issues_book (book_id),
  KEY idx_issues_open (return_date),
  CONSTRAINT fk_issues_book FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(30)  NOT NULL,             -- unique, case-insensitive
  password_hash CHAR(128)    NOT NULL,             -- scrypt, 64 bytes as hex
  salt          CHAR(32)     NOT NULL,             -- 16 random bytes as hex
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  `key`   VARCHAR(50)  NOT NULL,
  `value` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO settings (`key`, `value`) VALUES
  ('default_duration', '14'),
  ('default_credentials', '0');

-- =====================================================================
-- VERSION 2 - General Library  (screen labels: lf = Title, category = Author)
-- =====================================================================

CREATE TABLE IF NOT EXISTS general_books (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  book_no     VARCHAR(50)  NOT NULL,              -- Barcode No (unique, case-insensitive)
  name        VARCHAR(200) NOT NULL,              -- Description of Manual
  author      VARCHAR(150) NOT NULL DEFAULT '',
  publisher   VARCHAR(150) NOT NULL DEFAULT '',
  category    VARCHAR(100) NOT NULL DEFAULT '',   -- shown as "Author" in version 2
  lf          VARCHAR(30)  NOT NULL DEFAULT '',   -- shown as "Title" in version 2
  location    VARCHAR(30)  NOT NULL DEFAULT '',   -- LOC
  rack        VARCHAR(30)  NOT NULL DEFAULT '',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_general_books_book_no (book_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS general_issues (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  book_id         INT UNSIGNED NULL,               -- NULL once the book is deleted; history is kept
  book_no         VARCHAR(50)  NOT NULL,           -- snapshot of the Barcode No at issue time
  book_name       VARCHAR(200) NOT NULL,
  issue_user      VARCHAR(100) NOT NULL,           -- Name
  issue_rank      VARCHAR(50)  NOT NULL DEFAULT '',
  issue_number    VARCHAR(50)  NOT NULL DEFAULT '',
  issue_dept      VARCHAR(50)  NOT NULL DEFAULT '',
  issue_date      DATE         NOT NULL,
  duration        INT          NOT NULL,           -- loan period in days (1-365)
  due_date        DATE         NOT NULL,
  issue_remarks   VARCHAR(250) NOT NULL DEFAULT '',
  return_date     DATE         NULL,               -- NULL while the book is out
  return_user     VARCHAR(100) NULL,               -- Name of the person returning it
  return_remarks  VARCHAR(250) NULL,
  returned_late   TINYINT(1)   NOT NULL DEFAULT 0,
  issued_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  returned_at     DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_general_issues_book (book_id),
  KEY idx_general_issues_open (return_date),
  CONSTRAINT fk_general_issues_book FOREIGN KEY (book_id) REFERENCES general_books (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS general_users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(30)  NOT NULL,             -- unique, case-insensitive
  password_hash CHAR(128)    NOT NULL,             -- scrypt, 64 bytes as hex
  salt          CHAR(32)     NOT NULL,             -- 16 random bytes as hex
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_general_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS general_settings (
  `key`   VARCHAR(50)  NOT NULL,
  `value` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO general_settings (`key`, `value`) VALUES
  ('default_duration', '14'),
  ('default_credentials', '0');

-- Check the result: should list 8 tables.
SHOW TABLES;
