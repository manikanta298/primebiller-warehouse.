/** Run backend SQL setup and owner setup with npm-mode secrets from .env.npm. */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNpmConfig } from './npm-runtime.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const task = process.argv[2];
if (!['db:migrate', 'setup:owner'].includes(task)) throw new Error('Invalid npm backend task');
let config;
try { config = loadNpmConfig(root); }
catch (error) { console.error(error.message); process.exit(1); }
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', task], {
  cwd: resolve(root, 'backend'), env: config.backendEnv, stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
