/** Read-only smoke check for a RUNNING gateway; no sign-in credentials needed. */
const base = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '');
const checks = [
  ['/health', 200, 'database-ready health'],
  ['/login', 200, 'frontend sign-in'],
  ['/api/v1/items', 401, 'protected API without JWT'],
];
let failed = 0;
for (const [path, expected, label] of checks) {
  try {
    const res = await fetch(base + path, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json, text/html' } });
    if (res.status !== expected) {
      console.error(`FAIL ${label}: expected ${expected}, got ${res.status}`);
      failed++;
    } else {
      console.log(`PASS ${label} (${res.status})`);
    }
  } catch (err) {
    console.error(`FAIL ${label}: ${err.message}`);
    failed++;
  }
}
if (failed) { console.error(`${failed} gateway smoke check(s) failed`); process.exitCode = 1; }
else console.log('Gateway smoke checks passed. Authenticated and transactional workflows require separate browser/MySQL testing.');
