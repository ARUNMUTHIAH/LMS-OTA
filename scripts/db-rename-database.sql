-- 2CQR GARUDA: move the library from database `garuda_library` to the new name `garuda_lms`.
-- MySQL cannot rename a database, so this creates `garuda_lms` and moves each table into it with
-- RENAME TABLE (instant; all rows, indexes and the issues -> books foreign keys move with it).
-- Only the database name changes: table names, columns and data stay exactly the same.
-- Safe to run more than once: a table is moved only when it is in the old database and not yet in
-- the new one.
--
-- Before running: export a backup of `garuda_library` (phpMyAdmin > Export), close every app.
-- Run it as a MySQL account that may create databases (the root / admin account).

CREATE DATABASE IF NOT EXISTS garuda_lms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS garuda_lms.move_table;
DELIMITER //
CREATE PROCEDURE garuda_lms.move_table(IN t VARCHAR(64))
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'garuda_library' AND TABLE_NAME = t)
     AND NOT EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'garuda_lms' AND TABLE_NAME = t) THEN
    SET @s = CONCAT('RENAME TABLE `garuda_library`.`', t, '` TO `garuda_lms`.`', t, '`');
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;

-- Books first, then issues (each issues table refers to its books table).
CALL garuda_lms.move_table('technical_books');
CALL garuda_lms.move_table('technical_issues');
CALL garuda_lms.move_table('technical_users');
CALL garuda_lms.move_table('technical_settings');
CALL garuda_lms.move_table('general_books');
CALL garuda_lms.move_table('general_issues');
CALL garuda_lms.move_table('general_users');
CALL garuda_lms.move_table('general_settings');

DROP PROCEDURE garuda_lms.move_table;

-- The apps' MySQL account needs the same rights on the new database. Change 'cqr'@'%' to your
-- app account as shown in phpMyAdmin > User accounts (for example 'library_app'@'localhost').
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON garuda_lms.* TO 'cqr'@'%';
FLUSH PRIVILEGES;

-- Check: the 8 library tables should be listed here, with their rows.
SELECT TABLE_NAME AS table_name, TABLE_ROWS AS approx_rows
  FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'garuda_lms' ORDER BY TABLE_NAME;
-- ...and nothing left here.
SELECT TABLE_NAME AS left_in_old_database
  FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'garuda_library';

-- When the check shows all 8 tables in garuda_lms and the apps work (after setting the
-- database name to garuda_lms in Settings > Database / server .env), the empty old
-- database can be removed:
-- DROP DATABASE garuda_library;
