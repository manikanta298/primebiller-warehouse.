import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL='mysql://test:test@localhost/test';
process.env.JWT_SECRET='a'.repeat(64);
const {pool}=await import('../src/db.ts');
const {createApp}=await import('../src/app.ts');
const {signToken}=await import('../src/auth.ts');

test('DELETE endpoints authorize tenant/admin and preserve used records across all document types',async()=>{
 const oldQuery=pool.query,oldConnection=pool.getConnection;
 let role='Owner', stock=false,batches=false,ledger=false,assigned=false,balance=0,history=[],deletes=[],rollback=0,failDelete=false;
 async function query(sql,p=[]){
  if(sql.startsWith('SELECT id, name, active'))return [[{id:'u1',name:'Owner',active:1,token_version:0}],[]];
  if(sql.startsWith('SELECT ur.role'))return [[{role,id:'org1',state_code:'36',gstin:''}],[]];
  if(sql.startsWith('SELECT g.id FROM user_godowns'))return [[],[]];
  if(sql.startsWith('SELECT * FROM ')){assert.ok(sql.includes('FOR UPDATE'));assert.equal(p[0],'org1');return [p[1]==='missing'?[]:[{id:p[1],outstanding:balance}],[]];}
  if(sql.startsWith('SELECT')&&sql.includes('FROM item_stock'))return [stock?[{item_id:'i1'}]:[],[]];
  if(sql.includes('FROM batches'))return [batches?[{id:'b1'}]:[],[]];
  if(sql.includes('FROM stock_ledger'))return [ledger?[{id:1}]:[],[]];
  if(sql.includes('FROM user_godowns'))return [assigned?[{user_id:'u1'}]:[],[]];
  if(sql.startsWith('SELECT body')){assert.equal(p[0],'org1');const table=sql.match(/FROM (\w+)/)[1];return [history.filter(x=>x.table===table).map(x=>({body:JSON.stringify(x.body)})),[]];}
  if(sql.startsWith('DELETE')){assert.ok(sql.includes('org_id = ?'));assert.equal(p[0],'org1');if(failDelete&&sql.startsWith('DELETE FROM items'))throw new Error('Simulated DB failure');deletes.push(sql);return [{affectedRows:1},[]];}
  throw new Error(sql);
 }
 pool.query=query;
 pool.getConnection=async()=>{let before;return {query,async beginTransaction(){before=[...deletes];},async commit(){},async rollback(){rollback++;deletes=before;},release(){}};};
 const server=createApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api/v1`;
 async function remove(path){const res=await fetch(base+path,{method:'DELETE',headers:{Authorization:'Bearer '+signToken('u1',0),'X-Org-Id':'org1'}});return {status:res.status,body:await res.json()};}
 try{
  role='Sales';for(const path of ['/items/i1','/parties/p1','/orgs/org1/godowns/g1'])assert.equal((await remove(path)).status,403);assert.deepEqual(deletes,[]);
  role='Owner';assert.equal((await remove('/orgs/other/godowns/g1')).status,403);assert.equal((await remove('/items/missing')).status,404);
  stock=true;assert.equal((await remove('/items/i1')).status,409);assert.equal((await remove('/orgs/org1/godowns/g1')).status,409);stock=false;
  batches=true;assert.equal((await remove('/items/i1')).status,409);batches=false;
  ledger=true;assert.equal((await remove('/orgs/org1/godowns/g1')).status,409);ledger=false;
  assigned=true;assert.equal((await remove('/orgs/org1/godowns/g1')).status,409);assigned=false;
  balance=12;assert.equal((await remove('/parties/p1')).status,409);balance=0;
  const tables=['quotations','sales_orders','challans','invoices','receipts','advances','purchase_orders','grns','transfers','adjustments'];
  for(const table of tables){history=[{table,body:{id:'d1',status:'cancelled',customerId:'p1',godownId:'g1',lines:[{itemId:'i1'}]}}];for(const path of ['/items/i1','/parties/p1','/orgs/org1/godowns/g1'])assert.equal((await remove(path)).status,409,table+':'+path);}
  history=[{table:'transfers',body:{fromId:'g1',toId:'g2',lines:[]}}];assert.equal((await remove('/orgs/org1/godowns/g2')).status,409);
  history=[];assert.deepEqual(deletes,[]);
  failDelete=true;assert.equal((await remove('/items/i1')).status,500);assert.deepEqual(deletes,[]);assert.ok(rollback>0);failDelete=false;
  for(const path of ['/items/i1','/parties/p1','/orgs/org1/godowns/g1']){const res=await remove(path);assert.equal(res.status,200,JSON.stringify(res.body));assert.equal(res.body.deleted,true);}
  assert.equal(deletes.length,5); // two zero-threshold cleanups plus three masters
 }finally{pool.query=oldQuery;pool.getConnection=oldConnection;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
