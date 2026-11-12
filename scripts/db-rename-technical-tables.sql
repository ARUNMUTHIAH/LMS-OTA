-- 2CQR GARUDA: rename the Technical Library tables to match the General Library naming.
--   books    -> technical_books
--   issues   -> technical_issues
--   users    -> technical_users
--   settings -> technical_settings
-- Only the table names change: columns, data, indexes and the issues -> books foreign key stay as
-- they are. Safe to run more than once: a table is renamed only when the old name exists and the
-- new one does not. Run it BEFORE starting the new app version (the app would otherwise create
-- new, empty technical_* tables).

USE garuda_lms;

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

-- Check: the library tables now in the database.
SELECT TABLE_NAME AS table_name, TABLE_ROWS AS approx_rows FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME;
