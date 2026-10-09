/**
 * Stage 23: MySQL transaction engine acceptance (NOT app posting acceptance).
 * Only uses a per-connection InnoDB TEMPORARY table; no persistent business rows.
 * Still refuses to run unless operator opts in on a clearly named test database.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

function validateDatabase(url, confirmation) {
  if (confirmation !== 'YES_ISOLATED_TEST_DB') throw new Error('Set ACCEPTANCE_DB_CONFIRM=YES_ISOLATED_TEST_DB after verifying an isolated test database');
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('ACCEPTANCE_DATABASE_URL must be a valid MySQL URL'); }
  const name = decodeURIComponent(parsed.pathname.slice(1));
  if (parsed.protocol !== 'mysql:' || !/(^|[_-])(test|acceptance|staging)([_-]|$)/i.test(name) || !/^[\w-]+$/.test(name)) {
    throw new Error('Use a MySQL database whose name explicitly includes test, acceptance or staging');
  }
  return parsed.toString();
}

export async function runMysqlRollbackSmoke({ databaseUrl, confirmation, connector } = {}) {
  const url = validateDatabase(databaseUrl, confirmation);
  if (!connector) {
    // Load backend's pinned mysql2 dependency only on a live validation host.
    const require = createRequire(new URL('../backend/package.json', import.meta.url));
    connector = (uri) => require('mysql2/promise').createConnection({ uri, multipleStatements: false });
  }
  const conn = await connector(url);
  const results = [];
  let inTransaction = false;
  let temporaryTableCreated = false;
  const query = async (sql, params = []) => (await conn.query(sql, params))[0];
  try {
    await query('CREATE TEMPORARY TABLE stage23_tx_acceptance (nonce VARCHAR(64) NOT NULL PRIMARY KEY) ENGINE=InnoDB');
    temporaryTableCreated = true;
    await conn.beginTransaction(); inTransaction = true;
    await query('INSERT INTO stage23_tx_acceptance (nonce) VALUES (?)', ['will-be-rolled-back']);
    const before = await query('SELECT COUNT(*) AS n FROM stage23_tx_acceptance');
    if (Number(before[0]?.n) !== 1) throw new Error('Test write not visible inside its transaction');
    await conn.rollback(); inTransaction = false;
    const after = await query('SELECT COUNT(*) AS n FROM stage23_tx_acceptance');
    results.push({ label: 'MySQL rollback of an uncommitted insert', ok: Number(after[0]?.n) === 0 });

    await conn.beginTransaction(); inTransaction = true;
    await query('INSERT INTO stage23_tx_acceptance (nonce) VALUES (?)', ['duplicated']);
    let duplicateRejected = false;
    try {
      await query('INSERT INTO stage23_tx_acceptance (nonce) VALUES (?)', ['duplicated']);
    } catch (e) {
      duplicateRejected = e?.code === 'ER_DUP_ENTRY' || e?.errno === 1062;
    }
    await conn.rollback(); inTransaction = false;
    const finalRows = await query('SELECT COUNT(*) AS n FROM stage23_tx_acceptance');
    results.push({ label: 'Unique constraint and failed-write rollback', ok: duplicateRejected && Number(finalRows[0]?.n) === 0 });
    return results;
  } finally {
    if (inTransaction) { try { await conn.rollback(); } catch { /* cleanup best effort */ } }
    if (temporaryTableCreated) { try { await query('DROP TEMPORARY TABLE IF EXISTS stage23_tx_acceptance'); } catch { /* cleanup best effort */ } }
    await conn.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const results = await runMysqlRollbackSmoke({
      databaseUrl: process.env.ACCEPTANCE_DATABASE_URL,
      confirmation: process.env.ACCEPTANCE_DB_CONFIRM,
    });
    for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.label}`);
    if (results.some(r => !r.ok)) process.exitCode = 1;
    else console.log('MySQL TEMPORARY-table transaction checks passed; business posting/concurrency still require dedicated application tests.');
  } catch {
    console.error('MySQL rollback acceptance failed or could not run. Check isolated database, installed backend dependencies and connectivity.');
    process.exitCode = 2;
  }
}
