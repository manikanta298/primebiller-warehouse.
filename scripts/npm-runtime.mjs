/** Configuration for the optional npm-only deployment. Docker retains its own env. */
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';

export function loadNpmConfig(root, provided = process.env) {
  const file = resolve(root, '.env.npm');
  const disk = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  // Explicit shell/process environment takes precedence over .env.npm.
  const env = { ...disk, ...provided };
  const errors = [];
  const port = (key, defaultValue) => {
    const value = env[key] || String(defaultValue);
    const n = Number(value);
    if (!/^\d+$/.test(value) || !Number.isInteger(n) || n < 1 || n > 65535) {
      errors.push(`${key} must be a TCP port (1-65535)`);
    }
    return n;
  };
  const webPort = port('WEB_PORT', 8080);
  const apiPort = port('API_PORT', 4000);
  const frontendPort = port('FRONTEND_PORT', 3000);
  if (new Set([webPort, apiPort, frontendPort]).size !== 3) errors.push('WEB_PORT, API_PORT and FRONTEND_PORT must be different');
  for (const name of ['DATABASE_URL', 'JWT_SECRET', 'SETTINGS_KEY']) {
    if (!env[name]) errors.push(`${name} must be configured in .env.npm or the process environment`);
  }
  if (env.JWT_SECRET && !/^[a-f0-9]{64}$/i.test(env.JWT_SECRET)) errors.push('JWT_SECRET must be 64 hexadecimal characters');
  if (env.SETTINGS_KEY && !/^[a-f0-9]{64}$/i.test(env.SETTINGS_KEY)) errors.push('SETTINGS_KEY must be 64 hexadecimal characters');
  if (env.JWT_SECRET && env.JWT_SECRET === env.SETTINGS_KEY) errors.push('Use independent JWT_SECRET and SETTINGS_KEY values');
  if (env.DATABASE_URL && /CHANGE_THIS|replace_with/i.test(env.DATABASE_URL)) {
    errors.push('DATABASE_URL contains a placeholder password');
  }
  if (env.DATABASE_URL) {
    try {
      const url = new URL(env.DATABASE_URL);
      if (url.protocol !== 'mysql:' || !url.hostname || !url.pathname || url.pathname === '/') throw new Error();
    } catch { errors.push('DATABASE_URL must be a valid mysql://user:password@host:port/database URL'); }
  }
  if (env.API_HOST && !['127.0.0.1', '::1', 'localhost'].includes(env.API_HOST)) {
    errors.push('API_HOST must be loopback-only in npm mode; the gateway is the sole public entrypoint');
  }
  if (env.WEB_HOST && env.WEB_HOST !== '127.0.0.1' && env.WEB_HOST !== '0.0.0.0' && env.WEB_HOST !== '::1') {
    errors.push('WEB_HOST must be 127.0.0.1, ::1 or 0.0.0.0');
  }
  if (errors.length) throw new Error(`npm deployment configuration invalid:\n - ${errors.join('\n - ')}\nCopy .env.npm.example to .env.npm and edit it.`);
  return {
    webPort, apiPort, frontendPort,
    webHost: env.WEB_HOST || '127.0.0.1',
    backendEnv: {
      ...env,
      NODE_ENV: 'production',
      PORT: String(apiPort),
      API_HOST: '127.0.0.1',
      APP_URL: env.APP_URL || `http://localhost:${webPort}`,
      CORS_ORIGINS: env.CORS_ORIGINS || (env.APP_URL || `http://localhost:${webPort}`),
    },
    frontendEnv: {
      ...env,
      NODE_ENV: 'production',
      PORT: String(frontendPort),
      HOST: '127.0.0.1',
      NITRO_PRESET: 'node-server',
    },
  };
}
