import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = 'mysql://test:test@localhost/test';
process.env.JWT_SECRET = 'a'.repeat(64);
const { pool } = await import('../src/db.ts');
const { createApp } = await import('../src/app.ts');
const { signToken } = await import('../src/auth.ts');
const { gstinCheckChar, isValidGstin } = await import('../src/shared/gst.ts');

test('warehouse API saves NA, preserves real GSTIN validation and can update without changing identity', async () => {
  const originalQuery = pool.query, originalConnection = pool.getConnection;
  let row, writes = 0;
  async function query(sql, params = []) {
    if (sql.startsWith('SELECT id, name, active')) return [[{ id: 'owner', name: 'Owner', active: 1, token_version: 0 }], []];
    if (sql.startsWith('SELECT ur.role')) return [[{ role: 'Owner', id: 'org1', state_code: '36', gstin: '' }], []];
    if (sql.startsWith('SELECT id FROM orgs')) return [[{ id: 'org1' }], []];
    if (sql.startsWith('SELECT id FROM godowns')) return [[], []];
    if (sql.startsWith('SELECT * FROM godowns')) return [row && row.id === params[1] ? [row] : [], []];
    if (sql.startsWith('INSERT INTO godowns') || sql.startsWith('UPDATE godowns SET code')) {
      const keys = ['code', 'name', 'type', 'address', 'state_code', 'gstin', 'manager', 'allow_negative', 'default_for_sales', 'active', 'org_id', 'id'];
      row = Object.fromEntries(keys.map((key, index) => [key, params[index]]));
      writes++;
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected warehouse query: ${sql}`);
  }
  pool.query = query;
  pool.getConnection = async () => ({ query, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} });
  const app = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const url = `http://127.0.0.1:${app.address().port}/api/v1/orgs/org1/godowns`;
  const input = { code: 'WH1', name: 'Test warehouse', type: 'godown', address: '', stateCode: '36', manager: '', allowNegative: false, defaultForSales: false, active: true };
  async function save(gstin, id, extra = {}) {
    const response = await fetch(url + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + signToken('owner', 0), 'X-Org-Id': 'org1' }, body: JSON.stringify({ ...input, gstin, ...extra }) });
    return { status: response.status, body: await response.json() };
  }
  try {
    const created = await save(' na ');
    assert.equal(created.status, 200);
    assert.equal(created.body.gstin, 'NA');
    assert.equal(row.gstin, 'NA');
    const id = created.body.id;
    const gstin = '36AAXFS1234K1Z' + gstinCheckChar('36AAXFS1234K1Z');
    const real = await save(gstin, id);
    assert.equal(real.status, 200);
    assert.equal(real.body.id, id);
    assert.equal(row.gstin, gstin);
    const beforeInvalid = writes;
    for (const invalid of ['N/A', 'INVALID', gstin.slice(0, 14) + (gstin[14] === '0' ? '1' : '0')]) {
      assert.equal((await save(invalid, id)).status, 422);
    }
    assert.equal((await save(gstin, id, { stateCode: '37' })).status, 422);
    assert.equal((await save('NA', id, { stateCode: '99' })).status, 422);
    assert.equal(writes, beforeInvalid);
    assert.equal(row.gstin, gstin);
    assert.equal((await save('NA', id)).body.gstin, 'NA');
    assert.equal((await save('', id)).status, 200);
    assert.equal(row.gstin, null);
    assert.equal(row.id, id);
    // The exception applies to warehouses; the general tax-ID validator is unchanged.
    assert.equal(isValidGstin('NA'), false);
  } finally {
    pool.query = originalQuery; pool.getConnection = originalConnection;
    app.closeAllConnections(); await new Promise((resolve) => app.close(resolve));
  }
});
