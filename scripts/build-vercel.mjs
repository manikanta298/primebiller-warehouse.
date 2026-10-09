/** Vercel builds the TanStack Start web tier only; Express/MySQL run on a separate Node host. */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vitePath = resolve(root, 'node_modules/vite/bin/vite.js');
const result = spawnSync(process.execPath, [vitePath, 'build'], {
  cwd: root,
  env: { ...process.env, NITRO_PRESET: 'vercel' },
  stdio: 'inherit',
});
if (result.error) console.error('Vercel frontend build failed:', result.error.message);
process.exit(result.status ?? 1);
