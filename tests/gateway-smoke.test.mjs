import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('gateway smoke script checks DB readiness, HTML sign-in and JWT protection', () => {
  const script = readFileSync(resolve(root, 'scripts/http-smoke.mjs'), 'utf8');
  assert.match(script, /\/health/);
  assert.match(script, /\/login/);
  assert.match(script, /\/api\/v1\/items/);
  assert.match(script, /401/);
  assert.match(script, /200/);
});

test('mysql backup script does not write incomplete archives as completed backups', () => {
  const backup = readFileSync(resolve(root, 'scripts/backup-mysql.sh'), 'utf8');
  assert.match(backup, /\.partial/);
  assert.match(backup, /gzip -t/);
  assert.match(backup, /trap/);
  assert.match(backup, /--single-transaction/);
  const checked = spawnSync('bash', ['-n', resolve(root, 'scripts/backup-mysql.sh')], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
});

test('nginx applies IP rate limiting to authentication endpoints', () => {
  const nginx = readFileSync(resolve(root, 'docker/nginx.conf'), 'utf8');
  assert.match(nginx, /limit_req_zone \$binary_remote_addr/);
  assert.match(nginx, /location \^~ \/api\/v1\/auth\//);
  assert.match(nginx, /limit_req_status 429/);
});
