-- Stage 13: safe, repeatable upgrade for existing MySQL 8.0+ deployments.
-- Run npm run db:migrate, which applies schema.sql including this upgrade,
-- or execute these statements manually if the service is not container-managed.
CREATE TABLE IF NOT EXISTS grn_invoice_registry (
  org_id VARCHAR(40) NOT NULL,
  supplier_id VARCHAR(40) NOT NULL,
  invoice_key VARCHAR(100) NOT NULL,
  grn_id VARCHAR(40) NOT NULL,
  PRIMARY KEY (org_id, supplier_id, invoice_key),
  KEY ix_grn_invoice_grn (grn_id)
) ENGINE=InnoDB;

INSERT IGNORE INTO grn_invoice_registry (org_id, supplier_id, invoice_key, grn_id)
SELECT org_id, party_id, UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(body, '$.supplierInvoiceNo')))), id
FROM grns
WHERE party_id IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(body, '$.supplierInvoiceNo')) IS NOT NULL
  AND CHAR_LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(body, '$.supplierInvoiceNo')))) BETWEEN 1 AND 100;
