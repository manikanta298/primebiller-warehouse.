import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { FixedWindowLimiter } from '../backend/src/rate-limit.ts';
import { checkProductionEnv } from '../scripts/production-preflight.mjs';

const validEnv = () => ({
  MYSQL_ROOT_PASSWORD: 'R_random_secure_password_1789!',
  MYSQL_PASSWORD: 'Safe_mysql_pass_1789',
  JWT_SECRET: 'a'.repeat(64),
  SETTINGS_KEY: 'b'.repeat(64),
  APP_URL: 'https://stock.example.com',
  SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_SECURITY: 'starttls',
  SMTP_USER: 'mailer@example.com', SMTP_PASSWORD: 'strong_smtp_password',
  SMTP_FROM: 'Girder <invoices@example.com>',
});

test('rate limiter permits bounded attempts and provides a retry time', () => {
  const limit = new FixedWindowLimiter(2, 60_000);
  assert.equal(limit.consume('ip1', 1000).allowed, true);
  assert.equal(limit.consume('ip1', 1001).allowed, true);
  assert.deepEqual(limit.consume('ip1', 1002), { allowed: false, retryAfter: 60 });
});

test('rate limiter isolates IPs and restores access after window expiry', () => {
  const limit = new FixedWindowLimiter(1, 60_000);
  assert.equal(limit.consume('ip1', 0).allowed, true);
  assert.equal(limit.consume('ip2', 1).allowed, true);
  assert.equal(limit.consume('ip1', 2).allowed, false);
  assert.equal(limit.consume('ip1', 60_000).allowed, true);
});

test('rate limiter fails closed under active key floods and reclaims expired keys', () => {
  const limit = new FixedWindowLimiter(1, 1_000, 1);
  assert.equal(limit.consume('ip1', 0).allowed, true);
  assert.equal(limit.consume('ip2', 100).allowed, false);
  assert.equal(limit.consume('ip2', 1_000).allowed, true);
});

test('production environment accepts independent secrets and HTTPS SMTP configuration', () => {
  assert.deepEqual(checkProductionEnv(validEnv()), []);
});

test('production preflight rejects placeholders, HTTP and local email catchers', () => {
  const env = validEnv();
  Object.assign(env, { JWT_SECRET: 'replace_with_random_64_hex_characters',
    SETTINGS_KEY: 'replace_with_random_64_hex_characters', APP_URL: 'http://example.com', SMTP_HOST: 'mailpit' });
  const errors = checkProductionEnv(env);
  assert.ok(errors.some(x => x.includes('JWT_SECRET')));
  assert.ok(errors.some(x => x.includes('SETTINGS_KEY')));
  assert.ok(errors.some(x => x.includes('APP_URL')));
  assert.ok(errors.some(x => x.includes('SMTP_HOST')));
});

test('production preflight rejects invalid port and MySQL URL-breaking password', () => {
  const env = { ...validEnv(), SMTP_PORT: '0', MYSQL_PASSWORD: 'bad@password' };
  const errors = checkProductionEnv(env);
  assert.ok(errors.some(x => x.includes('SMTP_PORT')));
  assert.ok(errors.some(x => x.includes('MYSQL_PASSWORD')));
});
