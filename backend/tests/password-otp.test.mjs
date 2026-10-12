import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
process.env.DATABASE_URL='mysql://test:test@localhost/test';
process.env.JWT_SECRET='a'.repeat(64);
const {pool}=await import('../src/db.ts');
const {config}=await import('../src/config.ts');
const {createApp}=await import('../src/app.ts');
const {signToken}=await import('../src/auth.ts');

async function fixture(){
 const originals={query:pool.query,getConnection:pool.getConnection,log:console.log,mode:config.mailDeliveryMode};
 const state={user:{id:'u1',name:'Owner',email:'owner@example.com',active:1,token_version:0,password_hash:await bcrypt.hash('old-password-123',4)},challenges:new Map(),legacyUsed:false,failUpdate:false};
 const logs=[];console.log=(...args)=>{if(args[0]==='[PASSWORD RESET OTP]')logs.push(JSON.parse(args[1]));};config.mailDeliveryMode='console';
 async function query(sql,p=[]){
  if(sql.startsWith('SELECT id, token_version FROM users WHERE email'))return [p[0]===state.user.email&&state.user.active?[state.user]:[],[]];
  if(sql.startsWith('SELECT COUNT(*) AS n FROM password_reset_otp'))return [[{n:state.challenges.size}],[]];
  if(sql.startsWith('INSERT INTO password_reset_otp')){state.challenges.set(p[0],{user_id:p[1],otp_hash:p[2],user_token_version:p[3],attempts:0,used_at:null,unexpired:1});return [{},[]];}
  if(sql.startsWith('SELECT user_id FROM password_reset_otp')){const row=state.challenges.get(p[0]);return [row?[row]:[],[]];}
  if(sql.startsWith('SELECT id, active, token_version FROM users'))return [[state.user],[]];
  if(sql.startsWith('SELECT otp_hash')){const row=state.challenges.get(p[0]);return [row?[row]:[],[]];}
  if(sql.startsWith('UPDATE password_reset_otp_challenges SET attempts')){state.challenges.get(p[0]).attempts++;return [{},[]];}
  if(sql.startsWith('UPDATE password_reset_otp_challenges SET used_at')){for(const [id,row]of state.challenges)if(sql.includes('request_id = ?')?id===p[0]:row.user_id===p[0])row.used_at='used';return [{},[]];}
  if(sql.startsWith('UPDATE users SET password_hash')){state.user.password_hash=p[0];state.user.token_version++;return [{},[]];}
  if(sql.startsWith('UPDATE password_reset_tokens')){if(state.failUpdate)throw new Error('simulated reset write failure');state.legacyUsed=true;return [{},[]];}
  if(sql.startsWith('SELECT id, name, active'))return [[state.user],[]];
  if(sql.startsWith('SELECT id, password_hash'))return [p[0]===state.user.email?[state.user]:[],[]];
  if(sql.startsWith('UPDATE users SET last_login'))return [{},[]];
  if(sql.startsWith('SELECT id, name, email'))return [[state.user],[]];
  if(sql.startsWith('SELECT o.id'))return [[{id:'org1',name:'Org',gstin:'',state_code:'36',state_name:'Telangana',role:'Owner'}],[]];
  throw new Error(sql);
 }
 pool.query=query;let queue=Promise.resolve();
 pool.getConnection=async()=>{let done,snapshot;return {query,async beginTransaction(){const before=queue;queue=new Promise(r=>done=r);await before;snapshot=structuredClone(state);},async commit(){},async rollback(){Object.assign(state,snapshot);},release(){done?.();}};};
 const server=createApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/v1`;
 const post=async(path,body)=>{const r=await fetch(base+'/auth'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 return {state,logs,post,base,async close(){pool.query=originals.query;pool.getConnection=originals.getConnection;console.log=originals.log;config.mailDeliveryMode=originals.mode;server.closeAllConnections();await new Promise(r=>server.close(r));}};
}

test('console OTP is private in API responses, hashed, single-use and revokes sessions',async()=>{
 const f=await fixture();try{
  const oldToken=signToken('u1',0);
  const unknown=await f.post('/forgot-password-otp',{email:'missing@example.com'});
  const issued=await f.post('/forgot-password-otp',{email:'OWNER@EXAMPLE.COM'});
  assert.equal(unknown.status,200);assert.equal(unknown.body.message,issued.body.message);assert.match(unknown.body.requestId,/^[a-f0-9]{64}$/);assert.equal(f.logs.length,1);
  const {otp,requestId}=f.logs[0];assert.match(otp,/^\d{6}$/);assert.equal(requestId,issued.body.requestId);assert.equal(issued.body.otp,undefined);assert.equal(issued.body.expiresInSeconds,600);
  const stored=f.state.challenges.get(requestId);assert.match(stored.otp_hash,/^[a-f0-9]{64}$/);assert.notEqual(stored.otp_hash,otp);
  assert.equal((await f.post('/reset-password-otp',{requestId,otp,password:'short'})).status,422);
  assert.equal((await f.post('/reset-password-otp',{requestId,otp,password:'new-password-123'})).status,200);
  assert.equal(f.state.user.token_version,1);assert.equal(f.state.legacyUsed,true);assert.equal(await bcrypt.compare('new-password-123',f.state.user.password_hash),true);
  assert.equal((await f.post('/reset-password-otp',{requestId,otp,password:'another-password-123'})).status,400);
  const oldSession=await fetch(f.base+'/invoices/i1',{headers:{Authorization:'Bearer '+oldToken,'X-Org-Id':'org1'}});assert.equal(oldSession.status,401);
  assert.equal((await f.post('/login',{email:'owner@example.com',password:'old-password-123'})).status,401);
  assert.equal((await f.post('/login',{email:'owner@example.com',password:'new-password-123'})).status,200);
 }finally{await f.close();}
});

test('wrong attempts commit, resend invalidates old OTP, expiry and request limits fail closed',async()=>{
 const f=await fixture();try{
  await f.post('/forgot-password-otp',{email:'owner@example.com'});const first=f.logs[0];const wrong=first.otp==='000000'?'000001':'000000';
  for(let i=0;i<5;i++)assert.equal((await f.post('/reset-password-otp',{requestId:first.requestId,otp:wrong,password:'new-password-123'})).status,400);
  assert.equal(f.state.challenges.get(first.requestId).attempts,5);
  assert.equal((await f.post('/reset-password-otp',{requestId:first.requestId,otp:first.otp,password:'new-password-123'})).status,400);
  await f.post('/forgot-password-otp',{email:'owner@example.com'});const second=f.logs[1];assert.notEqual(second.requestId,first.requestId);
  assert.equal((await f.post('/reset-password-otp',{requestId:first.requestId,otp:first.otp,password:'new-password-123'})).status,400);
  f.state.challenges.get(second.requestId).unexpired=0;assert.equal((await f.post('/reset-password-otp',{requestId:second.requestId,otp:second.otp,password:'new-password-123'})).status,400);
  await f.post('/forgot-password-otp',{email:'owner@example.com'});assert.equal(f.logs.length,3);
  const throttled=await f.post('/forgot-password-otp',{email:'owner@example.com'});assert.equal(throttled.status,200);assert.equal(f.logs.length,3);assert.equal(f.state.challenges.has(throttled.body.requestId),false);
 }finally{await f.close();}
});

test('deactivated accounts, changed token version, concurrent reuse and failed reset writes are protected',async()=>{
 const f=await fixture();try{
  await f.post('/forgot-password-otp',{email:'owner@example.com'});const {otp,requestId}=f.logs[0],input={otp,requestId,password:'new-password-123'};
  f.state.user.active=0;assert.equal((await f.post('/reset-password-otp',input)).status,400);f.state.user.active=1;
  f.state.user.token_version=1;assert.equal((await f.post('/reset-password-otp',input)).status,400);f.state.user.token_version=0;
  f.state.failUpdate=true;assert.equal((await f.post('/reset-password-otp',input)).status,500);assert.equal(f.state.user.token_version,0);assert.equal(f.state.challenges.get(requestId).used_at,null);
  f.state.failUpdate=false;const results=await Promise.all([f.post('/reset-password-otp',input),f.post('/reset-password-otp',input)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(f.state.user.token_version,1);
 }finally{await f.close();}
});
