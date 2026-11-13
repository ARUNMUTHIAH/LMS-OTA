-- 2CQR GARUDA: full library database structure, both versions (MySQL 8 / MariaDB 10.3+).
--   Version 1 - Technical Library : technical_books, technical_issues, technical_users, technical_settings
--   Version 2 - General Library   : general_books, general_issues, general_users, general_settings
-- Both versions live in one database and never share data.
-- Safe to run more than once: existing tables are left as they are.
-- (To bring an older database up to date, including the books -> technical_books rename,
--  run scripts/db-upgrade.sql instead.)

CREATE DATABASE IF NOT EXISTS garuda_lms
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE garuda_lms;   -- change the name in both lines if your database is called something else

-- =====================================================================
-- VERSION 1 - Technical Library
-- =====================================================================

CREATE TABLE IF NOT EXISTS `technical_books` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `book_no`     VARCHAR(768) NOT NULL,
  `name`        TEXT         NOT NULL,
  `author`      VARCHAR(150) NOT NULL DEFAULT '',
  `publisher`   VARCHAR(150) NOT NULL DEFAULT '',
  `category`    TEXT         NOT NULL,
  `lf`          TEXT         NOT NULL,
  `location`    TEXT         NOT NULL,
  `rack`        TEXT         NOT NULL,
  `created_by`  VARCHAR(100) NULL,
  `updated_by`  VARCHAR(100) NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_technical_books_book_no` (`book_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `technical_issues` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `book_id`         INT UNSIGNED NULL,
  `book_no`         VARCHAR(768) NOT NULL,
  `book_name`       TEXT         NOT NULL,
  `issue_user`      VARCHAR(100) NOT NULL,
  `issue_rank`      VARCHAR(50)  NOT NULL DEFAULT '',
  `issue_number`    VARCHAR(50)  NOT NULL DEFAULT '',
  `issue_dept`      VARCHAR(50)  NOT NULL DEFAULT '',
  `issue_date`      DATE         NOT NULL,
  `issue_time`      TIME         NULL,
  `duration`        INT          NOT NULL,
  `due_date`        DATE         NOT NULL,
  `issue_remarks`   VARCHAR(250) NOT NULL DEFAULT '',
  `issued_by`       VARCHAR(100) NULL,
  `return_date`     DATE         NULL,
  `return_time`     TIME         NULL,
  `return_user`     VARCHAR(100) NULL,
  `return_remarks`  VARCHAR(250) NULL,
  `returned_by`     VARCHAR(100) NULL,
  `returned_late`   TINYINT(1)   NOT NULL DEFAULT 0,
  `issued_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `returned_at`     DATETIME     NULL,
  PRIMARY KEY (`id`),
  KEY `idx_technical_issues_book` (`book_id`),
  KEY `idx_technical_issues_open` (`return_date`),
  CONSTRAINT `fk_technical_issues_book` FOREIGN KEY (`book_id`) REFERENCES `technical_books` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `technical_users` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(30)  NOT NULL,
  `password_hash` CHAR(128)    NOT NULL,
  `salt`          CHAR(32)     NOT NULL,
  `active`        TINYINT(1)   NOT NULL DEFAULT 1,
  `role`          VARCHAR(20)  NOT NULL DEFAULT 'librarian',
  `permissions`   VARCHAR(255) NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_technical_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `technical_settings` (
  `key`        VARCHAR(50) NOT NULL,
  `value`      MEDIUMTEXT  NOT NULL,
  `updated_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `technical_settings` (`key`, `value`) VALUES ('default_duration', '14');

-- =====================================================================
-- VERSION 2 - General Library  (screen labels: lf = Title, category = Author)
-- =====================================================================

CREATE TABLE IF NOT EXISTS `general_books` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `book_no`     VARCHAR(768) NOT NULL,
  `name`        TEXT         NOT NULL,
  `author`      VARCHAR(150) NOT NULL DEFAULT '',
  `publisher`   VARCHAR(150) NOT NULL DEFAULT '',
  `category`    TEXT         NOT NULL,
  `lf`          TEXT         NOT NULL,
  `location`    TEXT         NOT NULL,
  `rack`        TEXT         NOT NULL,
  `created_by`  VARCHAR(100) NULL,
  `updated_by`  VARCHAR(100) NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_general_books_book_no` (`book_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `general_issues` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `book_id`         INT UNSIGNED NULL,
  `book_no`         VARCHAR(768) NOT NULL,
  `book_name`       TEXT         NOT NULL,
  `issue_user`      VARCHAR(100) NOT NULL,
  `issue_rank`      VARCHAR(50)  NOT NULL DEFAULT '',
  `issue_number`    VARCHAR(50)  NOT NULL DEFAULT '',
  `issue_dept`      VARCHAR(50)  NOT NULL DEFAULT '',
  `issue_date`      DATE         NOT NULL,
  `issue_time`      TIME         NULL,
  `duration`        INT          NOT NULL,
  `due_date`        DATE         NOT NULL,
  `issue_remarks`   VARCHAR(250) NOT NULL DEFAULT '',
  `issued_by`       VARCHAR(100) NULL,
  `return_date`     DATE         NULL,
  `return_time`     TIME         NULL,
  `return_user`     VARCHAR(100) NULL,
  `return_remarks`  VARCHAR(250) NULL,
  `returned_by`     VARCHAR(100) NULL,
  `returned_late`   TINYINT(1)   NOT NULL DEFAULT 0,
  `issued_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `returned_at`     DATETIME     NULL,
  PRIMARY KEY (`id`),
  KEY `idx_general_issues_book` (`book_id`),
  KEY `idx_general_issues_open` (`return_date`),
  CONSTRAINT `fk_general_issues_book` FOREIGN KEY (`book_id`) REFERENCES `general_books` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `general_users` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(30)  NOT NULL,
  `password_hash` CHAR(128)    NOT NULL,
  `salt`          CHAR(32)     NOT NULL,
  `active`        TINYINT(1)   NOT NULL DEFAULT 1,
  `role`          VARCHAR(20)  NOT NULL DEFAULT 'librarian',
  `permissions`   VARCHAR(255) NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_general_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `general_settings` (
  `key`        VARCHAR(50) NOT NULL,
  `value`      MEDIUMTEXT  NOT NULL,
  `updated_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `general_settings` (`key`, `value`) VALUES ('default_duration', '14');
