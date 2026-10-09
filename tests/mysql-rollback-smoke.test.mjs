import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { runMysqlRollbackSmoke } from '../scripts/mysql-rollback-smoke.mjs';

function fakeMysql({ unique = true, rollbackWorks = true } = {}) {
  let data = new Set(), snapshot = new Set(), ended = false;
  const calls = [];
  return {
    calls,
    connector: async () => ({
      beginTransaction: async () => { snapshot = new Set(data); calls.push('BEGIN'); },
      rollback: async () => { if (rollbackWorks) data = new Set(snapshot); calls.push('ROLLBACK'); },
      end: async () => { ended = true; calls.push('END'); },
      query: async (sql, params) => {
        calls.push(sql.split(' ')[0]);
        if (sql.startsWith('INSERT')) {
          if (unique && data.has(params[0])) throw Object.assign(Error('duplicate'), { code: 'ER_DUP_ENTRY' });
          data.add(params[0]);
        }
        if (sql.startsWith('SELECT')) return [[{ n: data.size }]];
        return [[], []];
      },
    }),
    ended: () => ended,
  };
}
const base = { databaseUrl: 'mysql://name:pass@localhost:3306/girder_acceptance', confirmation: 'YES_ISOLATED_TEST_DB' };

test('rollback probe passes uncommitted insert and unique constraint with temporary table only', async () => {
  const fake = fakeMysql();
  const result = await runMysqlRollbackSmoke({ ...base, connector: fake.connector });
  assert.equal(result.length, 2);
  assert.ok(result.every(x => x.ok));
  assert.ok(fake.calls.includes('CREATE') && fake.calls.includes('DROP'));
  assert.ok(fake.ended());
  assert.equal(fake.calls.filter(x => x === 'ROLLBACK').length, 2);
});

test('rollback check fails closed if rollback does not undo an insert', async () => {
  const fake = fakeMysql({ rollbackWorks: false });
  const result = await runMysqlRollbackSmoke({ ...base, connector: fake.connector });
  assert.equal(result[0].ok, false);
  assert.ok(fake.ended());
});

test('rollback probe catches missing duplicate enforcement', async () => {
  const fake = fakeMysql({ unique: false });
  const result = await runMysqlRollbackSmoke({ ...base, connector: fake.connector });
  assert.equal(result[1].ok, false);
});

test('refuses production DB names and missing opt-in before connecting', async () => {
  const never = async () => { throw new Error('should not connect'); };
  await assert.rejects(runMysqlRollbackSmoke({ ...base, confirmation: '', connector: never }), /ACCEPTANCE_DB_CONFIRM/);
  await assert.rejects(runMysqlRollbackSmoke({ ...base, databaseUrl: 'mysql://localhost:3306/girder', connector: never }), /test, acceptance or staging/);
  await assert.rejects(runMysqlRollbackSmoke({ ...base, databaseUrl: 'postgres://localhost/girder_test', connector: never }), /MySQL database/);
});
