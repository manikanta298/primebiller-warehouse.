import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applySchema,schemaStatements} from '../src/schema-migration.ts';
test('main schema and standalone CA role migration use the same additive statements',()=>{
 const migration=schemaStatements(readFileSync(new URL('../db/migrations/20261012-ca-role.sql',import.meta.url),'utf8'));
 const main=schemaStatements(readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8'));
 assert.deepEqual(main.filter(s=>/^SET @ca_role_|^(?:PREPARE|EXECUTE|DEALLOCATE PREPARE) ca_role_statement/.test(s)),migration);
 assert.ok(!migration.some(s=>/DROP|DELETE|UPDATE user_roles/.test(s)));
});
test('MySQL role expansion preserves memberships and is safe to rerun', {skip:!process.env.MYSQL_MIGRATION_TEST_URL},async()=>{
 assert.match(new URL(process.env.MYSQL_MIGRATION_TEST_URL).pathname,/^\/migration_test[a-z0-9_]*$/i);
 const mysql=await import('mysql2/promise'),pool=mysql.createPool(process.env.MYSQL_MIGRATION_TEST_URL);
 const sql=readFileSync(new URL('../db/migrations/20261012-ca-role.sql',import.meta.url),'utf8');
 try{
  await pool.query('DROP TABLE IF EXISTS user_roles');
  await pool.query("CREATE TABLE user_roles (user_id VARCHAR(40),org_id VARCHAR(40),role ENUM('Owner','Manager','Storekeeper','Sales','Accountant','Driver') NOT NULL,PRIMARY KEY(user_id,org_id)) ENGINE=InnoDB");
  await pool.query("INSERT INTO user_roles VALUES ('owner','org1','Owner'),('accountant','org1','Accountant')");
  await applySchema(sql,pool);await applySchema(sql,pool);
  const [existing]=await pool.query('SELECT role FROM user_roles ORDER BY user_id');assert.deepEqual(existing.map(r=>r.role),['Accountant','Owner']);
  await pool.query("INSERT INTO user_roles VALUES ('ca','org1','Chartered Accountant')");
  const [ca]=await pool.query("SELECT role FROM user_roles WHERE user_id='ca'");assert.equal(ca[0].role,'Chartered Accountant');
 }finally{await pool.query('DROP TABLE IF EXISTS user_roles');await pool.end();}
});
