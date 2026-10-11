import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = 'mysql://test:test@localhost/test';
process.env.JWT_SECRET = 'a'.repeat(64);
const { pool } = await import('../src/db.ts');
const { createApp } = await import('../src/app.ts');
const { signToken } = await import('../src/auth.ts');
const { Uow } = await import('../src/uow.ts');

test('HTTP authorization checks role, assigned warehouse, filtered stock and destination receipt', async () => {
  const originalQuery = pool.query, originalConnection = pool.getConnection;
  let role = 'Storekeeper', assigned = ['g1'], writes = 0;
  const warehouses = ['g1', 'g2'].map(id => ({ id, org_id: 'org1', name: id, code: id, active: 1 }));
  const item = { id: 'i1', org_id: 'org1', sku: 'I1', name: 'Item', conversions: [], active: 1 };
  const orders = ['g1', 'g2'].map(godownId => ({ id: 'so-' + godownId, godownId, number: 'SO', date: '2026-10-11' }));
  const transfer = { id: 'tr1', fromId: 'g1', toId: 'g2', status: 'in_transit', lines: [] };
  async function query(sql, params = []) {
    if (sql.startsWith('SELECT id, name, active')) return [[{ id: 'u1', name: 'Staff', active: 1, token_version: 0 }], []];
    if (sql.startsWith('SELECT ur.role')) return [params[1] && params[1] !== 'org1' ? [] : [{ role, id: 'org1', state_code: '36', gstin: '' }], []];
    if (sql.startsWith('SELECT g.id FROM user_godowns')) return [assigned.map(id => ({ id })), []];
    if (sql.startsWith('SELECT * FROM godowns')) return [params.length > 1 ? warehouses.filter(g => g.id === params[1]) : warehouses, []];
    if (sql.startsWith('SELECT * FROM items')) return [[item], []];
    if (sql.startsWith('SELECT * FROM item_stock')) return [[{ item_id: 'i1', godown_id: 'g1', on_hand: 10 }, { item_id: 'i1', godown_id: 'g2', on_hand: 999 }], []];
    if (sql.startsWith('SELECT * FROM batches')) return [[{ id: 'b1', item_id: 'i1', godown_id: 'g1' }, { id: 'b2', item_id: 'i1', godown_id: 'g2' }], []];
    if (sql.includes('FROM sales_orders')) return [orders.filter(body => !sql.startsWith('SELECT body') || body.id === params[1]).map(body => ({ id: body.id, body })), []];
    if (sql.startsWith('SELECT * FROM stock_ledger')) {
      assert.ok(sql.includes('godown_id IN (?)') || role === 'Owner');
      return [warehouses.filter(g => assigned.includes(g.id)).map(g => ({ id: g.id, godown_id: g.id, at: '2026-10-11 00:00:00', qty: 1, unit_cost: 10 })), []];
    }
    if (sql.includes('FROM transfers')) return [[{ body: transfer }], []];
    if (/FROM (invoices|receipts)/.test(sql)) throw new Error('Financial query must not run for Sales');
    if (/^(INSERT|UPDATE|DELETE)/.test(sql)) { writes++; return [{ affectedRows: 1 }, []]; }
    throw new Error('Unexpected query: ' + sql);
  }
  pool.query = query;
  pool.getConnection = async () => ({ query, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} });
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  async function request(path, options = {}, org = 'org1') {
    const response = await fetch(base + path, { ...options, headers: { Authorization: 'Bearer ' + signToken('u1', 0), 'X-Org-Id': org, 'Content-Type': 'application/json' } });
    return { status: response.status, body: await response.json() };
  }
  try {
    for (const path of ['/parties', '/sales-orders', '/reports/receivables', '/invoices', '/users', '/search']) assert.equal((await request(path)).status, 403, path);
    const godowns = await request('/orgs/org1/godowns');
    assert.equal(godowns.status, 200); assert.deepEqual(godowns.body.map(g => g.id), ['g1']);
    assert.equal((await request('/orgs/org1/godowns/g2/activity')).status, 403);
    const ledger = await request('/stock/ledger');
    assert.equal(ledger.status, 200); assert.deepEqual(ledger.body.map(entry => entry.godownId), ['g1']);
    assert.equal((await request('/stock/ledger?godownId=g2')).status, 403);
    const directory = await request('/orgs/org1/godowns?purpose=transfer&detail=1');
    assert.deepEqual(directory.body.map(g => g.id), ['g1', 'g2']);
    assert.ok(directory.body.every(g => Object.keys(g).sort().join(',') === 'active,code,id,name'));
    const forbiddenDispatch = await request('/transfers', { method: 'POST', body: JSON.stringify({ date: '2026-10-11', fromId: 'g2', toId: 'g1', lines: [{ itemId: 'i1', qty: 1 }] }) });
    assert.equal(forbiddenDispatch.status, 403);
    const loaded = await request('/items/i1');
    assert.equal(loaded.status, 200);
    assert.deepEqual(loaded.body.stock.map(s => s.godownId), ['g1']);
    assert.deepEqual(loaded.body.batches.map(b => b.id), ['b1']);
    assert.equal((await request('/transfers/tr1/receive', { method: 'POST', body: JSON.stringify({ lines: [{ received: 1 }] }) })).status, 403);
    assert.equal(writes, 0);
    assert.equal((await request('/items/i1', {}, 'other-org')).status, 403);
    role = 'Sales';
    const sales = await request('/sales-orders');
    assert.equal(sales.status, 200); assert.deepEqual(sales.body.map(s => s.id), ['so-g1']);
    assert.equal((await request('/sales-orders/so-g2')).status, 403);
    const search = await request('/search');
    assert.equal(search.status, 200); assert.ok(search.body.every(hit => hit.type === 'SO'));
    assigned = [];
    assert.deepEqual((await request('/sales-orders')).body, []);
    role = 'Owner';
    assert.deepEqual((await request('/orgs/org1/godowns')).body.map(g => g.id), ['g1', 'g2']);
    role = 'Driver';
    assert.equal((await request('/items')).status, 403);
  } finally {
    pool.query = originalQuery; pool.getConnection = originalConnection;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test('document cache cannot bypass warehouse access after a collection lookup', async () => {
  const ctx = { role: 'Storekeeper', orgId: 'org1', userId: 'u1', userName: 'Staff', godownIds: ['g1'] };
  const outside = { id: 'grn2', godownId: 'g2' };
  const uow = new Uow({ async query() { return [[{ id: outside.id, body: outside }], []]; } }, ctx, true);
  assert.deepEqual(await uow.docs_('grns'), []);
  await assert.rejects(uow.doc('grns', 'grn2'), error => error.status === 403);
});
