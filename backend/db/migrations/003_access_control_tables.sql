-- PrimeBiller access-control readiness -- MySQL 8.0+, phpMyAdmin compatible.
-- Select the application's database before importing. Back up first.
-- Prerequisites: the existing users, orgs and godowns tables from schema.sql.
-- These tables already exist in the full schema: no ALTER or data migration is required.
-- This script creates missing tables only, never changes roles or assignments.
-- It does NOT enforce API permissions: deploy the matching backend change as well.
SET NAMES utf8mb4;

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

-- Read-only verification. Existing tables are not silently upgraded.
SELECT DATABASE() AS selected_database;
SHOW CREATE TABLE user_roles;
SHOW CREATE TABLE user_godowns;

-- Review assignments, then use the Owner's Users screen to make changes.
SELECT ur.org_id, u.id AS user_id, u.name, ur.role,
       GROUP_CONCAT(DISTINCT CASE WHEN g.active = 1 THEN g.code END ORDER BY g.code) AS active_warehouse_codes
FROM user_roles ur
JOIN users u ON u.id = ur.user_id
LEFT JOIN user_godowns ug ON ug.user_id = u.id
LEFT JOIN godowns g ON g.id = ug.godown_id AND g.org_id = ur.org_id
GROUP BY ur.org_id, u.id, u.name, ur.role
ORDER BY ur.org_id, ur.role, u.name;

-- Any rows here need an Owner's review before enabling local accounts.
SELECT ug.user_id, ug.godown_id, g.org_id AS warehouse_org
FROM user_godowns ug
JOIN godowns g ON g.id = ug.godown_id
LEFT JOIN user_roles ur ON ur.user_id = ug.user_id AND ur.org_id = g.org_id
WHERE ur.user_id IS NULL;
