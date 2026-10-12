import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
process.env.DATABASE_URL='mysql://test:test@localhost/test';process.env.JWT_SECRET='a'.repeat(64);
const {pool}=await import('../src/db.ts');
const {createApp}=await import('../src/app.ts');
const {signToken}=await import('../src/auth.ts');
test('CA reads scoped records and workpapers but cannot mutate, expose credentials or cross organisations',async()=>{
 const oldQuery=pool.query,oldConnection=pool.getConnection;let role='Chartered Accountant',writes=0,begins=0;
 const invoice={id:'i1',number:'INV/26-27/00001',date:'2026-10-01',dueDate:'2026-10-01',customerId:'p1',customerName:'=HYPERLINK("evil")',placeOfSupplyCode:'36',placeOfSupplyName:'Telangana',supply:'intra',gstin:'36TEST',lines:[],challans:[],taxable:100,cgst:9,sgst:9,igst:0,grandTotal:118,roundOff:0,byRate:[{rate:18,taxable:100,tax:18}],paid:0,balance:118,advances:[],status:'awaiting_payment'};
 const original=JSON.stringify(invoice);
 async function query(sql,p=[]){
  if(sql.startsWith('SELECT id, name, active'))return [[{id:'u1',name:'CA',active:1,token_version:0}],[]];
  if(sql.startsWith('SELECT ur.role'))return [p[1]==='other'?[]:[{role,id:'org1',state_code:'36',gstin:'36TEST'}],[]];
  if(sql.startsWith('SELECT g.id FROM user_godowns'))return [[],[]];
  if(sql.startsWith('SET TRANSACTION'))return [{},[]];
  if(sql.startsWith('SELECT id, name, gstin FROM orgs')){assert.equal(p[0],'org1');return [[{id:'org1',name:'Org',gstin:'36TEST'}],[]];}
  if(sql.startsWith('SELECT COUNT(*)')){assert.equal(p[0],'org1');assert.ok(sql.includes('WHERE org_id = ?'));return [[{n:2}],[]];}
  if(sql.startsWith('SELECT CAST(id AS CHAR) AS id, ')){assert.equal(p[0],'org1');assert.ok(sql.includes('WHERE org_id = ?'));return [[{id:'i1',label:invoice.number,number:invoice.number,date:invoice.date,status:invoice.status,total:118}],[]];}
  if(sql.startsWith('SELECT * FROM invoices')){assert.equal(p[0],'org1');return [p[1]==='i1'?[{body:JSON.stringify(invoice)}]:[],[]];}
  if(sql.startsWith('SELECT body FROM invoices')){assert.equal(p[0],'org1');return [p[1]==='i1'||p[1]==='2026-10-01'?[{body:JSON.stringify(invoice)}]:[],[]];}
  if(sql.includes('FROM invoice_audit_events')){assert.equal(p[0],'org1');return [[{id:'1',event_type:'issued',after_snapshot:JSON.stringify(invoice),actor_name:'Owner'}],[]];}
  if(/^(INSERT|UPDATE|DELETE|ALTER)/.test(sql)){writes++;throw new Error('Unexpected mutation');}
  throw new Error(sql);
 }
 pool.query=query;pool.getConnection=async()=>({query,async beginTransaction(){begins++;},async commit(){},async rollback(){},release(){}});
 const server=createApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api/v1`;
 async function request(path,method='GET',org='org1'){const res=await fetch(base+path,{method,headers:{Authorization:'Bearer '+signToken('u1',0),'X-Org-Id':org,'Content-Type':'application/json'},body:['GET','HEAD'].includes(method)?undefined:JSON.stringify({reason:'Attempted modification'})});return {status:res.status,body:method==='HEAD'?null:await res.json()};}
 try{
  const overview=await request('/ca/overview');assert.equal(overview.status,200);assert.equal(Object.keys(overview.body.counts).length,18);
  for(const collection of Object.keys(overview.body.counts))assert.equal((await request('/ca/records/'+collection)).status,200,collection);
  assert.equal((await request('/ca/records/invoices/i1')).body.record.number,invoice.number);
  assert.equal((await request('/ca/records/invoices/foreign')).status,404);
  assert.equal((await request('/ca/overview','GET','other')).status,403);
  assert.equal((await request('/ca/invoices/i1/audit')).status,200);
  for(const path of ['/users','/settings','/ca/records/users','/ca/records/org_settings'])assert.ok([403,422].includes((await request(path)).status),path);
  for(const method of ['POST','PUT','PATCH','DELETE'])for(const path of ['/invoices/i1/cancel','/receipts','/items/i1','/parties/p1','/settings','/users','/import/parse','/ca/records/invoices/i1'])assert.equal((await request(path,method)).status,403,method+path);
  for(const report of ['gstr1','gstr3b','sales'])for(const format of ['csv','json']){
   const result=await request(`/ca/reports/${report}/export?period=2026-10&format=${format}`);assert.equal(result.status,200,JSON.stringify(result.body));
   assert.equal(result.body.metadata.orgId,'org1');assert.equal(result.body.metadata.status,'DRAFT_WORKPAPER');assert.equal(result.body.sha256,createHash('sha256').update(result.body.content).digest('hex'));
   if(report==='gstr3b'&&format==='json'){const data=JSON.parse(result.body.content).data;assert.equal(data.pendingReview.eligibleItc,null);assert.equal(data.outwardTaxableFromBooks.cgst,9);}
   if(report==='sales'&&format==='csv')assert.ok(result.body.content.includes("'=HYPERLINK"));
  }
  assert.ok(begins>=6);assert.equal((await request('/ca/reports/gstr3b/export?period=2026-13')).status,422);
  assert.equal((await request('/ca/records/invoices?limit=101')).status,422);
  role='Sales';assert.equal((await request('/ca/overview')).status,403);
  role='Owner';assert.equal((await request('/ca/overview')).status,200);
  assert.equal(writes,0);assert.equal(JSON.stringify(invoice),original);
 }finally{pool.query=oldQuery;pool.getConnection=oldConnection;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
