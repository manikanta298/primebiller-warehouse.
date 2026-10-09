import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const parse = (path) => JSON.parse(read(path));

test('npm frontend lockfile is committed and aligned with the frontend manifest', () => {
  const manifest = parse('frontend/package.json');
  const lock = parse('frontend/package-lock.json');
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages[''].name, manifest.name);
  for (const section of ['dependencies', 'devDependencies']) {
    assert.deepEqual(lock.packages[''][section], manifest[section]);
  }
  assert.ok(Object.keys(lock.packages).length > 500);
  assert.match(read('frontend/.npmrc'), /legacy-peer-deps=true/);
});

test('Vercel targets only TanStack Start and Nitro, not the private Express API', () => {
  const config = parse('frontend/vercel.json');
  const manifest = parse('frontend/package.json');
  assert.equal(config.framework, 'tanstack-start');
  assert.match(config.buildCommand, /build:vercel/);
  assert.match(config.installCommand, /npm ci/);
  assert.doesNotMatch(config.buildCommand, /backend|build:all/);
  assert.match(manifest.scripts['build:vercel'], /build-vercel/);
  assert.match(read('frontend/scripts/build-vercel.mjs'), /NITRO_PRESET: 'vercel'/);
  assert.match(manifest.scripts['build:frontend'], /npm-build-frontend/);
});

test('CI uses separate frontend and backend installs and runs tests before building', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /frontend:/);
  assert.match(ci, /backend:/);
  assert.match(ci, /run: npm ci --no-audit --no-fund/g);
  assert.match(ci, /run: npm run test:conversion/);
  assert.match(ci, /working-directory: frontend/);
  assert.match(ci, /run: npm run build:vercel/);
  assert.match(ci, /working-directory: backend/);
  assert.match(ci, /run: npm run build/);
});
