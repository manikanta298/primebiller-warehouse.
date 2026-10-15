import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL='mysql://test:test@localhost/test';
process.env.JWT_SECRET='a'.repeat(64);
const {pool}=await import('../src/db.ts');
const {createApp}=await import('../src/app.ts');
const {signToken}=await import('../src/auth.ts');
const {today}=await import('../src/config.ts');

test('HTTP warehouse additions/removals update only target stock, batch, cost and ledger; rejected/unauthorized changes write nothing',async()=>{
  const originalQuery=pool.query, originalConnection=pool.getConnection;
  let role='Owner', assigned=['g1'], writes=[];
  const item={id:'i1',org_id:'org1',sku:'P1',name:'Product',category:'',brand:'',hsn:'1234',gst_rate:18,base_uom:'PCS',conversions:[],sale_price:30,cost_price:10,active:1,track_batches:1,allow_negative:0};
  const stock=['g1','g2'].map((id,n)=>({org_id:'org1',item_id:'i1',godown_id:id,on_hand:n?30:10,held:n?4:2,reorder_level:1,max_level:100,unit_cost:n?20:10}));
  // Same batch number is intentionally used in both warehouses.
  const batches=stock.map((s,n)=>({id:'b'+n,item_id:'i1',godown_id:s.godown_id,batch_no:'SAME',qty:s.on_hand,mfg_date:today(),received_date:today()}));
  const docs=new Map();
  async function query(sql,p=[]){
    if(sql.startsWith('SELECT id, name, active'))return [[{id:'u1',name:'Owner',active:1,token_version:0}],[]];
    if(sql.startsWith('SELECT ur.role'))return [p[1]==='org1'?[{role,id:'org1',state_code:'36',gstin:''}]:[],[]];
    if(sql.startsWith('SELECT g.id FROM user_godowns'))return [assigned.map(id=>({id})),[]];
    if(sql.startsWith('SELECT * FROM godowns'))return [['g1','g2'].includes(p[1])?[{id:p[1],name:p[1],active:1}]:[],[]];
    if(sql.startsWith('SELECT * FROM items'))return [[structuredClone(item)],[]];
    if(sql.startsWith('SELECT * FROM item_stock'))return [structuredClone(stock),[]];
    if(sql.startsWith('SELECT * FROM batches'))return [structuredClone(batches),[]];
    if(sql.startsWith('SELECT body FROM org_settings'))return [[{body:{adjApprovalLimit:25000}}],[]];
    if(sql.startsWith('SELECT prefix'))return [[{prefix:'ADJ',padding:5,reset_per_fy:1}],[]];
    if(sql.startsWith('SELECT last_number'))return [[{last_number:docs.size}],[]];
    if(sql.startsWith('INSERT IGNORE INTO doc_counters')||sql.startsWith('UPDATE doc_counters'))return [{},[]];
    if(sql.startsWith('INSERT INTO')){
      writes.push({sql,p:structuredClone(p)});
      if(sql.startsWith('INSERT INTO item_stock'))Object.assign(stock.find(s=>s.godown_id===p[2]),{on_hand:p[3],held:p[4],unit_cost:p[7]});
      if(sql.startsWith('INSERT INTO batches')){const found=batches.find(b=>b.id===p[0]);if(found)found.qty=p[6];else batches.push({id:p[0],item_id:p[2],godown_id:p[3],batch_no:p[4],qty:p[6],mfg_date:p[7],expiry_date:p[8],received_date:p[9]});}
      if(sql.startsWith('INSERT INTO adjustments'))docs.set(p[0],JSON.parse(p[7]));
      return [{},[]];
    }
    throw new Error('Unexpected query '+sql);
  }
  pool.query=query;pool.getConnection=async()=>({query,async beginTransaction(){},async commit(){},async rollback(){},release(){}});
  const server=createApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  async function adjust(godownId,direction,qty,cost=30,org='org1',batchNo='SAME'){
    const res=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/adjustments`,{method:'POST',headers:{Authorization:'Bearer '+signToken('u1',0),'X-Org-Id':org,'Content-Type':'application/json'},body:JSON.stringify({date:today(),godownId,reason:'correction',notes:'Warehouse isolation test',lines:[{itemId:'i1',batchNo,direction,qty,unitCost:cost}]})});
    return {status:res.status,body:await res.json()};
  }
  try{
    const other={stock:structuredClone(stock[1]),batch:structuredClone(batches[1])};
    const added=await adjust('g1','up',10);assert.equal(added.status,200,JSON.stringify(added.body));
    assert.equal(stock[0].on_hand,20);assert.equal(stock[0].unit_cost,20);assert.equal(batches[0].qty,20);
    assert.deepEqual(stock[1],other.stock);assert.deepEqual(batches[1],other.batch);assert.equal(item.cost_price,10);
    assert.ok(writes.filter(w=>w.sql.startsWith('INSERT INTO item_stock')).every(w=>w.p[2]==='g1'));
    assert.ok(writes.filter(w=>w.sql.startsWith('INSERT INTO batches')).every(w=>w.p[3]==='g1'));
    assert.ok(writes.filter(w=>w.sql.startsWith('INSERT INTO stock_ledger')).every(w=>w.p[8]==='g1'));
    assert.ok(!writes.some(w=>w.sql.startsWith('INSERT INTO items')));
    writes=[];const first=structuredClone(stock[0]);
    const removed=await adjust('g2','down',5,999);assert.equal(removed.status,200,JSON.stringify(removed.body));
    assert.equal(removed.body.lines[0].unitCost,20);assert.equal(stock[1].on_hand,25);assert.equal(stock[1].held,4);assert.equal(batches[1].qty,25);assert.deepEqual(stock[0],first);
    assert.ok(writes.filter(w=>w.sql.startsWith('INSERT INTO item_stock')).every(w=>w.p[2]==='g2'));
    // A new warehouse batch must not inherit metadata just because another warehouse uses that name.
    batches[0].batch_no='OTHER';batches[0].mfg_date='2020-01-01';batches[0].expiry_date='2027-01-01';
    const metadata=await adjust('g2','up',1,30,'org1','OTHER');assert.equal(metadata.status,200,JSON.stringify(metadata.body));
    const newBatch=batches.find(b=>b.godown_id==='g2'&&b.batch_no==='OTHER');assert.equal(newBatch.mfg_date,today());assert.equal(newBatch.expiry_date,null);
    writes=[];assert.equal((await adjust('g2','down',23)).status,422);assert.equal(writes.length,0);
    role='Storekeeper';assert.equal((await adjust('g2','up',1)).status,403);assert.equal(writes.length,0);
    assert.equal((await adjust('g1','up',1,30,'other-org')).status,403);assert.equal(writes.length,0);
    assert.equal((await adjust('all','up',1)).status,403);assert.equal(writes.length,0);
  }finally{pool.query=originalQuery;pool.getConnection=originalConnection;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
