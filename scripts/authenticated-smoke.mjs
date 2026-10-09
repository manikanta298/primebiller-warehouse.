/** Read-only operator smoke: requires an Owner/Manager JWT for one test organisation.
 * Example: SMOKE_TOKEN=... SMOKE_ORG_ID=... node scripts/authenticated-smoke.mjs https://my-domain
 * No mutations, credentials or API responses are printed. Do not run against production
 * with a personal JWT; use a short-lived dedicated test account and revoke it afterward.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function runAuthenticatedSmoke(base, { token, orgId, fetcher = fetch } = {}) {
  if (!token || !orgId) throw new Error('SMOKE_TOKEN and SMOKE_ORG_ID are both required');
  const origin = new URL(base);
  if (origin.username || origin.password || origin.search || origin.hash) throw new Error('Use only an HTTP(S) origin without credentials, query or fragment');
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) {
    throw new Error('Remote gateway requires HTTPS');
  }
  const paths = [
    ['/api/v1/items', 'items', Array.isArray],
    ['/api/v1/parties', 'parties', Array.isArray],
    [`/api/v1/orgs/${encodeURIComponent(orgId)}/godowns`, 'warehouses', Array.isArray],
    ['/api/v1/dashboard', 'dashboard', v => v !== null && typeof v === 'object' && !Array.isArray(v)],
  ];
  const results = [];
  for (const [path, label, valid] of paths) {
    try {
      const res = await fetcher(new URL(path, origin), {
        headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': orgId, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status !== 200) { results.push({ label, ok: false, reason: `HTTP ${res.status}` }); continue; }
      const content = await res.json();
      results.push({ label, ok: valid(content), reason: valid(content) ? 'OK' : 'Unexpected JSON structure' });
    } catch (err) { results.push({ label, ok: false, reason: err.message }); }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const results = await runAuthenticatedSmoke(process.argv[2] ?? 'http://localhost:8080', {
      token: process.env.SMOKE_TOKEN, orgId: process.env.SMOKE_ORG_ID,
    });
    for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.label}: ${result.reason}`);
    if (results.some(v => !v.ok)) process.exitCode = 1;
    else console.log('Authenticated READ-ONLY smoke checks passed. Financial postings and org isolation still require a seeded integration test.');
  } catch (err) {
    console.error(`Authenticated smoke cannot run: ${err.message}`);
    process.exitCode = 2;
  }
}
