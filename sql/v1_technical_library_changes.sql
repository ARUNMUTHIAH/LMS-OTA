-- Version 1: Technical Library - CGAS Chennai
-- Changes for the database that already exists on the live server.
-- Change the database name below if yours is different.
-- New in this release: Rank, Number and Dept of the borrower on each issue.
-- (Barcode No, Name and the other label changes are screen text only: no database change.)

USE technical_library;

ALTER TABLE issues
  ADD COLUMN issue_rank   VARCHAR(50) NOT NULL DEFAULT '' AFTER issue_user,
  ADD COLUMN issue_number VARCHAR(50) NOT NULL DEFAULT '' AFTER issue_rank,
  ADD COLUMN issue_dept   VARCHAR(50) NOT NULL DEFAULT '' AFTER issue_number;

-- If MySQL answers "Duplicate column name", these columns already exist: nothing more to do.
-- Check the result:
SHOW COLUMNS FROM issues;
