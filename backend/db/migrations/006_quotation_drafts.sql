-- Personal quotation work in progress. Additive, no changes to existing documents.
-- IDs intentionally have no foreign keys: existing installations use varying ID collations.
CREATE TABLE IF NOT EXISTS quotation_drafts (
  org_id VARCHAR(40) NOT NULL,
  user_id VARCHAR(40) NOT NULL,
  draft_key VARCHAR(40) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 0,
  body JSON NULL,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (org_id, user_id, draft_key)
) ENGINE=InnoDB;
