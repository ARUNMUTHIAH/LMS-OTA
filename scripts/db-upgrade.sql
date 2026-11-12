-- 2CQR GARUDA: bring an existing library database up to date.
-- Safe to run on a database that already has some or all of these: missing tables and columns
-- are added, ones that already exist are skipped. Nothing is dropped or deleted.
-- Covers both libraries: Technical (technical_books, technical_issues, technical_users, technical_settings) and
-- General (general_books, general_issues, general_users, general_settings).
--
-- (The app does the same by itself each time it starts; this is for doing it by hand.)

-- The library database. Both libraries' tables are in it. If yours has a different name
-- (Settings > Database connection shows it), change it here.
USE garuda_lms;

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
  `book_no`     VARCHAR(50)  NOT NULL,
  `name`        VARCHAR(200) NOT NULL,
  `author`      VARCHAR(150) NOT NULL DEFAULT '',
  `publisher`   VARCHAR(150) NOT NULL DEFAULT '',
  `category`    VARCHAR(100) NOT NULL DEFAULT '',
  `lf`          VARCHAR(30)  NOT NULL DEFAULT '',
  `location`    VARCHAR(30)  NOT NULL DEFAULT '',
  `rack`        VARCHAR(30)  NOT NULL DEFAULT '',
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
  `book_no`         VARCHAR(50)  NOT NULL,
  `book_name`       VARCHAR(200) NOT NULL,
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

-- issues.issued_by (the signed-in account that recorded the issue / return)
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `technical_issues` ADD COLUMN `issued_by` VARCHAR(100) NULL AFTER `issue_remarks`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technical_issues' AND COLUMN_NAME = 'issued_by');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- issues.returned_by (the signed-in account that recorded the issue / return)
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `technical_issues` ADD COLUMN `returned_by` VARCHAR(100) NULL AFTER `return_remarks`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technical_issues' AND COLUMN_NAME = 'returned_by');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- books.created_by (the signed-in account that added / last edited the book)
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `technical_books` ADD COLUMN `created_by` VARCHAR(100) NULL AFTER `rack`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technical_books' AND COLUMN_NAME = 'created_by');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- books.updated_by (the signed-in account that added / last edited the book)
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `technical_books` ADD COLUMN `updated_by` VARCHAR(100) NULL AFTER `created_by`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'technical_books' AND COLUMN_NAME = 'updated_by');
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
  `book_no`     VARCHAR(50)  NOT NULL,
  `name`        VARCHAR(200) NOT NULL,
  `author`      VARCHAR(150) NOT NULL DEFAULT '',
  `publisher`   VARCHAR(150) NOT NULL DEFAULT '',
  `category`    VARCHAR(100) NOT NULL DEFAULT '',
  `lf`          VARCHAR(30)  NOT NULL DEFAULT '',
  `location`    VARCHAR(30)  NOT NULL DEFAULT '',
  `rack`        VARCHAR(30)  NOT NULL DEFAULT '',
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
  `book_no`         VARCHAR(50)  NOT NULL,
  `book_name`       VARCHAR(200) NOT NULL,
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

-- general_issues.issued_by (the signed-in account that recorded the issue / return)
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `general_issues` ADD COLUMN `issued_by` VARCHAR(100) NULL AFTER `issue_remarks`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'general_issues' AND COLUMN_NAME = 'issued_by');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- general_issues.returned_by (the signed-in account that recorded the issue / return)
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `general_issues` ADD COLUMN `returned_by` VARCHAR(100) NULL AFTER `return_remarks`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'general_issues' AND COLUMN_NAME = 'returned_by');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- general_books.created_by (the signed-in account that added / last edited the book)
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `general_books` ADD COLUMN `created_by` VARCHAR(100) NULL AFTER `rack`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'general_books' AND COLUMN_NAME = 'created_by');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- general_books.updated_by (the signed-in account that added / last edited the book)
SET @s = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE `general_books` ADD COLUMN `updated_by` VARCHAR(100) NULL AFTER `created_by`', 'DO 0') FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'general_books' AND COLUMN_NAME = 'updated_by');
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

-- ==================== Check: the columns now in each table ====================
SELECT TABLE_NAME AS table_name, GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ', ') AS columns
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('technical_books', 'technical_issues', 'technical_users', 'technical_settings', 'general_books', 'general_issues', 'general_users', 'general_settings')
GROUP BY TABLE_NAME ORDER BY TABLE_NAME;
