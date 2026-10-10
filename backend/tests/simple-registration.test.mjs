import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = 'mysql://test:test@localhost/test';
process.env.JWT_SECRET = 'a'.repeat(64);
const { pool } = await import('../src/db.ts');
const { config } = await import('../src/config.ts');
const { createApp } = await import('../src/app.ts');

test('HTTP registration requires a phone and setup code but no business name or GSTIN', async () => {
  const originalQuery = pool.query, originalConnection = pool.getConnection;
  const originalConfig = { ...config };
  let initialized = false, user, org;
  async function query(sql, params = []) {
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []];
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }], []];
    if (sql.startsWith('SELECT id FROM orgs LIMIT') || sql.startsWith('SELECT id FROM users LIMIT')) return [initialized ? [{ id: 'existing' }] : [], []];
    if (sql.startsWith('INSERT INTO orgs')) org = { id: params[0], name: params[1], gstin: params[2], state_code: params[3], state_name: params[4], role: 'Owner' };
    else if (sql.startsWith('INSERT INTO users')) user = { id: params[0], name: params[1], email: params[2], token_version: 0 };
    else if (sql.startsWith('SELECT id, name, email, token_version')) return [[user], []];
    else if (sql.startsWith('SELECT o.id')) return [[org], []];
    else if (!sql.startsWith('INSERT INTO ')) throw new Error(`Unexpected SQL: ${sql}`);
    return [{ affectedRows: 1 }, []];
  }
  config.setupRegistrationToken = 'b'.repeat(64);
  config.mailDeliveryMode = 'smtp'; config.smtpHost = undefined; config.smtpFrom = undefined;
  pool.query = query;
  pool.getConnection = async () => ({ query, async beginTransaction() {}, async commit() { initialized = true; }, async rollback() {}, release() {}, destroy() {} });
  const app = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const url = `http://127.0.0.1:${app.address().port}/api/v1/auth/register`;
  async function post(body) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  const input = { name: 'Test Owner', email: 'OWNER@example.com', mobile: '+91 9876543210', password: 'test-password-123', setupCode: config.setupRegistrationToken };
  try {
    assert.equal((await post({ ...input, mobile: undefined })).status, 422);
    assert.equal((await post({ ...input, setupCode: 'wrong' })).status, 403);
    assert.equal((await post({ ...input, role: 'Owner' })).status, 422);
    const response = await post(input);
    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, 'owner@example.com');
    assert.equal(response.body.user.role, 'Owner');
    assert.ok(response.body.token);
    assert.equal(response.body.orgs[0].gstin, '');
    assert.equal(response.body.orgs[0].stateCode, '');
    assert.equal(response.body.orgs[0].name, "Test Owner's business");
    assert.equal((await post(input)).status, 409);
  } finally {
    pool.query = originalQuery; pool.getConnection = originalConnection;
    Object.assign(config, originalConfig);
    app.closeAllConnections(); await new Promise((resolve) => app.close(resolve));
  }
});
