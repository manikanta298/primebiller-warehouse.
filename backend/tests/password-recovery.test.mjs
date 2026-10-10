import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';

process.env.DATABASE_URL = 'mysql://test:test@localhost/test';
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
const { config } = await import('../src/config.ts');
const { pool } = await import('../src/db.ts');
const { createApp } = await import('../src/app.ts');

function mailServer({ rejectRecipient = false } = {}) {
  const messages = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 test SMTP ready\r\n');
    let buffer = '', data = false, message = [];
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') { messages.push(message.join('\r\n')); data = false; socket.write('250 queued\r\n'); }
          else message.push(line);
        } else if (line.startsWith('EHLO')) socket.write('250-test\r\n250 SIZE 100000\r\n');
        else if (line.startsWith('MAIL FROM')) socket.write('250 sender ok\r\n');
        else if (line.startsWith('RCPT TO')) socket.write(rejectRecipient ? '550 rejected\r\n' : '250 recipient ok\r\n');
        else if (line === 'DATA') { data = true; message = []; socket.write('354 send data\r\n'); }
        // Intentionally drop QUIT: an accepted email must still have a valid token.
        else if (line === 'QUIT') socket.destroy();
      }
    });
  });
  return { server, messages, async close() { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); } };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function fixture(options = {}) {
  const originalMode = config.mailDeliveryMode;
  config.mailDeliveryMode = 'smtp';
  const smtp = mailServer(options);
  config.smtpHost = '127.0.0.1'; config.smtpPort = await listen(smtp.server);
  config.smtpSecurity = 'none'; config.smtpUser = undefined; config.smtpPassword = undefined;
  config.smtpFrom = 'Test <no-reply@example.com>'; config.appUrl = 'https://frontend.example.com';
  const state = { initialized: !options.empty, user: undefined, org: undefined, tokens: new Map(), passwordHash: await bcrypt.hash('old-password-123', 4), version: 0 };
  async function query(sql, params = []) {
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []];
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }], []];
    if (sql.startsWith('SELECT id FROM orgs LIMIT') || sql.startsWith('SELECT id FROM users LIMIT')) return [state.initialized ? [{ id: 'existing' }] : [], []];
    if (sql.startsWith('INSERT INTO orgs')) { state.org = { id: params[0], name: params[1], gstin: params[2], state_code: params[3], state_name: params[4], role: 'Owner' }; return [{ affectedRows: 1 }, []]; }
    if (sql.startsWith('INSERT INTO users')) { state.user = { id: params[0], name: params[1], email: params[2], token_version: 0 }; return [{ affectedRows: 1 }, []]; }
    if (sql.startsWith('INSERT INTO user_roles') || sql.startsWith('INSERT INTO doc_series') || sql.startsWith('INSERT INTO org_settings') || sql.startsWith('INSERT INTO print_profiles')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('SELECT id, name, email, token_version')) return [[state.user], []];
    if (sql.startsWith('SELECT o.id')) return [[state.org], []];
    if (sql.startsWith('SELECT id FROM users WHERE email')) return [params[0] === 'owner@example.com' ? [{ id: 'u_owner' }] : [], []];
    if (sql.startsWith('SELECT COUNT(*)')) return [[{ n: state.tokens.size }], []];
    if (sql.startsWith('INSERT INTO password_reset_tokens')) {
      state.tokens.set(params[0], { userId: params[1], expires: Date.now() + 3600000, used: false });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('DELETE FROM password_reset_tokens')) { state.tokens.delete(params[0]); return [{ affectedRows: 1 }, []]; }
    if (sql.startsWith('SELECT t.user_id')) {
      const record = state.tokens.get(params[0]);
      return [record && !record.used && record.expires > Date.now() ? [{ user_id: record.userId }] : [], []];
    }
    if (sql.startsWith('UPDATE users SET password_hash')) { state.passwordHash = params[0]; state.version += 1; return [{ affectedRows: 1 }, []]; }
    if (sql.startsWith('UPDATE password_reset_tokens')) { for (const record of state.tokens.values()) record.used = true; return [{ affectedRows: 1 }, []]; }
    throw new Error(`Unexpected SQL in recovery test: ${sql}`);
  }
  const originalQuery = pool.query, originalConnection = pool.getConnection;
  pool.query = query;
  pool.getConnection = async () => ({ query, async beginTransaction() {}, async commit() { state.initialized = true; }, async rollback() {}, release() {}, destroy() {} });
  const app = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const url = `http://127.0.0.1:${app.address().port}/api/v1/auth`;
  return {
    state, smtp,
    async get(path) { const response = await fetch(url + path); return { status: response.status, body: await response.json() }; },
    async post(path, body) {
      const response = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    },
    async close() {
      pool.query = originalQuery; pool.getConnection = originalConnection; config.mailDeliveryMode = originalMode;
      app.closeAllConnections(); await new Promise((resolve) => app.close(resolve));
      await smtp.close();
    },
  };
}

test('registration API hides setup after initialization and rejects unauthorized or role-injecting requests', async () => {
  const f = await fixture();
  const { gstinCheckChar } = await import('../src/shared/gst.ts');
  const oldToken = config.setupRegistrationToken;
  config.setupRegistrationToken = 'a'.repeat(64);
  const input = { orgName: 'Test Traders', orgGstin: '36AAXFS1234K1Z' + gstinCheckChar('36AAXFS1234K1Z'), name: 'Test Owner', email: 'owner@example.com', password: 'test-password-123', mobile: '+91 9876543210', setupCode: 'a'.repeat(64) };
  try {
    assert.deepEqual(await f.get('/setup-status'), { status: 200, body: { available: false } });
    assert.equal((await f.post('/register', { ...input, setupCode: 'wrong' })).status, 403);
    assert.equal((await f.post('/register', { ...input, role: 'Owner' })).status, 422);
    assert.equal((await f.post('/register', input)).status, 409);
  } finally { config.setupRegistrationToken = oldToken; await f.close(); }
});

test('forgot/reset password emails an opaque link, hides account existence, and revokes old sessions', async () => {
  const f = await fixture();
  try {
    const unknown = await f.post('/forgot-password', { email: 'missing@example.com' });
    assert.equal(f.smtp.messages.length, 0);
    const known = await f.post('/forgot-password', { email: 'OWNER@EXAMPLE.COM' });
    assert.deepEqual(known, unknown);
    assert.equal(known.status, 200);
    assert.equal(f.smtp.messages.length, 1);
    const token = f.smtp.messages[0].match(/https:\/\/frontend\.example\.com\/login\?reset=([a-f0-9]{64})/)[1];
    const digest = createHash('sha256').update(token).digest('hex');
    assert.ok(f.state.tokens.has(digest));
    assert.equal(f.state.tokens.has(token), false);
    assert.equal((await f.post('/reset-password', { token, password: 'short' })).status, 422);
    const reset = await f.post('/reset-password', { token, password: 'new-password-123' });
    assert.equal(reset.status, 200);
    assert.equal(await bcrypt.compare('new-password-123', f.state.passwordHash), true);
    assert.equal(f.state.version, 1);
    assert.equal((await f.post('/reset-password', { token, password: 'another-password' })).status, 400);
  } finally { await f.close(); }
});

test('expired links are rejected and unavailable SMTP returns a clear configuration error', async () => {
  const f = await fixture();
  try {
    await f.post('/forgot-password', { email: 'owner@example.com' });
    const token = f.smtp.messages[0].match(/reset=([a-f0-9]{64})/)[1];
    f.state.tokens.values().next().value.expires = Date.now() - 1;
    assert.equal((await f.post('/reset-password', { token, password: 'new-password-123' })).status, 400);
    assert.equal(f.state.version, 0);
    config.smtpHost = undefined;
    const response = await f.post('/forgot-password', { email: 'owner@example.com' });
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'mail_unavailable');
  } finally { await f.close(); }
});

test('SMTP delivery rejection removes the unusable token and keeps account-existence responses identical', async () => {
  const f = await fixture({ rejectRecipient: true });
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    const known = await f.post('/forgot-password', { email: 'owner@example.com' });
    const unknown = await f.post('/forgot-password', { email: 'missing@example.com' });
    assert.deepEqual(known, unknown);
    assert.equal(f.state.tokens.size, 0);
    assert.equal(f.smtp.messages.length, 0);
    assert.equal(errors.length, 1);
  } finally { console.error = originalError; await f.close(); }
});

test('production SMTP refuses unencrypted external mail transport', async () => {
  const f = await fixture();
  const { sendPasswordResetEmail } = await import('../src/smtp.ts');
  try {
    process.env.NODE_ENV = 'production';
    await assert.rejects(sendPasswordResetEmail('owner@example.com', 'https://frontend.example.com/login?reset=test'), /Plain SMTP/);
    assert.equal(f.smtp.messages.length, 0);
  } finally { process.env.NODE_ENV = 'test'; await f.close(); }
});


test('console mode registers the first Owner and logs a confirmation without SMTP', async () => {
  const f = await fixture({ empty: true });
  const { gstinCheckChar } = await import('../src/shared/gst.ts');
  const originalLog = console.log, originalToken = config.setupRegistrationToken;
  const logs = [];
  console.log = (...args) => logs.push(args);
  config.mailDeliveryMode = 'console'; config.smtpHost = undefined; config.smtpFrom = undefined;
  config.setupRegistrationToken = 'b'.repeat(64);
  try {
    const response = await f.post('/register', { orgName: 'Test Traders', orgGstin: '36AAXFS1234K1Z' + gstinCheckChar('36AAXFS1234K1Z'), name: 'Test Owner', email: 'owner@example.com', password: 'test-password-123', mobile: '+91 9876543210', setupCode: config.setupRegistrationToken });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.role, 'Owner');
    assert.ok(response.body.token);
    assert.deepEqual(await f.get('/setup-status'), { status: 200, body: { available: false } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], '[TEST EMAIL]');
    const mail = JSON.parse(logs[0][1]);
    assert.equal(mail.to, 'owner@example.com');
    assert.match(mail.text, /master admin/);
    assert.match(mail.text, /https:\/\/frontend\.example\.com\/login/);
    assert.equal(JSON.stringify(logs).includes('test-password-123'), false);
    assert.equal(JSON.stringify(logs).includes(config.setupRegistrationToken), false);
    assert.equal(f.smtp.messages.length, 0);
  } finally { console.log = originalLog; config.setupRegistrationToken = originalToken; await f.close(); }
});

test('console reset logs a usable single-use link and keeps unknown accounts private', async () => {
  const f = await fixture();
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args);
  config.mailDeliveryMode = 'console'; config.smtpHost = undefined; config.smtpFrom = undefined;
  try {
    const unknown = await f.post('/forgot-password', { email: 'missing@example.com' });
    assert.equal(logs.length, 0);
    const known = await f.post('/forgot-password', { email: 'owner@example.com' });
    assert.deepEqual(known, unknown);
    assert.equal(logs.length, 1);
    const mail = JSON.parse(logs[0][1]);
    const token = mail.text.match(/reset=([a-f0-9]{64})/)[1];
    assert.equal(mail.delivery, 'console');
    assert.equal(f.smtp.messages.length, 0);
    assert.equal((await f.post('/reset-password', { token, password: 'new-password-123' })).status, 200);
    assert.equal((await f.post('/reset-password', { token, password: 'another-password' })).status, 400);
  } finally { console.log = originalLog; await f.close(); }
});
