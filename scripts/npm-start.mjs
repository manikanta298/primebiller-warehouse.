/** Start both compiled Node apps and the local Node gateway (no Docker required). */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNpmConfig } from './npm-runtime.mjs';
import { createNpmGateway } from './npm-gateway.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let config;
try { config = loadNpmConfig(root); }
catch (error) { console.error(error.message); process.exit(1); }
for (const path of ['.output/server/index.mjs', 'backend/dist/index.js']) {
  if (!existsSync(resolve(root, path))) {
    console.error(`Missing ${path}. Install packages and run: npm run build:all`);
    process.exit(1);
  }
}
const children = [];
let closing = false;
let gateway;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  gateway?.close();
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  process.exitCode = code;
}
function run(label, script, cwd, env) {
  const child = spawn(process.execPath, [script], { cwd, env, stdio: 'inherit' });
  children.push(child);
  child.on('error', (err) => { console.error(`${label} failed: ${err.message}`); shutdown(1); });
  child.on('exit', (code, signal) => {
    if (!closing) { console.error(`${label} exited (${signal || code}). Stopping remaining services.`); shutdown(1); }
  });
}
run('Express API', resolve(root, 'backend/dist/index.js'), resolve(root, 'backend'), config.backendEnv);
run('React server', resolve(root, '.output/server/index.mjs'), root, config.frontendEnv);
gateway = createNpmGateway({ apiPort: config.apiPort, frontendPort: config.frontendPort });
gateway.on('error', (err) => { console.error(`Gateway failed: ${err.message}`); shutdown(1); });
gateway.listen(config.webPort, config.webHost, () => {
  console.log(`Girder npm gateway: http://${config.webHost}:${config.webPort} (API and React under one origin)`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));
