import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { auditPackage } from '../scripts/package-audit.mjs';
import { runAuthenticatedSmoke } from '../scripts/authenticated-smoke.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'compose.yaml', 'frontend.Dockerfile', 'backend/Dockerfile',
  'backend/package.json', 'backend/package-lock.json',
  'backend/db/schema.sql', 'backend/db/migrations/002_grn_invoice_registry.sql',
  'docker/nginx.conf', 'scripts/http-smoke.mjs', 'scripts/backup-mysql.sh',
  'scripts/tenant-isolation-smoke.mjs',
  'scripts/workflow-acceptance-smoke.mjs', 'scripts/mysql-rollback-smoke.mjs',
  'backend/src/app.ts', 'backend/src/rate-limit.ts',
];
function fixture(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'girder-audit-'));
  try {
    for (const p of required) {
      mkdirSync(dirname(join(tmp, p)), { recursive: true });
      copyFileSync(join(root, p), join(tmp, p));
    }
    return fn(tmp);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

test('offline audit confirms package is complete and public-registry pinned', () => {
  assert.deepEqual(auditPackage(root), []);
  const lock = JSON.parse(readFileSync(join(root, 'backend/package-lock.json'), 'utf8'));
  assert.equal(Object.values(lock.packages).filter(p => p.resolved?.startsWith('https://registry.npmjs.org/')).length > 100, true);
});

test('offline audit rejects a private dependency registry, without altering original package', () => {
  fixture(tmp => {
    const p = join(tmp, 'backend/package-lock.json');
    const lock = JSON.parse(readFileSync(p, 'utf8'));
    const first = Object.values(lock.packages).find(v => v.resolved?.startsWith('https://registry.npmjs.org/'));
    first.resolved = 'https://internal.invalid/private-package.tgz';
    writeFileSync(p, JSON.stringify(lock));
    assert.ok(auditPackage(tmp).some(v => v.includes('unexpected or private registry')));
  });
});

test('offline audit fails for missing Docker service and missing SQL schema', () => {
  fixture(tmp => {
    const compose = join(tmp, 'compose.yaml');
    writeFileSync(compose, readFileSync(compose, 'utf8').replace('  gateway:', '  missing-gateway:'));
    assert.ok(auditPackage(tmp).some(v => v.includes('Compose missing service: gateway')));
  });
});

test('offline audit rejects untrusted forwarding configuration or an exposed backend port', () => {
  fixture(tmp => {
    const nginx = join(tmp, 'docker/nginx.conf');
    writeFileSync(nginx, readFileSync(nginx, 'utf8').replaceAll('$remote_addr;', '$proxy_add_x_forwarded_for;'));
    assert.ok(auditPackage(tmp).some(v => v.includes('client-IP headers overwritten')));
  });
  fixture(tmp => {
    const composePath = join(tmp, 'compose.yaml');
    const compose = readFileSync(composePath, 'utf8');
    writeFileSync(composePath, compose.replace('  backend:\n', '  backend:\n    ports:\n      - "4000:4000"\n'));
    assert.ok(auditPackage(tmp).some(v => v.includes('must not publish its port')));
  });
});

test('authenticated smoke only performs organisation-scoped GETs with JWT, no writes', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url: url.toString(), options });
    return { status: 200, json: async () => url.pathname.endsWith('/dashboard') ? { sales: {} } : [] };
  };
  const out = await runAuthenticatedSmoke('http://localhost:8080', { token: 'test-token', orgId: 'org A/B', fetcher });
  assert.equal(out.length, 4);
  assert.ok(out.every(x => x.ok));
  assert.equal(requests.length, 4);
  assert.ok(requests.every(x => x.options.headers.Authorization === 'Bearer test-token'));
  assert.ok(requests.every(x => x.options.headers['X-Org-Id'] === 'org A/B'));
  assert.ok(requests.every(x => !x.options.method || x.options.method === 'GET'));
  assert.ok(requests.some(x => x.url.includes('/orgs/org%20A%2FB/godowns')));
});

test('authenticated smoke flags an HTTP error and malformed dashboard JSON', async () => {
  const out = await runAuthenticatedSmoke('https://example.com', {
    token: 'secret', orgId: 'org1',
    fetcher: async url => url.pathname.endsWith('/dashboard')
      ? { status: 200, json: async () => [] }
      : { status: 403, json: async () => ({ message: 'Access denied' }) },
  });
  assert.equal(out.filter(x => !x.ok).length, 4);
  assert.ok(out.some(x => x.reason === 'HTTP 403'));
  assert.ok(out.some(x => x.reason === 'Unexpected JSON structure'));
});

test('authenticated smoke rejects remote HTTP, URL credentials, and missing JWT', async () => {
  await assert.rejects(runAuthenticatedSmoke('http://example.com', { token: 'a', orgId: 'b' }), /HTTPS/);
  await assert.rejects(runAuthenticatedSmoke('https://u:p@example.com', { token: 'a', orgId: 'b' }), /without credentials/);
  await assert.rejects(runAuthenticatedSmoke('https://example.com', { token: '', orgId: 'b' }), /both required/);
});
