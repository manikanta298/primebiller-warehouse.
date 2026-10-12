-- Select the existing application database before running. No invoice data is updated.
-- Match each referenced ID's actual type, character set and collation.
-- Parent tables are not altered; both foreign keys remain enabled.
SET @audit_org_id_definition = (
  SELECT CONCAT(COLUMN_TYPE, ' CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orgs'
    AND COLUMN_NAME = 'id' AND DATA_TYPE IN ('char','varchar')
);
SET @audit_invoice_id_definition = (
  SELECT CONCAT(COLUMN_TYPE, ' CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices'
    AND COLUMN_NAME = 'id' AND DATA_TYPE IN ('char','varchar')
);
SET @audit_create_sql = CONCAT(
  '
CREATE TABLE IF NOT EXISTS invoice_audit_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  org_id ', @audit_org_id_definition, ' NOT NULL,
  invoice_id ', @audit_invoice_id_definition, ' NOT NULL,
  event_type ENUM(''baseline'',''issued'',''settlement_updated'',''cancelled'') NOT NULL,
  actor_id VARCHAR(40) NULL,
  actor_name VARCHAR(120) NOT NULL,
  before_snapshot JSON NULL,
  after_snapshot JSON NOT NULL,
  snapshot_sha256 CHAR(64) NULL,
  baseline_invoice_id ', @audit_invoice_id_definition, ' NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_invoice_audit_baseline (baseline_invoice_id),
  KEY ix_invoice_audit (org_id, invoice_id, id),
  CONSTRAINT fk_invoice_audit_org FOREIGN KEY (org_id) REFERENCES orgs(id),
  CONSTRAINT fk_invoice_audit_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
'
);
PREPARE audit_create_statement FROM @audit_create_sql;
EXECUTE audit_create_statement;
DEALLOCATE PREPARE audit_create_statement;

-- Optional initial baseline. This captures CURRENT state at migration time.
-- It cannot reconstruct earlier issuance, payments, cancellations or actors.
INSERT INTO invoice_audit_events
  (org_id, invoice_id, event_type, actor_name, after_snapshot, baseline_invoice_id)
SELECT i.org_id, i.id, 'baseline', 'Migration baseline', i.body, i.id
FROM invoices i
WHERE NOT EXISTS (
  SELECT 1 FROM invoice_audit_events e
  WHERE BINARY e.org_id = BINARY i.org_id AND e.invoice_id = i.id
)
ON DUPLICATE KEY UPDATE baseline_invoice_id = invoice_audit_events.baseline_invoice_id;
