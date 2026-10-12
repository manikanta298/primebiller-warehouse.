-- Select the existing application database before running. No invoice data is updated.
CREATE TABLE IF NOT EXISTS invoice_audit_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  org_id VARCHAR(40) NOT NULL,
  invoice_id VARCHAR(40) NOT NULL,
  event_type ENUM('baseline','issued','settlement_updated','cancelled') NOT NULL,
  actor_id VARCHAR(40) NULL,
  actor_name VARCHAR(120) NOT NULL,
  before_snapshot JSON NULL,
  after_snapshot JSON NOT NULL,
  snapshot_sha256 CHAR(64) NULL,
  baseline_invoice_id VARCHAR(40) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_invoice_audit_baseline (baseline_invoice_id),
  KEY ix_invoice_audit (org_id, invoice_id, id),
  CONSTRAINT fk_invoice_audit_org FOREIGN KEY (org_id) REFERENCES orgs(id),
  CONSTRAINT fk_invoice_audit_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB;

-- Optional initial baseline. This captures CURRENT state at migration time.
-- It cannot reconstruct earlier issuance, payments, cancellations or actors.
INSERT INTO invoice_audit_events
  (org_id, invoice_id, event_type, actor_name, after_snapshot, baseline_invoice_id)
SELECT i.org_id, i.id, 'baseline', 'Migration baseline', i.body, i.id
FROM invoices i
WHERE NOT EXISTS (
  SELECT 1 FROM invoice_audit_events e
  WHERE e.org_id = i.org_id AND e.invoice_id = i.id
)
ON DUPLICATE KEY UPDATE baseline_invoice_id = invoice_audit_events.baseline_invoice_id;
