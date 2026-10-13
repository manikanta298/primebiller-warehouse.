import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bcrypt from 'bcryptjs';
process.env.DATABASE_URL='mysql://test:test@localhost/test';
process.env.JWT_SECRET='a'.repeat(64);
const {pool}=await import('../src/db.ts');
const {config}=await import('../src/config.ts');
const {createApp}=await import('../src/app.ts');
const {applySchema}=await import('../src/schema-migration.ts');

test('MySQL OTP migration and recovery persist limits across app restarts with legacy user collations',{
 skip:!process.env.MYSQL_MIGRATION_TEST_URL,
},async()=>{
 assert.match(new URL(process.env.MYSQL_MIGRATION_TEST_URL).pathname,/^\/migration_test[a-z0-9_]*$/i);
 const mysql=await import('mysql2/promise'),db=mysql.createPool(process.env.MYSQL_MIGRATION_TEST_URL);
 const originals={query:pool.query,getConnection:pool.getConnection,mode:config.mailDeliveryMode,log:console.log};
 const logs=[];let server;
 const start=async()=>{server=createApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));};
 const stop=async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));server=undefined;}};
 const post=async(path,body)=>{const res=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth`+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json()};};
 const cleanup=async()=>{for(const table of ['password_reset_otp_challenges','password_reset_tokens','users'])await db.query(`DROP TABLE IF EXISTS ${table}`);};
 try{
  await cleanup();
  await db.query("CREATE TABLE users (id CHAR(40) CHARACTER SET latin1 COLLATE latin1_swedish_ci PRIMARY KEY, email VARCHAR(190) NOT NULL UNIQUE, active TINYINT NOT NULL, password_hash VARCHAR(100), token_version INT NOT NULL) ENGINE=InnoDB");
  await db.query("CREATE TABLE password_reset_tokens (token_hash CHAR(64) PRIMARY KEY,user_id CHAR(40),used_at DATETIME NULL) ENGINE=InnoDB");
  const sql=readFileSync(new URL('../db/migrations/20261012-password-otp.sql',import.meta.url),'utf8');
  await applySchema(sql,db);await applySchema(sql,db);
  const [metadata]=await db.query("SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='users' AND COLUMN_NAME='id') OR (TABLE_NAME='password_reset_otp_challenges' AND COLUMN_NAME='user_id'))");
  assert.equal(metadata.length,2);const def=r=>[r.COLUMN_TYPE,r.CHARACTER_SET_NAME,r.COLLATION_NAME];assert.deepEqual(def(metadata[0]),def(metadata[1]));
  await db.query('INSERT INTO users VALUES (?,?,?,?,?)',['u1','owner@example.com',1,await bcrypt.hash('old-password-123',4),0]);
  await db.query('INSERT INTO password_reset_tokens VALUES (?,?,NULL)',['a'.repeat(64),'u1']);
  pool.query=db.query.bind(db);pool.getConnection=db.getConnection.bind(db);config.mailDeliveryMode='console';
  console.log=(...args)=>{if(args[0]==='[PASSWORD RESET OTP]')logs.push(JSON.parse(args[1]));};
  await start();
  const first=await post('/forgot-password-otp',{email:'owner@example.com'});assert.equal(first.status,200);assert.equal(first.body.otp,undefined);
  await stop();await start();
  const code=logs[0];const wrong=code.otp==='000000'?'000001':'000000';
  assert.equal((await post('/reset-password-otp',{requestId:code.requestId,otp:wrong,password:'new-password-123'})).status,400);
  const [attempts]=await db.query('SELECT attempts,otp_hash FROM password_reset_otp_challenges WHERE request_id=?',[code.requestId]);assert.equal(attempts[0].attempts,1);assert.notEqual(attempts[0].otp_hash,code.otp);
  await db.query('UPDATE password_reset_otp_challenges SET expires_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND WHERE request_id=?',[code.requestId]);
  assert.equal((await post('/reset-password-otp',{requestId:code.requestId,otp:code.otp,password:'new-password-123'})).status,400);
  await post('/forgot-password-otp',{email:'owner@example.com'});await post('/forgot-password-otp',{email:'owner@example.com'});
  assert.equal(logs.length,3);await stop();await start();
  const throttled=await post('/forgot-password-otp',{email:'owner@example.com'});assert.equal(throttled.status,200);assert.equal(logs.length,3);
  assert.equal((await post('/reset-password-otp',{requestId:code.requestId,otp:code.otp,password:'new-password-123'})).status,400);
  const latest=logs[2],input={requestId:latest.requestId,otp:latest.otp,password:'new-password-123'};
  const results=await Promise.all([post('/reset-password-otp',input),post('/reset-password-otp',input)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
  const [user]=await db.query('SELECT password_hash,token_version FROM users');assert.equal(user[0].token_version,1);assert.equal(await bcrypt.compare(input.password,user[0].password_hash),true);
  const [tokens]=await db.query('SELECT used_at FROM password_reset_tokens');assert.ok(tokens[0].used_at);
 }finally{await stop();pool.query=originals.query;pool.getConnection=originals.getConnection;config.mailDeliveryMode=originals.mode;console.log=originals.log;await cleanup();await db.end();}
});
