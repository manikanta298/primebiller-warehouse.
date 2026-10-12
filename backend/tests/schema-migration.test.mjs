import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applySchema,schemaStatements} from '../src/schema-migration.ts';

test('migration preserves one connection for metadata variables and prepared DDL',async()=>{
 const sql=readFileSync(new URL('../db/migrations/20261012-invoice-audit.sql',import.meta.url),'utf8');
 const statements=schemaStatements(sql),calls=[];
 let connections=0,releases=0;
 const pool={async getConnection(){connections++;return {async query(s){calls.push(s);},release(){releases++;}};}};
 assert.equal(await applySchema(sql,pool),statements.length);
 assert.equal(connections,1);assert.equal(releases,1);assert.deepEqual(calls,statements);
 const prepare=calls.findIndex(s=>s.startsWith('PREPARE'));
 assert.ok(prepare>2);assert.ok(calls[prepare+1].startsWith('EXECUTE'));assert.ok(calls[prepare+2].startsWith('DEALLOCATE'));
 const main=schemaStatements(readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8'));
 assert.deepEqual(main.filter(s=>/^SET @audit_|^(?:PREPARE|EXECUTE|DEALLOCATE)/.test(s)),statements.slice(0,6));
 assert.ok(!statements.some(s=>/FOREIGN_KEY_CHECKS\s*=\s*0|ALTER TABLE|DROP TABLE/i.test(s)));
});

test('migration stops on DDL failure and releases the connection',async()=>{
 const calls=[];let released=false;
 const cause=Object.assign(new Error('incompatible columns'),{code:'ER_FK_INCOMPATIBLE_COLUMNS'});
 await assert.rejects(applySchema('SET @x = 1;\nEXECUTE bad;\nSELECT 1;',{
  async getConnection(){return {async query(s){calls.push(s);if(s.startsWith('EXECUTE'))throw cause;},release(){released=true;}};}
 }),error=>error.cause===cause&&/statement 2/.test(error.message));
 assert.equal(released,true);assert.deepEqual(calls,['SET @x = 1','EXECUTE bad']);
});

test('MySQL 8 creates foreign keys with differing parent collations and preserves invoices',{
 skip:!process.env.MYSQL_MIGRATION_TEST_URL,
},async()=>{
 const url=new URL(process.env.MYSQL_MIGRATION_TEST_URL);
 assert.match(url.pathname,/^\/migration_test[a-z0-9_]*$/i,'Use an isolated migration_test database only');
 const mysql=await import('mysql2/promise');
 const pool=mysql.createPool(process.env.MYSQL_MIGRATION_TEST_URL);
 const migration=readFileSync(new URL('../db/migrations/20261012-invoice-audit.sql',import.meta.url),'utf8');
 const cleanup=async()=>{for(const table of ['invoice_audit_events','invoices','orgs'])await pool.query(`DROP TABLE IF EXISTS ${table}`);};
 try{
  for(const [orgDefinition,invoiceDefinition] of [
   ['VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci','VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'],
   ['CHAR(40) CHARACTER SET latin1 COLLATE latin1_swedish_ci','VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'],
  ]){
   await cleanup();
   await pool.query(`CREATE TABLE orgs (id ${orgDefinition} PRIMARY KEY) ENGINE=InnoDB`);
   await pool.query(`CREATE TABLE invoices (id ${invoiceDefinition} PRIMARY KEY, org_id ${orgDefinition} NOT NULL, body JSON NOT NULL) ENGINE=InnoDB`);
   const body=JSON.stringify({id:'invoice1',number:'INV/26-27/00001',grandTotal:118});
   await pool.query("INSERT INTO orgs(id) VALUES ('org1')");
   await pool.query('INSERT INTO invoices(id,org_id,body) VALUES (?,?,?)',['invoice1','org1',body]);
   await applySchema(migration,pool);await applySchema(migration,pool);
   const [metadata]=await pool.query("SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('orgs','invoices','invoice_audit_events')");
   const def=(table,column)=>{const r=metadata.find(r=>r.TABLE_NAME===table&&r.COLUMN_NAME===column);return [r.COLUMN_TYPE,r.CHARACTER_SET_NAME,r.COLLATION_NAME];};
   assert.deepEqual(def('invoice_audit_events','org_id'),def('orgs','id'));
   assert.deepEqual(def('invoice_audit_events','invoice_id'),def('invoices','id'));
   assert.deepEqual(def('invoice_audit_events','baseline_invoice_id'),def('invoices','id'));
   const [events]=await pool.query('SELECT * FROM invoice_audit_events');assert.equal(events.length,1);assert.equal(events[0].event_type,'baseline');
   const [original]=await pool.query('SELECT body FROM invoices');assert.deepEqual(original[0].body,JSON.parse(body));
   const [fks]=await pool.query("SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='invoice_audit_events'");assert.equal(fks.length,2);
   await assert.rejects(pool.query("INSERT INTO invoice_audit_events(org_id,invoice_id,event_type,actor_name,after_snapshot) VALUES ('missing','invoice1','issued','Tester','{}')"),e=>e.code==='ER_NO_REFERENCED_ROW_2');
   await assert.rejects(pool.query("INSERT INTO invoice_audit_events(org_id,invoice_id,event_type,actor_name,after_snapshot) VALUES ('org1','missing','issued','Tester','{}')"),e=>e.code==='ER_NO_REFERENCED_ROW_2');
  }
 }finally{await cleanup();await pool.end();}
});
