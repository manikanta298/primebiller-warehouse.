import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createNpmGateway } from '../scripts/npm-gateway.mjs';
import { loadNpmConfig } from '../scripts/npm-runtime.mjs';

const good = {
  DATABASE_URL: 'mysql://girder:secure@127.0.0.1:3306/girder',
  JWT_SECRET: 'a'.repeat(64),
  SETTINGS_KEY: 'b'.repeat(64),
};
const tempRoot = () => mkdtempSync(join(tmpdir(), 'girder-npm-test-'));
function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function stop(server) { return new Promise((resolve) => server.close(resolve)); }

// Keeps npm configuration independent from Docker's .env.
test('npm deployment loads .env.npm and binds the backend to loopback', () => {
  const root = tempRoot();
  try {
    writeFileSync(join(root, '.env.npm'), `DATABASE_URL=${good.DATABASE_URL}\nJWT_SECRET=${good.JWT_SECRET}\nSETTINGS_KEY=${good.SETTINGS_KEY}\nWEB_PORT=8181\n`);
    const config = loadNpmConfig(root, {});
    assert.equal(config.webPort, 8181);
    assert.equal(config.backendEnv.API_HOST, '127.0.0.1');
    assert.equal(config.frontendEnv.HOST, '127.0.0.1');
    assert.equal(config.frontendEnv.NITRO_PRESET, 'node-server');
    assert.equal(config.backendEnv.CORS_ORIGINS, 'http://localhost:8181');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('explicit environment overrides .env.npm and invalid inputs fail before startup', () => {
  const root = tempRoot();
  try {
    writeFileSync(join(root, '.env.npm'), `DATABASE_URL=${good.DATABASE_URL}\nJWT_SECRET=${good.JWT_SECRET}\nSETTINGS_KEY=${good.SETTINGS_KEY}\nWEB_PORT=8181\n`);
    assert.equal(loadNpmConfig(root, { WEB_PORT: '8282' }).webPort, 8282);
    assert.throws(() => loadNpmConfig(root, { API_HOST: '0.0.0.0' }), /loopback-only/);
    assert.throws(() => loadNpmConfig(root, { API_PORT: '8181', WEB_PORT: '8181' }), /must be different/);
    assert.throws(() => loadNpmConfig(root, { JWT_SECRET: 'bad' }), /64 hexadecimal/);
    assert.throws(() => loadNpmConfig(root, { SETTINGS_KEY: good.JWT_SECRET }), /independent/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('local npm gateway routes API/health and frontend and discards spoofed forwarding headers', async () => {
  const api = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ route: 'api', path: req.url, forwarded: req.headers['x-forwarded-for'], real: req.headers['x-real-ip'], user: req.headers['x-org-id'] }));
  });
  const frontend = http.createServer((req, res) => res.end(`frontend:${req.url}`));
  const apiPort = await listen(api);
  const frontendPort = await listen(frontend);
  const gateway = createNpmGateway({ apiPort, frontendPort });
  const webPort = await listen(gateway);
  try {
    const url = `http://127.0.0.1:${webPort}`;
    const response = await fetch(`${url}/api/v1/items?a=1`, { headers: {
      'X-Forwarded-For': '8.8.8.8', 'X-Real-IP': '9.9.9.9', 'X-Org-Id': 'org_A',
    }});
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.route, 'api');
    assert.equal(data.path, '/api/v1/items?a=1');
    assert.equal(data.user, 'org_A');
    assert.equal(data.forwarded, '127.0.0.1');
    assert.equal(data.real, '127.0.0.1');
    assert.match(await (await fetch(`${url}/login`)).text(), /frontend:\/login/);
    assert.equal((await (await fetch(`${url}/health`)).json()).route, 'api');
  } finally { await stop(gateway); await stop(api); await stop(frontend); }
});

test('npm gateway returns 502 when its private upstream is absent', async () => {
  const closed = http.createServer();
  const upstreamPort = await listen(closed);
  await stop(closed);
  const gateway = createNpmGateway({ apiPort: upstreamPort, frontendPort: upstreamPort });
  const webPort = await listen(gateway);
  try {
    const res = await fetch(`http://127.0.0.1:${webPort}/api/v1/items`);
    assert.equal(res.status, 502);
    assert.match(await res.text(), /service unavailable/);
  } finally { await stop(gateway); }
});
