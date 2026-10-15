import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applySchema } from '../src/schema-migration.ts';

test('MySQL quotation autosave migration preserves drafts and serializes optimistic updates', {
  skip: !process.env.MYSQL_MIGRATION_TEST_URL,
}, async () => {
  const url = new URL(process.env.MYSQL_MIGRATION_TEST_URL);
  assert.match(url.pathname, /^\/migration_test[a-z0-9_]*$/i);
  const mysql = await import('mysql2/promise');
  const pool = mysql.createPool(process.env.MYSQL_MIGRATION_TEST_URL);
  const org = 'autosave-test-org', user = 'autosave-test-user';
  const migration = readFileSync(new URL('../db/migrations/006_quotation_drafts.sql', import.meta.url), 'utf8');
  try {
    await applySchema(migration, pool);
    await pool.query('DELETE FROM quotation_drafts WHERE org_id = ?', [org]);
    await pool.query('INSERT INTO quotation_drafts (org_id,user_id,draft_key,body) VALUES (?,?,?,?)', [org,user,'new',JSON.stringify({notes:'preserve me'})]);
    await applySchema(migration, pool);
    const [preserved] = await pool.query('SELECT body FROM quotation_drafts WHERE org_id=? AND user_id=?', [org,user]);
    assert.deepEqual(preserved[0].body, {notes:'preserve me'});
    async function update(expected, notes) {
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [rows] = await c.query('SELECT version FROM quotation_drafts WHERE org_id=? AND user_id=? AND draft_key=? FOR UPDATE', [org,user,'new']);
        if (rows[0].version !== expected) { await c.rollback(); return 'conflict'; }
        await c.query('UPDATE quotation_drafts SET version=version+1,body=? WHERE org_id=? AND user_id=? AND draft_key=?', [JSON.stringify({notes}),org,user,'new']);
        await c.commit(); return 'saved';
      } finally { c.release(); }
    }
    assert.deepEqual((await Promise.all([update(0,'one'), update(0,'two')])).sort(), ['conflict','saved']);
    const [otherUser] = await pool.query('SELECT body FROM quotation_drafts WHERE org_id=? AND user_id=?', [org,'another-user']);
    assert.equal(otherUser.length,0);
    await pool.query('UPDATE quotation_drafts SET version=version+1,body=NULL WHERE org_id=? AND user_id=?', [org,user]);
    assert.equal(await update(1,'stale autosave after final Save'), 'conflict');
  } finally {
    await pool.query('DELETE FROM quotation_drafts WHERE org_id=?', [org]);
    await pool.end();
  }
});
