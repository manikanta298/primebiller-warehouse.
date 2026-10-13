import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL='mysql://test:test@localhost/test';
process.env.JWT_SECRET='a'.repeat(64);
const {pool,withTransaction}=await import('../src/db.ts');
const {Uow}=await import('../src/uow.ts');
const {createApp}=await import('../src/app.ts');
const {signToken}=await import('../src/auth.ts');
const {snapshotHash}=await import('../src/invoice-audit.ts');

test('invoice allocation, immutable posting, audit rollback and tenant-scoped read API',async()=>{
 const oldQuery=pool.query,oldConnection=pool.getConnection;
 let role='Owner',prefix='INV',padding=5,counter=0,invoice,events=[],failAudit=false;
 const ctx={userId:'u1',userName:'Owner',orgId:'org1',role:'Owner',orgStateCode:'36',orgGstin:''};
 async function query(sql,p=[]){
  if(sql.startsWith('SELECT id, name, active'))return [[{id:'u1',name:'Owner',active:1,token_version:0}],[]];
  if(sql.startsWith('SELECT ur.role'))return [p[1]==='other'?[]:[{role,id:'org1',state_code:'36',gstin:''}],[]];
  if(sql.startsWith('SELECT g.id FROM user_godowns'))return [[],[]];
  if(sql.startsWith('SELECT prefix')){assert.ok(sql.includes('FOR UPDATE'));return [[{prefix,padding,reset_per_fy:1}],[]];}
  if(sql.startsWith('INSERT IGNORE INTO doc_counters'))return [{},[]];
  if(sql.startsWith('SELECT last_number')){assert.ok(sql.includes('FOR UPDATE'));return [[{last_number:counter}],[]];}
  if(sql.startsWith('UPDATE doc_counters')){counter=p[0];return [{},[]];}
  if(sql.startsWith('SELECT body FROM invoices')){assert.equal(p[0],'org1');return [invoice&&p[1]===invoice.id?[{body:JSON.stringify(invoice)}]:[],[]];}
  if(sql.startsWith('INSERT INTO invoices')){invoice=JSON.parse(p[7]);return [{},[]];}
  if(sql.startsWith('INSERT INTO invoice_audit_events')){
   if(failAudit)throw new Error('simulated audit failure');
   events.push({id:String(events.length+1),event_type:p[2],actor_id:p[3],actor_name:p[4],before_snapshot:p[5],after_snapshot:p[6],snapshot_sha256:p[7],created_at:'2026-10-12T00:00:00Z'});return [{},[]];
  }
  if(sql.startsWith('SELECT CAST(id AS CHAR)')){assert.equal(p[0],'org1');assert.equal(p[1],'i1');return [events.filter(e=>Number(e.id)>Number(p[2])).slice(0,p[3]),[]];}
  throw new Error(sql);
 }
 pool.query=query;
 let queue=Promise.resolve();
 pool.getConnection=async()=>{let release,before;return {query,async beginTransaction(){const prev=queue;queue=new Promise(r=>release=r);await prev;before=structuredClone({counter,invoice,events});},async commit(){},async rollback(){({counter,invoice,events}=before);},release(){release?.();}};};
 const post=fn=>withTransaction(async conn=>{const u=new Uow(conn,ctx);const result=await fn(u);await u.flush();return result;});
 const baseInvoice={id:'i1',date:'2026-10-12',dueDate:'2026-10-12',customerId:'p1',customerName:'Customer',placeOfSupplyCode:'36',placeOfSupplyName:'Telangana',supply:'intra',challans:[],lines:[],taxable:100,cgst:9,sgst:9,igst:0,roundOff:0,grandTotal:118,byRate:[],advances:[],paid:0,balance:118,status:'awaiting_payment',createdBy:'Owner'};
 const server=createApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 async function get(path){const res=await fetch(`http://127.0.0.1:${server.address().port}/api/v1`+path,{headers:{Authorization:'Bearer '+signToken('u1',0),'X-Org-Id':'org1'}});return {status:res.status,body:await res.json()};}
 try{
  prefix='ABCDEF';padding=6;
  await assert.rejects(post(u=>u.next('INV','2026-10-12')),e=>e.code==='invalid_invoice_number');assert.equal(counter,0);
  prefix='INV';padding=5;failAudit=true;
  await assert.rejects(post(async u=>{const n=await u.next('INV',baseInvoice.date);u.put('invoices',{...baseInvoice,number:n.number});}),/simulated audit failure/);
  assert.equal(counter,0);assert.equal(invoice,undefined);assert.equal(events.length,0);failAudit=false;
  await post(async u=>{const n=await u.next('INV',baseInvoice.date);u.put('invoices',{...baseInvoice,number:n.number});});
  assert.equal(counter,1);assert.equal(events[0].event_type,'issued');assert.equal(events[0].snapshot_sha256,snapshotHash(invoice));
  for(const [field,value] of [['number','OTHER/1'],['date','2026-10-11'],['grandTotal',1],['lines',[{itemId:'other'}]],['customerId','other'],['billingAddress','Modified address'],['customerPhone','9999999999']]){
   await assert.rejects(post(u=>{u.put('invoices',{...invoice,[field]:value});return Promise.resolve();}),e=>e.code==='invoice_immutable');
  }
  assert.equal(events.length,1);assert.equal(invoice.grandTotal,118);
  await post(u=>{u.put('invoices',{...invoice,paid:50,balance:68,status:'partially_paid'});return Promise.resolve();});
  assert.equal(events[1].event_type,'settlement_updated');assert.equal(JSON.parse(events[1].before_snapshot).paid,0);
  await post(u=>{u.put('invoices',{...invoice,balance:0,status:'cancelled',cancelled:{at:'2026-10-12',by:'Owner',reason:'Test'}});return Promise.resolve();});
  assert.equal(events[2].event_type,'cancelled');assert.equal(counter,1);
  const concurrent=await Promise.all([post(u=>u.next('INV','2026-10-12')),post(u=>u.next('INV','2026-10-12'))]);assert.deepEqual(concurrent.map(x=>x.seq),[2,3]);
  role='Sales';assert.equal((await get('/invoices/i1/audit')).status,403);
  for(role of ['Owner','Manager','Accountant']){const response=await get('/invoices/i1/audit?limit=1');assert.equal(response.status,200);assert.equal(response.body.events.length,1);assert.equal(response.body.nextCursor,'1');}
  const next=await get('/invoices/i1/audit?after=1&limit=2');assert.equal(next.body.events.length,2);assert.equal(next.body.nextCursor,null);
  assert.equal((await get('/invoices/missing/audit')).status,404);
  assert.equal((await get('/invoices/i1/audit?limit=101')).status,422);
  assert.equal((await get('/invoices/i1/audit?after=bad')).status,422);
  const denied=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/invoices/i1/audit`,{headers:{Authorization:'Bearer '+signToken('u1',0),'X-Org-Id':'other'}});assert.equal(denied.status,403);
 }finally{pool.query=oldQuery;pool.getConnection=oldConnection;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
