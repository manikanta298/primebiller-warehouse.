-- PrimeBiller quotations: additive migration for MySQL 8.0+ / phpMyAdmin.
-- Back up first and select the app database. Requires the existing base schema.
-- No existing tables, rows, roles, or counters are altered.
CREATE TABLE IF NOT EXISTS quotations LIKE sales_orders;
CREATE TABLE IF NOT EXISTS quotation_counters (
  org_id VARCHAR(40) NOT NULL,
  fy VARCHAR(5) NOT NULL,
  last_number INT NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, fy)
) ENGINE=InnoDB;
