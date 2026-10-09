/** Force a Node Nitro output and same-origin API for the npm deployment build. */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vite = resolve(root, 'node_modules/vite/bin/vite.js');
const result = spawnSync(process.execPath, [vite, 'build'], {
  cwd: root,
  env: { ...process.env, NITRO_PRESET: 'node-server', VITE_API_URL: '/api/v1' },
  stdio: 'inherit',
});
if (result.error) console.error(`Frontend build failed: ${result.error.message}`);
process.exit(result.status ?? 1);
