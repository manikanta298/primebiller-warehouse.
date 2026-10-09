/** Offline production .env checks. Does not print credentials or connect to services. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseEnvFile(contents) {
  const env = {};
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const equal = line.indexOf('=');
    if (equal < 1) continue;
    const key = line.slice(0, equal).trim();
    let value = line.slice(equal + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

export function checkProductionEnv(env) {
  const errors = [];
  const value = (key) => (env[key] || '').trim();
  const placeholder = (s) => /replace_with|changeme|your[_-]?secret|your[_-]?password|^example|^password$/i.test(s);
  for (const key of ['MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD']) {
    if (value(key).length < 16 || placeholder(value(key))) errors.push(`${key}: supply a strong, non-placeholder password (16+ characters)`);
  }
  // DATABASE_URL is assembled from MYSQL_PASSWORD in compose.yaml. Reserved URI bytes are unsafe there.
  if (value('MYSQL_PASSWORD') && !/^[A-Za-z0-9_-]+$/.test(value('MYSQL_PASSWORD'))) {
    errors.push('MYSQL_PASSWORD: use only URL-safe letters, digits, underscores or hyphens for compose.yaml');
  }
  for (const key of ['JWT_SECRET', 'SETTINGS_KEY']) {
    if (!/^[a-f0-9]{64}$/i.test(value(key))) errors.push(`${key}: generate a unique 32-byte hex key (openssl rand -hex 32)`);
  }
  if (value('JWT_SECRET') && value('JWT_SECRET') === value('SETTINGS_KEY')) errors.push('SETTINGS_KEY: use a key distinct from JWT_SECRET');
  try {
    const url = new URL(value('APP_URL'));
    if (url.protocol !== 'https:' || !url.hostname || /^(localhost|127\.0\.0\.1)$/i.test(url.hostname) || url.username || url.password) throw new Error('invalid');
  } catch { errors.push('APP_URL: use the actual public HTTPS origin'); }
  if (!value('SMTP_HOST') || /^(mailpit|localhost|127\.0\.0\.1)$/i.test(value('SMTP_HOST'))) errors.push('SMTP_HOST: configure a real delivery server, not the local test inbox');
  if (!Number.isInteger(Number(value('SMTP_PORT'))) || Number(value('SMTP_PORT')) < 1 || Number(value('SMTP_PORT')) > 65535) errors.push('SMTP_PORT: invalid port');
  if (!['starttls', 'tls'].includes(value('SMTP_SECURITY'))) errors.push('SMTP_SECURITY: use starttls or tls');
  if (!value('SMTP_USER') || !value('SMTP_PASSWORD') || placeholder(value('SMTP_PASSWORD'))) errors.push('SMTP_USER/SMTP_PASSWORD: configure SMTP credentials');
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test((value('SMTP_FROM').match(/<([^<>]+)>/) || [null, value('SMTP_FROM')])[1]) || /\.(test|invalid|example|localhost)>?$/i.test(value('SMTP_FROM'))) {
    errors.push('SMTP_FROM: specify a deliverable email address');
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = process.argv[2] || '.env';
  try {
    const env = parseEnvFile(readFileSync(path, 'utf8'));
    const errors = checkProductionEnv(env);
    if (errors.length) {
      console.error(`Production preflight FAILED (${errors.length} issue(s)):`);
      for (const error of errors) console.error(` - ${error}`);
      process.exitCode = 1;
    } else console.log('Production .env preflight passed. Live HTTPS, SMTP, MySQL and Docker checks still required.');
  } catch (error) {
    console.error(`Cannot open production .env: ${error.message}`);
    process.exitCode = 1;
  }
}
