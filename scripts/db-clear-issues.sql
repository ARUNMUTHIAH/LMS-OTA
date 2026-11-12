-- 2CQR GARUDA: clear issue / return records directly in the database (phpMyAdmin > SQL).
-- Issue and return are ONE row each in the issues table: a return fills in the return columns of
-- the issue row. So deleting the rows clears both the issue and its return.
--   Manuals (Technical) library: technical_issues      Books (General) library: general_issues
-- Books, users and settings are NOT touched. After clearing, every book shows as Available.
-- The Audit Log keeps its "Book issued / Book returned" entries (it cannot be cleared).
--
-- THIS CANNOT BE UNDONE. Export a backup first (phpMyAdmin > Export), close all apps, and run
-- ONLY the part you need (select it, then Go).

USE garuda_lms;

-- ---------------------------------------------------------------------------------------------
-- 0. Look first: how many records each part below would delete
-- ---------------------------------------------------------------------------------------------
SELECT 'technical' AS library, COUNT(*) AS all_records, SUM(return_date IS NULL) AS not_returned, SUM(return_date IS NOT NULL) AS returned
  FROM technical_issues
UNION ALL
SELECT 'general', COUNT(*), SUM(return_date IS NULL), SUM(return_date IS NOT NULL) FROM general_issues;

-- ---------------------------------------------------------------------------------------------
-- 1. Clear ALL issue + return records (numbering starts again from 1)
-- ---------------------------------------------------------------------------------------------
DELETE FROM technical_issues;
ALTER TABLE technical_issues AUTO_INCREMENT = 1;

DELETE FROM general_issues;
ALTER TABLE general_issues AUTO_INCREMENT = 1;

-- ---------------------------------------------------------------------------------------------
-- 2. Clear only RETURNED records (history); books still out stay issued
-- ---------------------------------------------------------------------------------------------
-- DELETE FROM technical_issues WHERE return_date IS NOT NULL;
-- DELETE FROM general_issues   WHERE return_date IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- 3. Clear only books NOT YET RETURNED (they become Available again)
-- ---------------------------------------------------------------------------------------------
-- DELETE FROM technical_issues WHERE return_date IS NULL;
-- DELETE FROM general_issues   WHERE return_date IS NULL;

-- ---------------------------------------------------------------------------------------------
-- 4. Clear the records of ONE book (change the Barcode No)
-- ---------------------------------------------------------------------------------------------
-- DELETE FROM technical_issues WHERE book_no = 'CAG-001';
-- DELETE FROM general_issues   WHERE book_no = 'CAG-001';

-- ---------------------------------------------------------------------------------------------
-- 5. Clear records issued in a date range (issue date, both days included)
-- ---------------------------------------------------------------------------------------------
-- DELETE FROM technical_issues WHERE issue_date BETWEEN '2026-01-01' AND '2026-03-31';
-- DELETE FROM general_issues   WHERE issue_date BETWEEN '2026-01-01' AND '2026-03-31';

-- ---------------------------------------------------------------------------------------------
-- 6. Undo only the RETURN of one book (the book shows as issued again; the issue row is kept)
-- ---------------------------------------------------------------------------------------------
-- UPDATE technical_issues
--    SET return_date = NULL, return_time = NULL, return_user = NULL, return_remarks = NULL,
--        returned_by = NULL, returned_late = 0, returned_at = NULL
--  WHERE book_no = 'CAG-001' AND return_date IS NOT NULL
--  ORDER BY id DESC LIMIT 1;
-- (Check first that the book has not been issued again since, or it would show as issued twice.)
