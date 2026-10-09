import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { runTenantIsolationSmoke } from '../scripts/tenant-isolation-smoke.mjs';

function mockServer({ letAAccessB = false, failJson = false, incorrectDenied = false } = {}) {
  const requests = [];
  const fetcher = async (url, opts) => {
    requests.push({ url, opts });
    const token = opts.headers.Authorization?.replace('Bearer ', '');
    const org = opts.headers['X-Org-Id'];
    let status;
    if (!token || token === 'not-a-valid-jwt') status = 401;
    else if ((token === 'jwt-A' && org === 'org-B') || (token === 'jwt-B' && org === 'org-A')) status = letAAccessB && token === 'jwt-A' ? 200 : 403;
    else if (/\/orgs\/org-[AB]\/godowns/.test(url.pathname) && !url.pathname.includes(`/orgs/${org}/`)) status = incorrectDenied ? 200 : 403;
    else status = 200;
    return { status, json: async () => failJson && url.pathname.endsWith('/invoices') ? {} : [] };
  };
  return { fetcher, requests };
}
const credentials = { aToken: 'jwt-A', aOrgId: 'org-A', bToken: 'jwt-B', bOrgId: 'org-B' };

test('two-tenant mock smoke covers 12 read-only own, cross-tenant and unauthenticated cases', async () => {
  const { fetcher, requests } = mockServer();
  const results = await runTenantIsolationSmoke('http://127.0.0.1:8080', { ...credentials, fetcher });
  assert.equal(results.length, 12);
  assert.equal(results.filter(x => x.ok).length, 12);
  assert.equal(requests.length, 12);
  assert.ok(requests.every(x => x.opts.method === 'GET' && x.opts.redirect === 'manual'));
  assert.ok(requests.every(x => x.url.origin === 'http://127.0.0.1:8080'));
  assert.ok(requests.some(x => x.url.pathname === '/api/v1/orgs/org-B/godowns' && x.opts.headers['X-Org-Id'] === 'org-A'));
});

test('wrong-org header access mistakenly allowed is flagged', async () => {
  const { fetcher } = mockServer({ letAAccessB: true });
  const results = await runTenantIsolationSmoke('https://example.com', { ...credentials, fetcher });
  assert.ok(results.some(x => x.label === 'A denied by B header' && !x.ok));
});

test('wrong-org URL path access mistakenly allowed is flagged', async () => {
  const { fetcher } = mockServer({ incorrectDenied: true });
  const results = await runTenantIsolationSmoke('https://example.com', { ...credentials, fetcher });
  assert.ok(results.some(x => x.label === 'A denied by B path' && !x.ok));
});

test('own-tenant JSON shape failure is flagged', async () => {
  const { fetcher } = mockServer({ failJson: true });
  const results = await runTenantIsolationSmoke('https://example.com', { ...credentials, fetcher });
  assert.equal(results.filter(x => !x.ok).length, 2);
  assert.ok(results.filter(x => !x.ok).every(x => x.reason === 'Unexpected JSON structure'));
});

test('refuses two matching orgs, two matching tokens and missing credentials', async () => {
  await assert.rejects(runTenantIsolationSmoke('https://example.com', { ...credentials, bOrgId: 'org-A' }), /two distinct/);
  await assert.rejects(runTenantIsolationSmoke('https://example.com', { ...credentials, bToken: 'jwt-A' }), /two distinct/);
  await assert.rejects(runTenantIsolationSmoke('https://example.com', { ...credentials, bToken: '' }), /requires a valid/);
  await assert.rejects(runTenantIsolationSmoke('https://example.com', { ...credentials, aOrgId: '\na' }), /organisation ID/);
});

test('rejects remote plaintext HTTP and gateway URLs with injected credentials/path', async () => {
  await assert.rejects(runTenantIsolationSmoke('http://example.com', credentials), /HTTPS/);
  await assert.rejects(runTenantIsolationSmoke('https://u:p@example.com', credentials), /origin/);
  await assert.rejects(runTenantIsolationSmoke('https://example.com/api/v1', credentials), /origin/);
});

test('fetch network failures fail closed without exposing an access token in results', async () => {
  const results = await runTenantIsolationSmoke('https://example.com', {
    ...credentials, fetcher: async () => { throw new Error('Confidential token jwt-A'); },
  });
  assert.equal(results.length, 12);
  assert.ok(results.every(x => !x.ok && x.reason === 'Network or response error'));
  assert.ok(!JSON.stringify(results).includes('jwt-A'));
});
