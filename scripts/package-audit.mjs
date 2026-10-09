/** Offline deployment package checks. These checks do NOT contact Docker, MySQL or SMTP. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function auditPackage(root) {
  const problems = [];
  const required = [
    'compose.yaml', 'frontend.Dockerfile', 'backend/Dockerfile',
    'backend/package.json', 'backend/package-lock.json',
    'backend/src/app.ts', 'backend/src/rate-limit.ts',
    'backend/db/schema.sql', 'backend/db/migrations/002_grn_invoice_registry.sql',
    'docker/nginx.conf', 'scripts/http-smoke.mjs', 'scripts/backup-mysql.sh',
    'scripts/tenant-isolation-smoke.mjs',
    'scripts/workflow-acceptance-smoke.mjs', 'scripts/mysql-rollback-smoke.mjs',
  ];
  for (const file of required) {
    if (!existsSync(resolve(root, file))) problems.push(`Missing: ${file}`);
  }
  if (problems.length) return problems;
  let lock;
  let manifest;
  try {
    lock = JSON.parse(readFileSync(resolve(root, 'backend/package-lock.json'), 'utf8'));
    manifest = JSON.parse(readFileSync(resolve(root, 'backend/package.json'), 'utf8'));
  } catch (err) {
    return [`Backend package metadata cannot be parsed: ${err.message}`];
  }
  if (lock.lockfileVersion !== 3) problems.push('Backend package-lock.json must be lockfile v3');
  for (const [name, entry] of Object.entries(lock.packages ?? {})) {
    if (!entry.resolved) continue;
    let url;
    try { url = new URL(entry.resolved); }
    catch { problems.push(`Non-URL package resolution: ${name}`); continue; }
    if (url.protocol !== 'https:' || !['registry.npmjs.org', 'cdn.sheetjs.com'].includes(url.hostname)) {
      problems.push(`Package ${name} resolves through an unexpected or private registry: ${url.hostname}`);
    }
    if (!entry.integrity || !entry.integrity.startsWith('sha512-')) {
      problems.push(`Missing SHA-512 integrity for ${name}`);
    }
  }
  const rootPackage = lock.packages?.[''] ?? {};
  for (const kind of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(manifest[kind] ?? {})) {
      if (rootPackage[kind]?.[name] !== version) problems.push(`Lockfile mismatch: ${kind}/${name}`);
    }
  }
  const compose = readFileSync(resolve(root, 'compose.yaml'), 'utf8');
  for (const service of ['mysql', 'backend', 'frontend', 'gateway']) {
    if (!new RegExp(`^  ${service}:`, 'm').test(compose)) problems.push(`Compose missing service: ${service}`);
  }
  const backendService = compose.match(/^  backend:\s*\n([\s\S]*?)(?=^  [a-z][\w-]*:|^networks:|^volumes:|$(?![\s\S]))/m)?.[1] ?? '';
  if (/^    ports:/m.test(backendService)) {
    problems.push('Backend must not publish its port; the Nginx gateway must be its only public HTTP ingress');
  }
  const schema = readFileSync(resolve(root, 'backend/db/schema.sql'), 'utf8');
  if (!schema.includes('CREATE TABLE IF NOT EXISTS grn_invoice_registry')) {
    problems.push('Schema missing concurrent supplier invoice protection');
  }
  const nginx = readFileSync(resolve(root, 'docker/nginx.conf'), 'utf8');
  if (!nginx.includes('location = /health') || !nginx.includes('location /api/')) {
    problems.push('Gateway missing health or API routing');
  }
  const app = readFileSync(resolve(root, 'backend/src/app.ts'), 'utf8');
  const limiter = readFileSync(resolve(root, 'backend/src/rate-limit.ts'), 'utf8');
  if (!/app\.set\(['"]trust proxy['"],\s*1\)/.test(app) ||
      !/const ip = req\.ip \|\| req\.socket\.remoteAddress/.test(limiter) ||
      (nginx.match(/proxy_set_header X-Forwarded-For \$remote_addr;/g) ?? []).length < 2 ||
      nginx.includes('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;')) {
    problems.push('Authentication limiter must use one trusted gateway hop with client-IP headers overwritten by Nginx');
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] ?? dirname(fileURLToPath(import.meta.url)) + '/..');
  const issues = auditPackage(root);
  if (issues.length) {
    console.error(`Offline package audit FAILED (${issues.length} issue(s)):`);
    for (const issue of issues) console.error(' - ' + issue);
    process.exitCode = 1;
  } else console.log('Offline package audit passed. Network access, image builds and live services remain UNVERIFIED.');
}
