-- Additive warehouse moving-average valuation. Existing quantities and history are untouched.
-- NULL retains the existing item default cost until this warehouse next receives stock.
SET @warehouse_cost_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'item_stock' AND COLUMN_NAME = 'unit_cost') = 0,
  'ALTER TABLE item_stock ADD COLUMN unit_cost DECIMAL(18,2) NULL',
  'SELECT 1'
);
PREPARE warehouse_cost_statement FROM @warehouse_cost_ddl;
EXECUTE warehouse_cost_statement;
DEALLOCATE PREPARE warehouse_cost_statement;
