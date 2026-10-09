import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { limitAuthRequests } from '../backend/src/rate-limit.ts';

function send(middleware, ip, socketAddress = '172.21.0.8') {
  let nextCalls = 0;
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(name, value) { headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  middleware({ ip, socket: { remoteAddress: socketAddress } }, res, () => { nextCalls++; });
  return { nextCalls, statusCode: res.statusCode, body: res.body, headers };
}

test('backend auth limiter isolates real clients sharing one gateway socket', () => {
  const limiter = limitAuthRequests(2, 60_000);
  assert.equal(send(limiter, '198.51.100.10').nextCalls, 1);
  assert.equal(send(limiter, '198.51.100.10').nextCalls, 1);
  const throttled = send(limiter, '198.51.100.10');
  assert.equal(throttled.statusCode, 429);
  assert.ok(Number(throttled.headers['Retry-After']) > 0);
  assert.equal(send(limiter, '198.51.100.11').nextCalls, 1, 'different client must not share nginx container quota');
});

test('backend auth limiter still uses socket IP for direct connections', () => {
  const limiter = limitAuthRequests(1, 60_000);
  assert.equal(send(limiter, undefined, '127.0.0.1').nextCalls, 1);
  assert.equal(send(limiter, undefined, '127.0.0.1').statusCode, 429);
  assert.equal(send(limiter, undefined, '127.0.0.2').nextCalls, 1);
});

test('backend trusts precisely one edge hop and nginx replaces untrusted forwarded IP', () => {
  const app = readFileSync(new URL('../backend/src/app.ts', import.meta.url), 'utf8');
  const nginx = readFileSync(new URL('../docker/nginx.conf', import.meta.url), 'utf8');
  assert.match(app, /app\.set\(['"]trust proxy['"],\s*1\)/);
  assert.match(nginx, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.doesNotMatch(nginx, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
});
