import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = 'mysql://test:test@localhost/test';
process.env.JWT_SECRET = 'a'.repeat(64);
const { pool } = await import('../src/db.ts');
const { createApp } = await import('../src/app.ts');
const { signToken } = await import('../src/auth.ts');
const { today } = await import('../src/config.ts');

test('quotation HTTP lifecycle: stock unchanged, accepted once, advances linked, retries safe, invoices isolated', async () => {
  const originalQuery = pool.query, originalConnection = pool.getConnection;
  const docs = new Map(), counters = new Map(), drafts = new Map();
  let role = 'Owner', assigned = ['g1'], stockWrites = [], ledgerWrites = 0;
  const item = { id: 'i1', org_id: 'org1', sku: 'I1', name: 'Item', category: '', brand: '', hsn: '1234', gst_rate: 18, base_uom: 'PCS', conversions: [], sale_price: 100, cost_price: 50, active: 1 };
  const party = { id: 'c1', org_id: 'org1', kind: 'customer', name: 'Customer', address: 'Saved billing street', city: 'Hyderabad', pin: '500001', phone: '9999999999', state_code: '36', state_name: 'Telangana', credit_limit: 10000, outstanding: 0, credit_days: 30 };
  const stock = { item_id: 'i1', godown_id: 'g1', on_hand: 10, held: 0, reorder_level: 0, max_level: 0 };
  async function query(sql, p = []) {
    if (sql.startsWith('INSERT IGNORE INTO quotation_drafts')) { if (!drafts.has(p.join(':'))) drafts.set(p.join(':'),{version:0,body:null});return [{},[]]; }
    if (sql.startsWith('SELECT version, body FROM quotation_drafts')) return [[drafts.get(p.join(':'))].filter(Boolean).map(x=>structuredClone(x)),[]];
    if (sql.startsWith('UPDATE quotation_drafts')) {
      const clearing=sql.includes('body = NULL'),k=(clearing?p:p.slice(1)).join(':');
      const row=drafts.get(k); row.version++;row.body=clearing?null:JSON.parse(p[0]);return [{},[]];
    }
    if (sql.startsWith('SELECT id, name, active')) return [[{ id: 'u1', name: 'Tester', active: 1, token_version: 0 }], []];
    if (sql.startsWith('SELECT ur.role')) return [p[1] && p[1] !== 'org1' ? [] : [{ role, id: 'org1', state_code: '36', gstin: '' }], []];
    if (sql.startsWith('SELECT g.id FROM user_godowns')) return [assigned.map(id => ({ id })), []];
    if (sql.startsWith('SELECT body FROM org_settings')) return [[{body:{quotationTerms:'Terms from settings',quotationNotes:'Notes from settings',bankAccount:'secret-bank'}}],[]];
    if (sql.startsWith('SELECT * FROM godowns')) return [[{ id: p[1], org_id: 'org1', name: 'Warehouse', code: 'G1', active: 1, state_code: '36' }], []];
    if (sql.startsWith('SELECT * FROM items')) return [[item], []];
    if (sql.startsWith('SELECT * FROM item_stock')) return [[stock], []];
    if (sql.startsWith('SELECT * FROM batches')) return [[], []];
    if (sql.startsWith('SELECT * FROM parties')) return [p[1] === party.id ? [party] : [], []];
    if (sql.startsWith('SELECT prefix')) return [[{ prefix: p[1], padding: 5, reset_per_fy: 1 }], []];
    if (sql.startsWith('INSERT IGNORE INTO quotation_counters') || sql.startsWith('INSERT IGNORE INTO doc_counters')) { const k = p.join(':'); if (!counters.has(k)) counters.set(k, 0); return [{}, []]; }
    if (sql.startsWith('SELECT last_number')) return [[{ last_number: counters.get(p.join(':')) ?? 0 }], []];
    if (sql.startsWith('UPDATE quotation_counters') || sql.startsWith('UPDATE doc_counters')) { counters.set(p.slice(1).join(':'), p[0]); return [{}, []]; }
    if (sql.startsWith('SELECT body') || sql.startsWith('SELECT id, body')) {
      const table = sql.match(/FROM (\w+)/)[1];
      if (table === 'quotations' && sql.startsWith('SELECT body') && /FOR UPDATE/.test(sql)) assert.ok(sql.includes('org_id = ? AND id = ?'));
      let found = [...docs.entries()].filter(([k]) => k.startsWith(table + ':')).map(([,v]) => structuredClone(v));
      if (sql.startsWith('SELECT body')) found = found.filter(d => d.id === p[1]);
      if (sql.includes('party_id = ?')) found = found.filter(d => d.customerId === p[1]);
      if (sql.includes("status = 'open'")) found = found.filter(d => d.remaining > 0);
      return [found.map(body => ({ id: body.id, body })), []];
    }
    if (sql.startsWith('INSERT INTO item_stock')) { stockWrites.push(p); return [{}, []]; }
    if (sql.startsWith('INSERT INTO items')) return [{}, []];
    if (sql.startsWith('INSERT INTO invoice_audit_events')) return [{}, []];
    if (sql.startsWith('INSERT INTO stock_ledger')) { ledgerWrites++; return [{}, []]; }
    if (sql.startsWith('UPDATE parties')) { party.outstanding = p[0]; return [{}, []]; }
    if (sql.startsWith('INSERT INTO ')) { const table = sql.match(/INSERT INTO (\w+)/)[1]; docs.set(table + ':' + p[0], JSON.parse(p[7])); return [{}, []]; }
    throw new Error('Unexpected query: ' + sql);
  }
  // Serialize fake transactions to model the locked quotation row; this is not a live MySQL test.
  let queue = Promise.resolve();
  pool.query = query;
  pool.getConnection = async () => {
    let releaseLock;
    return { query, async beginTransaction() { const previous = queue; queue = new Promise(r => releaseLock = r); await previous; }, async commit() {}, async rollback() {}, release() { releaseLock?.(); } };
  };
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  async function request(path, body, method = body === undefined ? 'GET' : 'POST', org = 'org1') {
    const res = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + signToken('u1', 0), 'X-Org-Id': org, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json() };
  }
  const date = today(), validUntil = new Date(Date.now() + 7 * 86400000).toISOString().slice(0,10);
  const input = { date, validUntil, customerId: 'c1', godownId: 'g1', notes: '', terms: 'Valid prices', lines: [{ itemId: 'i1', itemName: 'Forged', hsn: '0000', uom: 'PCS', qty: 1, rate: 100, discountPct: 0, gstRate: 0 }] };
  try {
    role = 'Driver'; assert.equal((await request('/quotation-defaults')).status,403); assert.equal((await request('/quotations')).status, 403); assert.equal((await request('/quotations',input)).status, 403);
    role = 'Sales'; assert.deepEqual((await request('/quotation-defaults')).body,{terms:'Terms from settings',notes:'Notes from settings'}); assigned = []; assert.equal((await request('/quotations',input)).status, 403); assigned = ['g1'];
    const incomplete={...input,customerId:'',lines:[],notes:'Work in progress'};
    const draftPath='/quotation-drafts/new';
    assert.deepEqual((await request(draftPath)).body,{version:0,input:null});
    assert.equal((await request(draftPath,{version:0,input:incomplete},'PUT')).status,200);
    assert.deepEqual((await request(draftPath)).body,{version:1,input:incomplete});
    assert.equal(docs.size,0); assert.equal(counters.size,0); assert.equal(ledgerWrites,0);
    assert.equal((await request(draftPath,{version:0,input:incomplete},'PUT')).status,409);
    assert.equal((await request(draftPath,{version:1,input:{...incomplete,terms:'x'.repeat(2001)}},'PUT')).status,422);
    role='Accountant';assert.equal((await request(draftPath)).status,403);assert.equal((await request(draftPath,{version:1,input:incomplete},'PUT')).status,403);role='Sales';
    assert.equal((await request(draftPath,undefined,'GET','other-org')).status,403);
    const savedWithDraft=await request('/quotations',{...input,draftVersion:1});assert.equal(savedWithDraft.status,200,JSON.stringify(savedWithDraft.body));
    assert.deepEqual((await request(draftPath)).body,{version:2,input:null});
    assert.equal((await request(draftPath,{version:1,input:incomplete},'PUT')).status,409);
    assert.equal((await request('/quotations',{...input,draftVersion:1})).status,409);
    const created = await request('/quotations', input); assert.equal(created.status, 200, JSON.stringify(created.body));
    const q = created.body, path = '/quotations/' + q.id;
    assert.equal(q.grandTotal,118); assert.equal(q.lines[0].itemName,'Item'); assert.equal(q.lines[0].gstRate,18);
    const direct = await request('/quotations', { ...input, godownId: '' });
    const directOrder = await request('/quotations/' + direct.body.id + '/convert', {godownId:'g1'});
    assert.equal(directOrder.status,200,JSON.stringify(directOrder.body));
    assert.equal(directOrder.body.quotationId,direct.body.id);
    assert.equal((await request('/quotations/' + direct.body.id)).body.acceptedBy,'Tester');
    assert.equal(stock.held,0);
    assert.equal((await request('/quotations/' + direct.body.id + '/convert',{godownId:'g1'})).body.id,directOrder.body.id);
    assert.equal((await request(path+'/issue',{})).body.status,'issued');
    assert.equal((await request(path,{ ...input, id:q.id },'PUT')).status,409);
    assert.equal((await request('/quotation-drafts/'+q.id,{version:0,input:{...input,id:q.id}},'PUT')).status,409);
    assert.equal((await request(path+'/accept',{})).body.status,'accepted');
    const payment = { quotationId:q.id, customerId:'c1', date, amount:40, mode:'cash', reference:'', requestKey:'payment-retry-key-123', allocations:[] };
    assert.equal((await request('/receipts',payment)).status,403);
    role = 'Owner';
    const paid = await request('/receipts',payment); assert.equal(paid.status,200,JSON.stringify(paid.body)); assert.equal(paid.body.advance,40); assert.deepEqual(paid.body.allocations,[]);
    assert.equal((await request('/receipts',payment)).body.id,paid.body.id);
    assert.equal((await request('/receipts',{...payment, amount:41})).status,409);
    assert.equal((await request('/receipts',{...payment, requestKey:'new-payment-request-1',amount:79})).status,422);
    assert.equal((await request(path+'/cancel',{})).status,409);
    role = 'Sales';
    const [a,b] = await Promise.all([request(path+'/convert',{}), request(path+'/convert',{})]);
    assert.equal(a.status,200,JSON.stringify(a.body)); assert.equal(b.status,200,JSON.stringify(b.body)); assert.equal(a.body.id,b.body.id); assert.equal(a.body.status,'draft'); assert.equal(a.body.number,null);
    const o = a.body;
    assert.equal(docs.get('advances:adv-'+paid.body.id).salesOrderId,o.id); assert.equal(docs.get('receipts:'+paid.body.id).salesOrderId,o.id);
    assert.equal([...docs.keys()].filter(k=>k.startsWith('sales_orders:')).length,2);
    assert.equal(ledgerWrites,0); assert.ok(stockWrites.every(p=>p[3]===10 && p[4]===0));
    const resave = await request('/sales-orders/'+o.id,{id:o.id,date,customerId:'c1',godownId:'g1',notes:'Edited',lines:input.lines},'PUT');
    assert.equal(resave.status,200); assert.equal(resave.body.quotationId,q.id);
    assert.equal((await request('/sales-orders/'+o.id,{id:o.id,date,customerId:'c1',godownId:'g2',notes:'',lines:input.lines},'PUT')).status,403);
    assigned=[]; assert.ok((await request('/quotations')).body.every(q=>q.godownId===''));  assert.equal((await request(path)).status,403);
    assert.equal((await request(path,undefined,'GET','other-org')).status,403);
    role='Owner';
    assert.equal((await request('/receipts',{...payment,requestKey:'after-conversion-new-key'})).status,422);
    // New quotations are stock-neutral and have no warehouse until conversion.
    const noWarehouse = await request('/quotations', { ...input, godownId: '' });
    assert.equal(noWarehouse.status, 200, JSON.stringify(noWarehouse.body));
    assert.equal(noWarehouse.body.godownId, '');
    const neutralPath = '/quotations/' + noWarehouse.body.id;
    role = 'Sales';
    assert.equal((await request(neutralPath)).status, 200);
    // Direct draft conversion does not require issue or acceptance transitions.
    assert.equal((await request(neutralPath+'/convert', {})).status, 422);
    assert.equal((await request(neutralPath+'/convert', { godownId: 'g2' })).status, 403);
    assigned = ['g1'];
    const neutralOrder = await request(neutralPath+'/convert', { godownId: 'g1' });
    assert.equal(neutralOrder.status, 200, JSON.stringify(neutralOrder.body));
    assert.equal(neutralOrder.body.godownId, 'g1');
    assert.equal((await request(neutralPath+'/convert', { godownId: 'g1' })).body.id, neutralOrder.body.id);
    role = 'Owner';
    // A delivered challan for this order applies only its own quote advance, even with general advances disabled.
    const line={ ...o.lines[0], allocations:[] };
    const c={id:'dc1',number:'DC/1',date,status:'delivered',invoiceNo:'',customerId:'c1',customerName:'Customer',soId:o.id,soNumber:'SO/1',godownId:'g1',placeOfSupplyCode:'36',placeOfSupplyName:'Telangana',lines:[line],events:[]};
    docs.set('challans:dc1',c);
    docs.set('advances:unrelated',{id:'unrelated',date,customerId:'c1',amount:100,remaining:100,quotationId:'other-q',salesOrderId:'other-so'});
    const issued=await request('/invoices',{challanIds:['dc1'],date,applyAdvances:false});
    assert.equal(issued.status,200,JSON.stringify(issued.body)); assert.equal(issued.body.billingAddress,'Saved billing street, Hyderabad, 500001'); assert.equal(issued.body.customerPhone,'9999999999'); assert.equal(issued.body.balance,78); assert.equal(issued.body.advances.length,1); assert.equal(docs.get('advances:unrelated').remaining,100);
    assert.equal(docs.get('advances:adv-'+paid.body.id).remaining,0);
    const cancelled=await request('/invoices/'+issued.body.id+'/cancel',{reason:'Test cancellation'});
    assert.equal(cancelled.status,200,JSON.stringify(cancelled.body)); assert.equal(docs.get('advances:adv-'+paid.body.id).remaining,40);
    const again=await request('/invoices',{challanIds:['dc1'],date,applyAdvances:false});
    assert.equal(again.status,200); assert.equal(again.body.balance,78);
    assert.equal((await request('/invoices',{challanIds:['dc1'],date,applyAdvances:false})).status,409);
  } finally {
    pool.query=originalQuery; pool.getConnection=originalConnection;
    server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  }
});
