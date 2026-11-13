-- 2CQR GARUDA: full database set-up that KEEPS ONLY THE USERS.
--
-- What it does, for both libraries (Technical and General):
--   * Creates every table and column the app needs (missing ones are added, nothing is dropped).
--   * Keeps the users tables exactly as they are: technical_users and general_users (usernames, passwords,
--     roles, permissions).
--   * DELETES ALL OTHER DATA: every book, every issue/return record, and all settings
--     (logo, loan period, "return by another person"). The loan period is set back to 14 days.
--     Only the users' "password has been changed" flag is kept in settings.
--
-- THIS CANNOT BE UNDONE. Export a backup of the database first (phpMyAdmin > Export).

-- The library database. Both libraries' tables are in it. If yours has a different name
-- (Settings > Database connection shows it), change it here.
USE garuda_lms;

-- ######################################################################################
-- PART A: table structure (same as db-upgrade.sql)
-- ######################################################################################
-- ==================== Technical Library (tables technical_books, technical_issues, technical_users, technical_settings) ====================

-- 0. Older databases: rename books, issues, users, settings to technical_* (skipped once done)
SET @s = (SELECT IF(SUM(TABLE_NAME = 'books') = 1 AND SUM(TABLE_NAME = 'technical_books') = 0,
          'RENAME TABLE `books` TO `technical_books`', 'DO 0')
          FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE());
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = (SELECT IF(SUM(TABLE_NAME = 'issues') = 1 AND SUM(TABLE_NAME = 'technical_issues') = 0,
          'RENAME TABLE `issues` TO `technical_issues`', 'DO 0')
          FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE());
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = (SELECT IF(SUM(TABLE_NAME = 'users') = 1 AND SUM(TABLE_NAME = 'technical_users') = 0,
          'RENAME TABLE `users` TO `technical_users`', 'DO 0')
          FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE());
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = (SELECT IF(SUM(TABLE_NAME = 'settings') = 1 AND SUM(TABLE_NAME = 'technical_settings') = 0,
          'RENAME TABLE `settings` TO `technical_settings`', 'DO 0')
          FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE());
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 1. Missing tables (tables that already exist are left as they are)

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
  `return_date`     DATE         NULL,
  `return_time`     TIME         NULL,
  `return_user`     VARCHAR(100) NULL,
  `return_remarks`  VARCHAR(250) NULL,
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

-- 2. Missing columns (a column that already exists is skipped)

-- issues.issue_rank
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `technical_issues` ADD COLUMN `issue_rank` VARCHAR(50) NOT NULL DEFAULT '''' AFTER `issue_user`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technical_issues' AND COLUMN_NAME = 'issue_rank');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- issues.issue_number
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `technical_issues` ADD COLUMN `issue_number` VARCHAR(50) NOT NULL DEFAULT '''' AFTER `issue_rank`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technical_issues' AND COLUMN_NAME = 'issue_number');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- issues.issue_dept
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `technical_issues` ADD COLUMN `issue_dept` VARCHAR(50) NOT NULL DEFAULT '''' AFTER `issue_number`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technical_issues' AND COLUMN_NAME = 'issue_dept');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- issues.issue_time
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `technical_issues` ADD COLUMN `issue_time` TIME NULL AFTER `issue_date`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technical_issues' AND COLUMN_NAME = 'issue_time');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- issues.return_time
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `technical_issues` ADD COLUMN `return_time` TIME NULL AFTER `return_date`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technical_issues' AND COLUMN_NAME = 'return_time');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- users.role
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `technical_users` ADD COLUMN `role` VARCHAR(20) NOT NULL DEFAULT ''librarian'' AFTER `active`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technical_users' AND COLUMN_NAME = 'role');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- users.permissions
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `technical_users` ADD COLUMN `permissions` VARCHAR(255) NULL AFTER `role`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technical_users' AND COLUMN_NAME = 'permissions');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- users.created_at
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `technical_users` ADD COLUMN `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `permissions`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technical_users' AND COLUMN_NAME = 'created_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- users.updated_at
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `technical_users` ADD COLUMN `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `created_at`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technical_users' AND COLUMN_NAME = 'updated_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- settings.updated_at
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `technical_settings` ADD COLUMN `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `value`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technical_settings' AND COLUMN_NAME = 'updated_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 3. settings.value wide enough for the uploaded logo (only if it is still VARCHAR)
SET @s = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `technical_settings` MODIFY `value` MEDIUMTEXT NOT NULL', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technical_settings' AND COLUMN_NAME = 'value' AND DATA_TYPE = 'varchar');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 4. Fill issue / return time for older rows, from the full timestamps (rows already filled are untouched)
UPDATE `technical_issues` SET `issue_time` = TIME(`issued_at`) WHERE `issue_time` IS NULL AND `issued_at` IS NOT NULL;
UPDATE `technical_issues` SET `return_time` = TIME(`returned_at`) WHERE `return_time` IS NULL AND `returned_at` IS NOT NULL;

-- 5. Default loan period, only if not set yet
INSERT IGNORE INTO `technical_settings` (`key`, `value`) VALUES ('default_duration', '14');

-- ==================== General Library (tables general_books, general_issues, general_users, general_settings) ====================

-- 1. Missing tables (tables that already exist are left as they are)

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
  `return_date`     DATE         NULL,
  `return_time`     TIME         NULL,
  `return_user`     VARCHAR(100) NULL,
  `return_remarks`  VARCHAR(250) NULL,
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

-- 2. Missing columns (a column that already exists is skipped)

-- general_issues.issue_rank
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `general_issues` ADD COLUMN `issue_rank` VARCHAR(50) NOT NULL DEFAULT '''' AFTER `issue_user`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'general_issues' AND COLUMN_NAME = 'issue_rank');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- general_issues.issue_number
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `general_issues` ADD COLUMN `issue_number` VARCHAR(50) NOT NULL DEFAULT '''' AFTER `issue_rank`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'general_issues' AND COLUMN_NAME = 'issue_number');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- general_issues.issue_dept
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `general_issues` ADD COLUMN `issue_dept` VARCHAR(50) NOT NULL DEFAULT '''' AFTER `issue_number`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'general_issues' AND COLUMN_NAME = 'issue_dept');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- general_issues.issue_time
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `general_issues` ADD COLUMN `issue_time` TIME NULL AFTER `issue_date`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'general_issues' AND COLUMN_NAME = 'issue_time');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- general_issues.return_time
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `general_issues` ADD COLUMN `return_time` TIME NULL AFTER `return_date`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'general_issues' AND COLUMN_NAME = 'return_time');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- general_users.role
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `general_users` ADD COLUMN `role` VARCHAR(20) NOT NULL DEFAULT ''librarian'' AFTER `active`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'general_users' AND COLUMN_NAME = 'role');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- general_users.permissions
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `general_users` ADD COLUMN `permissions` VARCHAR(255) NULL AFTER `role`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'general_users' AND COLUMN_NAME = 'permissions');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- general_users.created_at
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `general_users` ADD COLUMN `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `permissions`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'general_users' AND COLUMN_NAME = 'created_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- general_users.updated_at
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `general_users` ADD COLUMN `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `created_at`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'general_users' AND COLUMN_NAME = 'updated_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- general_settings.updated_at
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `general_settings` ADD COLUMN `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `value`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'general_settings' AND COLUMN_NAME = 'updated_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 3. settings.value wide enough for the uploaded logo (only if it is still VARCHAR)
SET @s = (SELECT IF(COUNT(*) > 0, 'ALTER TABLE `general_settings` MODIFY `value` MEDIUMTEXT NOT NULL', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'general_settings' AND COLUMN_NAME = 'value' AND DATA_TYPE = 'varchar');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 4. Fill issue / return time for older rows, from the full timestamps (rows already filled are untouched)
UPDATE `general_issues` SET `issue_time` = TIME(`issued_at`) WHERE `issue_time` IS NULL AND `issued_at` IS NOT NULL;
UPDATE `general_issues` SET `return_time` = TIME(`returned_at`) WHERE `return_time` IS NULL AND `returned_at` IS NOT NULL;

-- 5. Default loan period, only if not set yet
INSERT IGNORE INTO `general_settings` (`key`, `value`) VALUES ('default_duration', '14');

-- ######################################################################################
-- PART B: remove all data except users
-- ######################################################################################

SET FOREIGN_KEY_CHECKS = 0;

-- Technical Library
DELETE FROM `technical_issues`;
DELETE FROM `technical_books`;
DELETE FROM `technical_settings` WHERE `key` <> 'default_credentials';  -- keeps the users' password-changed flag
ALTER TABLE `technical_issues` AUTO_INCREMENT = 1;
ALTER TABLE `technical_books`  AUTO_INCREMENT = 1;
INSERT IGNORE INTO `technical_settings` (`key`, `value`) VALUES ('default_duration', '14');

-- General Library
DELETE FROM `general_issues`;
DELETE FROM `general_books`;
DELETE FROM `general_settings` WHERE `key` <> 'default_credentials';
ALTER TABLE `general_issues` AUTO_INCREMENT = 1;
ALTER TABLE `general_books`  AUTO_INCREMENT = 1;
INSERT IGNORE INTO `general_settings` (`key`, `value`) VALUES ('default_duration', '14');

SET FOREIGN_KEY_CHECKS = 1;

-- ######################################################################################
-- Check: rows left in each table (technical_users and general_users keep their rows, the rest are 0;
-- settings tables keep only the loan period and the password-changed flag)
-- ######################################################################################
SELECT 'technical_users'            AS table_name, COUNT(*) AS `rows` FROM `technical_users`
UNION ALL SELECT 'technical_books',            COUNT(*) FROM `technical_books`
UNION ALL SELECT 'technical_issues',           COUNT(*) FROM `technical_issues`
UNION ALL SELECT 'technical_settings',         COUNT(*) FROM `technical_settings`
UNION ALL SELECT 'general_users',    COUNT(*) FROM `general_users`
UNION ALL SELECT 'general_books',    COUNT(*) FROM `general_books`
UNION ALL SELECT 'general_issues',   COUNT(*) FROM `general_issues`
UNION ALL SELECT 'general_settings', COUNT(*) FROM `general_settings`;