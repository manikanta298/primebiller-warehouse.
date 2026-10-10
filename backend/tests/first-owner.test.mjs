import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

process.env.DATABASE_URL = 'mysql://test:test@localhost/test';
process.env.JWT_SECRET = 'a'.repeat(64);
const { createFirstOwner, firstOwnerInput, verifySetupToken } = await import('../src/first-owner.ts');
const { gstinCheckChar } = await import('../src/shared/gst.ts');
const gstin = '36AAXFS1234K1Z' + gstinCheckChar('36AAXFS1234K1Z');
const input = { orgName: 'Test Traders', orgGstin: gstin, name: 'Test Owner', email: ' OWNER@EXAMPLE.COM ', password: 'test-password-123' };

function database({ existingOrg = false, existingUser = false, failWrite = false, busy = false } = {}) {
  const state = { org: existingOrg, user: existingUser, inserts: [], events: [], hash: '', email: '' };
  let held = false;
  const waiting = [];
  return {
    state,
    async getConnection() {
      let staged = [];
      return {
        async query(sql, params = []) {
          if (sql.includes('GET_LOCK')) {
            if (busy) return [[{ acquired: 0 }], []];
            if (held) await new Promise((resolve) => waiting.push(resolve));
            held = true;
            state.events.push('lock');
            return [[{ acquired: 1 }], []];
          }
          if (sql.includes('RELEASE_LOCK')) {
            state.events.push('unlock');
            const next = waiting.shift();
            if (next) next(); else held = false;
            return [[{ released: 1 }], []];
          }
          if (sql.startsWith('SELECT id FROM orgs')) return [state.org ? [{ id: 'org_existing' }] : [], []];
          if (sql.startsWith('SELECT id FROM users')) return [state.user ? [{ id: 'user_existing' }] : [], []];
          if (failWrite && sql.startsWith('INSERT INTO org_settings')) throw new Error('simulated write failure');
          staged.push({ sql, params });
          return [{ affectedRows: 1 }, []];
        },
        async beginTransaction() { state.events.push('begin'); },
        async commit() {
          state.events.push('commit');
          state.inserts.push(...staged);
          state.org = true; state.user = true;
          const user = staged.find((row) => row.sql.startsWith('INSERT INTO users'));
          state.hash = user.params[4]; state.email = user.params[2];
        },
        async rollback() { state.events.push('rollback'); staged = []; },
        release() { state.events.push('release'); },
        destroy() { state.events.push('destroy'); },
      };
    },
  };
}

test('setup code is mandatory, compared safely, and cannot be an empty or short value', () => {
  const code = 'a'.repeat(64);
  verifySetupToken(code, code);
  for (const [provided, expected] of [['', ''], ['short', 'short'], ['b'.repeat(64), code], [code, '']]) {
    assert.throws(() => verifySetupToken(provided, expected), (error) => error.status === 403);
  }
});

test('registration rejects invalid GSTIN, weak passwords and injected role fields', () => {
  assert.equal(firstOwnerInput.parse(input).email, 'owner@example.com');
  for (const invalid of [{ ...input, orgGstin: 'INVALID' }, { ...input, password: 'short' }, { ...input, role: 'Owner' }]) {
    assert.equal(firstOwnerInput.safeParse(invalid).success, false);
  }
});

test('first registration hashes the password and creates Owner, settings, series and print profiles atomically', async () => {
  const db = database();
  const id = await createFirstOwner(input, db);
  assert.ok(id.startsWith('u'));
  assert.equal(db.state.email, 'owner@example.com');
  assert.notEqual(db.state.hash, input.password);
  assert.equal(await bcrypt.compare(input.password, db.state.hash), true);
  assert.equal(db.state.inserts.filter((row) => row.sql.includes('doc_series')).length, 8);
  assert.equal(db.state.inserts.filter((row) => row.sql.includes('print_profiles')).length, 2);
  assert.ok(db.state.inserts.some((row) => row.sql.includes("'Owner'")));
  assert.deepEqual(db.state.events, ['lock', 'begin', 'commit', 'unlock', 'release']);
});

test('existing installations reject registration without writing or promoting an account', async () => {
  for (const state of [{ existingOrg: true }, { existingUser: true }]) {
    const db = database(state);
    await assert.rejects(createFirstOwner(input, db), (error) => error.status === 409);
    assert.equal(db.state.inserts.length, 0);
    assert.deepEqual(db.state.events, ['lock', 'begin', 'rollback', 'unlock', 'release']);
  }
});

test('concurrent registrations allow exactly one Owner and release the lock after commit', async () => {
  const db = database();
  const results = await Promise.allSettled([createFirstOwner(input, db), createFirstOwner({ ...input, email: 'second@example.com' }, db)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.status, 409);
  assert.equal(db.state.inserts.filter((row) => row.sql.startsWith('INSERT INTO users')).length, 1);
  assert.ok(db.state.events.indexOf('commit') < db.state.events.indexOf('unlock'));
});

test('write failure rolls back all setup records; unavailable lock fails before transaction', async () => {
  const failed = database({ failWrite: true });
  await assert.rejects(createFirstOwner(input, failed), /simulated write failure/);
  assert.equal(failed.state.inserts.length, 0);
  assert.equal(failed.state.org, false);
  assert.deepEqual(failed.state.events, ['lock', 'begin', 'rollback', 'unlock', 'release']);
  const busy = database({ busy: true });
  await assert.rejects(createFirstOwner(input, busy), (error) => error.status === 503);
  assert.deepEqual(busy.state.events, ['release']);
});


test('simple registration creates an Owner with blank tax details and a default business name', async () => {
  const db = database();
  const simple = { name: 'Test Owner', email: 'OWNER@example.com', mobile: '+91 9876543210', password: 'test-password-123' };
  await createFirstOwner(simple, db);
  const org = db.state.inserts.find((row) => row.sql.startsWith('INSERT INTO orgs'));
  assert.deepEqual(org.params.slice(1), ["Test Owner's business", '', '', '']);
  const user = db.state.inserts.find((row) => row.sql.startsWith('INSERT INTO users'));
  assert.equal(user.params[3], simple.mobile);
  const settings = JSON.parse(db.state.inserts.find((row) => row.sql.startsWith('INSERT INTO org_settings')).params[1]);
  assert.equal(settings.gstin, '');
  assert.equal(settings.pan, '');
  assert.equal(settings.stateCode, '');
  assert.equal(settings.phone, simple.mobile);
  assert.equal(settings.legalName, "Test Owner's business");
  assert.equal(db.state.inserts.filter((row) => row.sql.includes("'Owner'")).length, 1);
});

test('business details remain optional, but invalid provided tax and phone details are rejected', () => {
  const simple = { name: 'Test Owner', email: 'owner@example.com', mobile: '+91 9876543210', password: 'test-password-123' };
  assert.equal(firstOwnerInput.safeParse(simple).success, true);
  assert.equal(firstOwnerInput.safeParse({ ...simple, orgName: '', orgGstin: '' }).success, true);
  for (const mobile of ['123', 'not-a-phone', '+1234567890123456']) assert.equal(firstOwnerInput.safeParse({ ...simple, mobile }).success, false);
  assert.equal(firstOwnerInput.safeParse({ ...simple, orgGstin: 'INVALID' }).success, false);
});
