/**
 * Read-only, two-account tenant-isolation smoke for a RUNNING Girder gateway.
 * Supply two *different* test accounts, each a member of only its own test org.
 * Uses GET only; never logs bearer tokens or API response bodies.
 * Does not prove write-path isolation or DB transaction safety.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

function validateOrigin(base) {
  const origin = new URL(base);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error('Specify only a gateway origin; no path, credentials, query or fragment');
  }
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) {
    throw new Error('Remote gateway requires HTTPS');
  }
  return origin;
}

function validateAccount(token, id, name) {
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw new Error(`${name} requires a valid test JWT`);
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error(`${name} requires a simple test organisation ID`);
}

export async function runTenantIsolationSmoke(base, { aToken, aOrgId, bToken, bOrgId, fetcher = fetch } = {}) {
  const origin = validateOrigin(base);
  validateAccount(aToken, aOrgId, 'Account A');
  validateAccount(bToken, bOrgId, 'Account B');
  if (aToken === bToken || aOrgId === bOrgId) throw new Error('Use two distinct accounts in different, exclusive test organisations');

  const calls = [
    // Each test account must have read permissions in its *own* organisation.
    ...['items', 'invoices', 'grns'].flatMap(resource => [
      { label: `A own ${resource}`, path: `/api/v1/${resource}`, token: aToken, org: aOrgId, status: 200, array: true },
      { label: `B own ${resource}`, path: `/api/v1/${resource}`, token: bToken, org: bOrgId, status: 200, array: true },
    ]),
    // A valid user must not access the other organisation by merely swapping X-Org-Id.
    { label: 'A denied by B header', path: '/api/v1/items', token: aToken, org: bOrgId, status: 403 },
    { label: 'B denied by A header', path: '/api/v1/items', token: bToken, org: aOrgId, status: 403 },
    // Nor by tampering with an organisation ID in the URL while keeping their own header.
    { label: 'A denied by B path', path: `/api/v1/orgs/${encodeURIComponent(bOrgId)}/godowns`, token: aToken, org: aOrgId, status: 403 },
    { label: 'B denied by A path', path: `/api/v1/orgs/${encodeURIComponent(aOrgId)}/godowns`, token: bToken, org: bOrgId, status: 403 },
    { label: 'No JWT denied', path: '/api/v1/items', org: aOrgId, status: 401 },
    { label: 'Invalid JWT denied', path: '/api/v1/items', token: 'not-a-valid-jwt', org: aOrgId, status: 401 },
  ];
  const results = [];
  for (const check of calls) {
    try {
      const headers = { Accept: 'application/json', 'X-Org-Id': check.org };
      if (check.token) headers.Authorization = `Bearer ${check.token}`;
      const response = await fetcher(new URL(check.path, origin), {
        method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(8000),
      });
      let ok = response.status === check.status;
      let reason = ok ? `HTTP ${check.status}` : `Expected HTTP ${check.status}, got ${response.status}`;
      if (ok && check.array) {
        const data = await response.json();
        ok = Array.isArray(data);
        if (!ok) reason = 'Unexpected JSON structure';
      }
      results.push({ label: check.label, ok, reason });
    } catch {
      results.push({ label: check.label, ok: false, reason: 'Network or response error' });
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const results = await runTenantIsolationSmoke(process.argv[2] ?? 'http://localhost:8080', {
      aToken: process.env.SMOKE_A_TOKEN, aOrgId: process.env.SMOKE_A_ORG_ID,
      bToken: process.env.SMOKE_B_TOKEN, bOrgId: process.env.SMOKE_B_ORG_ID,
    });
    for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.label}: ${item.reason}`);
    if (results.some(item => !item.ok)) process.exitCode = 1;
    else console.log('Read-only two-organisation access checks passed. Write isolation still requires live DB integration tests.');
  } catch (error) {
    console.error(`Tenant smoke cannot run: ${error.message}`);
    process.exitCode = 2;
  }
}
