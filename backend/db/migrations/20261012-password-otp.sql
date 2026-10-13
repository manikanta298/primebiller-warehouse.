-- Run the whole file in the existing application database, in one session.
SET @otp_user_id_definition = (
  SELECT CONCAT(COLUMN_TYPE, ' CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'id' AND DATA_TYPE IN ('char','varchar')
);
SET @otp_create_sql = CONCAT('
CREATE TABLE IF NOT EXISTS password_reset_otp_challenges (
  request_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id ', @otp_user_id_definition, ' NOT NULL,
  otp_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_token_version INT NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  requested_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  KEY ix_otp_user_requested (user_id, requested_at),
  CONSTRAINT fk_password_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
');
PREPARE otp_create_statement FROM @otp_create_sql;
EXECUTE otp_create_statement;
DEALLOCATE PREPARE otp_create_statement;
