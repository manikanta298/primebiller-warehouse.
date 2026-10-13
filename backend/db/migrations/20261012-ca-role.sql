-- Run the entire file in the current application database. Existing users and roles are preserved.
SET @ca_role_migration = (
  SELECT IF(LOCATE('''Chartered Accountant''', COLUMN_TYPE) > 0,
    'SELECT 1',
    CONCAT('ALTER TABLE user_roles MODIFY COLUMN role ',
      LEFT(COLUMN_TYPE, CHAR_LENGTH(COLUMN_TYPE) - 1),
      ',''Chartered Accountant'') NOT NULL'))
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_roles'
    AND COLUMN_NAME = 'role' AND DATA_TYPE = 'enum'
);
PREPARE ca_role_statement FROM @ca_role_migration;
EXECUTE ca_role_statement;
DEALLOCATE PREPARE ca_role_statement;
