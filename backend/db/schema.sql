-- Girder — MySQL 8 schema. Money DECIMAL(15,2), quantities DECIMAL(15,3), rates DECIMAL(15,4). Never FLOAT.
-- Masters, users/roles, stock balances, batches and the stock ledger are fully relational.
-- Business documents (orders, challans, invoices, ...) keep searchable header columns plus the full
-- document (lines, events, e-way bill, links) in a JSON `body` column, matching the API shape 1:1.

SET NAMES utf8mb4;
-- Safe to re-run: every table is created only if missing. No data is inserted.
SET FOREIGN_KEY_CHECKS = 0;


SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE IF NOT EXISTS orgs (
  id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  gstin CHAR(15) NOT NULL,
  state_code CHAR(2) NOT NULL,
  state_name VARCHAR(60) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS godowns (
  id VARCHAR(40) PRIMARY KEY,
  org_id VARCHAR(40) NOT NULL,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(120) NOT NULL,
  type ENUM('godown','yard','shop_counter','transit') NOT NULL DEFAULT 'godown',
  address VARCHAR(400) NULL,
  state_code CHAR(2) NULL,
  gstin CHAR(15) NULL,
  manager VARCHAR(120) NULL,
  allow_negative TINYINT(1) NOT NULL DEFAULT 0,
  default_for_sales TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_godown_code (org_id, code),
  CONSTRAINT fk_godown_org FOREIGN KEY (org_id) REFERENCES orgs(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  mobile VARCHAR(20) NOT NULL DEFAULT '',
  password_hash VARCHAR(100) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  invite_token CHAR(64) NULL,
  invite_expires_at DATETIME NULL,
  token_version INT NOT NULL DEFAULT 0,
  last_login DATE NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Single-use password recovery links (hashes only; no raw email tokens retained).
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  user_id VARCHAR(40) NOT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  KEY ix_reset_user_requested (user_id, requested_at),
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Roles live in their own table (one role per user per org), never on users.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id VARCHAR(40) NOT NULL,
  org_id VARCHAR(40) NOT NULL,
  role ENUM('Owner','Manager','Storekeeper','Sales','Accountant','Driver') NOT NULL,
  PRIMARY KEY (user_id, org_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_ur_org FOREIGN KEY (org_id) REFERENCES orgs(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_godowns (
  user_id VARCHAR(40) NOT NULL,
  godown_id VARCHAR(40) NOT NULL,
  PRIMARY KEY (user_id, godown_id),
  CONSTRAINT fk_ug_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_ug_godown FOREIGN KEY (godown_id) REFERENCES godowns(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS uoms (
  id VARCHAR(40) PRIMARY KEY, org_id VARCHAR(40) NOT NULL,
  code VARCHAR(12) NOT NULL, name VARCHAR(60) NOT NULL,
  category ENUM('weight','count','length','volume','area') NOT NULL, decimals TINYINT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_uom (org_id, code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(40) PRIMARY KEY, org_id VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL, parent_id VARCHAR(40) NULL,
  default_hsn VARCHAR(8) NOT NULL DEFAULT '', default_gst DECIMAL(5,2) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_cat (org_id, name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS brands (
  id VARCHAR(40) PRIMARY KEY, org_id VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_brand (org_id, name)
) ENGINE=InnoDB;

-- Date-effective: a rate change is a new row; history is kept.
CREATE TABLE IF NOT EXISTS hsn_rates (
  id VARCHAR(40) PRIMARY KEY, org_id VARCHAR(40) NOT NULL,
  code VARCHAR(8) NOT NULL, description VARCHAR(200) NOT NULL DEFAULT '',
  gst_rate DECIMAL(5,2) NOT NULL, cess_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_hsn (org_id, code, effective_from)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS items (
  id VARCHAR(40) PRIMARY KEY,
  org_id VARCHAR(40) NOT NULL,
  sku VARCHAR(40) NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT '',
  brand VARCHAR(80) NOT NULL DEFAULT '',
  hsn VARCHAR(8) NOT NULL,
  gst_rate DECIMAL(5,2) NOT NULL,
  base_uom VARCHAR(12) NOT NULL,
  conversions JSON NOT NULL,
  sale_price DECIMAL(15,4) NOT NULL DEFAULT 0,
  cost_price DECIMAL(15,4) NOT NULL DEFAULT 0,
  allow_negative TINYINT(1) NOT NULL DEFAULT 0,
  track_batches TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_sku (org_id, sku),
  FULLTEXT KEY ft_item (name, sku, brand)
) ENGINE=InnoDB;

-- Stock per item per godown. `held` = reserved by confirmed sales orders.
CREATE TABLE IF NOT EXISTS item_stock (
  org_id VARCHAR(40) NOT NULL,
  item_id VARCHAR(40) NOT NULL,
  godown_id VARCHAR(40) NOT NULL,
  on_hand DECIMAL(15,3) NOT NULL DEFAULT 0,
  held DECIMAL(15,3) NOT NULL DEFAULT 0,
  reorder_level DECIMAL(15,3) NOT NULL DEFAULT 0,
  max_level DECIMAL(15,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, godown_id),
  CONSTRAINT fk_is_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT fk_is_godown FOREIGN KEY (godown_id) REFERENCES godowns(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS batches (
  id VARCHAR(40) PRIMARY KEY,
  org_id VARCHAR(40) NOT NULL,
  item_id VARCHAR(40) NOT NULL,
  godown_id VARCHAR(40) NOT NULL,
  batch_no VARCHAR(60) NOT NULL,
  heat_no VARCHAR(60) NULL,
  qty DECIMAL(15,3) NOT NULL DEFAULT 0,
  mfg_date DATE NOT NULL,
  expiry_date DATE NULL,
  received_date DATE NOT NULL,
  UNIQUE KEY uq_batch (item_id, godown_id, batch_no),
  KEY ix_batch_lookup (org_id, godown_id, item_id, batch_no),
  CONSTRAINT fk_b_item FOREIGN KEY (item_id) REFERENCES items(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS parties (
  id VARCHAR(40) PRIMARY KEY,
  org_id VARCHAR(40) NOT NULL,
  kind ENUM('customer','supplier','both','transporter') NOT NULL,
  name VARCHAR(200) NOT NULL,
  trade_name VARCHAR(200) NULL,
  gstin CHAR(15) NULL,
  pan CHAR(10) NULL,
  email VARCHAR(190) NULL,
  phone VARCHAR(40) NOT NULL DEFAULT '',
  address VARCHAR(400) NULL,
  city VARCHAR(120) NOT NULL DEFAULT '',
  pin CHAR(6) NULL,
  state_code CHAR(2) NOT NULL,
  state_name VARCHAR(60) NOT NULL,
  credit_limit DECIMAL(15,2) NOT NULL DEFAULT 0,
  credit_days INT NOT NULL DEFAULT 30,
  outstanding DECIMAL(15,2) NOT NULL DEFAULT 0,
  blocked TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_party_gstin (org_id, gstin),
  FULLTEXT KEY ft_party (name, phone)
) ENGINE=InnoDB;

-- ---------- Documents (header columns + full JSON body) ----------
CREATE TABLE IF NOT EXISTS sales_orders (
  id VARCHAR(40) PRIMARY KEY, org_id VARCHAR(40) NOT NULL, number VARCHAR(40) NULL, doc_date DATE NOT NULL,
  party_id VARCHAR(40) NULL, status VARCHAR(30) NULL, total DECIMAL(15,2) NOT NULL DEFAULT 0, body JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_so_no (org_id, number), KEY ix_so (org_id, status, doc_date)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS challans LIKE sales_orders;
CREATE TABLE IF NOT EXISTS invoices LIKE sales_orders;
CREATE TABLE IF NOT EXISTS receipts LIKE sales_orders;
-- Advances carry no unique document number.
CREATE TABLE IF NOT EXISTS advances (
  id VARCHAR(40) PRIMARY KEY, org_id VARCHAR(40) NOT NULL, number VARCHAR(40) NULL, doc_date DATE NOT NULL,
  party_id VARCHAR(40) NULL, status VARCHAR(30) NULL, total DECIMAL(15,2) NOT NULL DEFAULT 0, body JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_so (org_id, status, doc_date)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS purchase_orders LIKE sales_orders;
CREATE TABLE IF NOT EXISTS grns LIKE sales_orders;
-- Prevent the same supplier invoice from being posted twice inside an organisation,
-- including two concurrent direct receipts on separate API workers.
CREATE TABLE IF NOT EXISTS grn_invoice_registry (
  org_id VARCHAR(40) NOT NULL,
  supplier_id VARCHAR(40) NOT NULL,
  invoice_key VARCHAR(100) NOT NULL,
  grn_id VARCHAR(40) NOT NULL,
  PRIMARY KEY (org_id, supplier_id, invoice_key),
  KEY ix_grn_invoice_grn (grn_id)
) ENGINE=InnoDB;
-- Idempotently seed the unique registry for GRNs posted before Stage 13.
-- If legacy data already contains duplicates, INSERT IGNORE keeps one key; those
-- historical documents must be reconciled manually and are not deleted.
INSERT IGNORE INTO grn_invoice_registry (org_id, supplier_id, invoice_key, grn_id)
SELECT org_id, party_id, UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(body, '$.supplierInvoiceNo')))), id
FROM grns
WHERE party_id IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(body, '$.supplierInvoiceNo')) IS NOT NULL
  AND CHAR_LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(body, '$.supplierInvoiceNo')))) BETWEEN 1 AND 100;
CREATE TABLE IF NOT EXISTS transfers LIKE sales_orders;
CREATE TABLE IF NOT EXISTS adjustments LIKE sales_orders;

-- Append-only stock ledger. In production, grant the app user INSERT/SELECT only on this table.
CREATE TABLE IF NOT EXISTS stock_ledger (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  org_id VARCHAR(40) NOT NULL,
  at DATETIME NOT NULL,
  doc_no VARCHAR(40) NOT NULL,
  doc_type ENUM('opening','grn','transfer','challan','adjustment') NOT NULL,
  so_id VARCHAR(40) NULL,
  type ENUM('OPENING','PURCHASE_IN','TRANSFER_IN','TRANSFER_OUT','DC_ISSUE','DC_REVERSE','ADJ_IN','ADJ_OUT') NOT NULL,
  item_id VARCHAR(40) NOT NULL,
  item_name VARCHAR(200) NOT NULL,
  godown_id VARCHAR(40) NOT NULL,
  godown_name VARCHAR(120) NOT NULL,
  batch_no VARCHAR(60) NULL,
  qty DECIMAL(15,3) NOT NULL,
  unit_cost DECIMAL(15,4) NOT NULL,
  user_name VARCHAR(120) NOT NULL,
  reason VARCHAR(300) NULL,
  KEY ix_ledger (org_id, godown_id, item_id, batch_no),
  KEY ix_ledger_doc (org_id, doc_no)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS doc_series (
  org_id VARCHAR(40) NOT NULL,
  doc_type ENUM('SO','DC','INV','RCT','PO','GRN','TRF','ADJ') NOT NULL,
  prefix VARCHAR(6) NOT NULL,
  padding TINYINT NOT NULL DEFAULT 5,
  reset_per_fy TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, doc_type)
) ENGINE=InnoDB;

-- Row-locked with SELECT ... FOR UPDATE inside the posting transaction → gapless invoice numbers.
CREATE TABLE IF NOT EXISTS doc_counters (
  org_id VARCHAR(40) NOT NULL,
  doc_type ENUM('SO','DC','INV','RCT','PO','GRN','TRF','ADJ') NOT NULL,
  fy VARCHAR(5) NOT NULL,
  last_number INT NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, doc_type, fy)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS org_settings (
  org_id VARCHAR(40) PRIMARY KEY,
  body JSON NOT NULL,
  gsp_secret_enc VARBINARY(512) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS print_profiles (
  org_id VARCHAR(40) NOT NULL,
  id CHAR(1) NOT NULL,
  body JSON NOT NULL,
  PRIMARY KEY (org_id, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(40) PRIMARY KEY,
  org_id VARCHAR(40) NOT NULL,
  title VARCHAR(300) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  KEY ix_notif (org_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alert_acks (
  org_id VARCHAR(40) NOT NULL,
  alert_id VARCHAR(200) NOT NULL,
  acked_by VARCHAR(40) NOT NULL,
  acked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (org_id, alert_id)
) ENGINE=InnoDB;
