-- 2CQR GARUDA: Audit Log tables, locked so that no one can edit or delete an entry.
-- The apps create these tables themselves on first start. Run this once in phpMyAdmin, as the
-- MySQL admin (root) account, to add the protection triggers: the apps' own MySQL account usually
-- may not create triggers. Safe to run more than once.
--
-- What it does, for technical_audit_log (Manuals) and general_audit_log (Books):
--   * any UPDATE of an entry is refused by MySQL
--   * any DELETE of an entry younger than 1 year is refused by MySQL
--   * the apps delete entries older than 1 year by themselves, one date at a time, each day
--     (that is the only delete allowed; 364 days below leaves room for a clock difference)

USE garuda_lms;

CREATE TABLE IF NOT EXISTS technical_audit_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  logged_at   DATETIME     NOT NULL,
  username    VARCHAR(100) NOT NULL DEFAULT '',
  computer    VARCHAR(100) NOT NULL DEFAULT '',
  category    VARCHAR(30)  NOT NULL DEFAULT '',
  action      VARCHAR(60)  NOT NULL DEFAULT '',
  record      VARCHAR(200) NOT NULL DEFAULT '',
  details     TEXT         NULL,
  result      VARCHAR(10)  NOT NULL DEFAULT 'Success',
  PRIMARY KEY (id),
  KEY idx_technical_audit_log_at (logged_at),
  KEY idx_technical_audit_log_user (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS general_audit_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  logged_at   DATETIME     NOT NULL,
  username    VARCHAR(100) NOT NULL DEFAULT '',
  computer    VARCHAR(100) NOT NULL DEFAULT '',
  category    VARCHAR(30)  NOT NULL DEFAULT '',
  action      VARCHAR(60)  NOT NULL DEFAULT '',
  record      VARCHAR(200) NOT NULL DEFAULT '',
  details     TEXT         NULL,
  result      VARCHAR(10)  NOT NULL DEFAULT 'Success',
  PRIMARY KEY (id),
  KEY idx_general_audit_log_at (logged_at),
  KEY idx_general_audit_log_user (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TRIGGER IF EXISTS technical_audit_log_no_update;
DROP TRIGGER IF EXISTS technical_audit_log_no_delete;
DROP TRIGGER IF EXISTS general_audit_log_no_update;
DROP TRIGGER IF EXISTS general_audit_log_no_delete;

DELIMITER //
CREATE TRIGGER technical_audit_log_no_update BEFORE UPDATE ON technical_audit_log FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit log entries cannot be changed.' //
CREATE TRIGGER technical_audit_log_no_delete BEFORE DELETE ON technical_audit_log FOR EACH ROW
BEGIN
  IF OLD.logged_at >= NOW() - INTERVAL 364 DAY THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit log entries are kept for one year and cannot be deleted.';
  END IF;
END //
CREATE TRIGGER general_audit_log_no_update BEFORE UPDATE ON general_audit_log FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit log entries cannot be changed.' //
CREATE TRIGGER general_audit_log_no_delete BEFORE DELETE ON general_audit_log FOR EACH ROW
BEGIN
  IF OLD.logged_at >= NOW() - INTERVAL 364 DAY THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit log entries are kept for one year and cannot be deleted.';
  END IF;
END //
DELIMITER ;

-- The apps' MySQL account: may add and read entries (and remove those older than a year), but has
-- no DROP right, so it cannot empty (TRUNCATE) or remove the tables. Change 'cqr'@'%' to your
-- app account as shown in phpMyAdmin > User accounts.
GRANT SELECT, INSERT, DELETE ON garuda_lms.technical_audit_log TO 'cqr'@'%';
GRANT SELECT, INSERT, DELETE ON garuda_lms.general_audit_log TO 'cqr'@'%';
FLUSH PRIVILEGES;

-- Check: 4 triggers should be listed.
SELECT TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE
  FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE LIKE '%audit_log';
