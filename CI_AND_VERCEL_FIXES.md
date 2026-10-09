# CI & Vercel diagnostics and repair (based on the Stage 26 source)

## What is confirmed vs not confirmed

This repair is based on the **Stage 26 ZIP**, not a clone of the GitHub PR. GitHub and npm registry DNS access were unavailable in the authoring environment, so the failing PR run logs and Vercel build logs **could not be read**. Do not interpret these changes or passing offline tests as proof the original reported jobs are fixed. Compare this patch with the PR before merging.

### Source-level faults addressed

1. The Stage 26 root had `bun.lock` but no npm `package-lock.json`. GitHub/Vercel jobs calling `npm ci` fail without an npm lockfile. This release adds an npm v3 lockfile derived from the versions/integrity checksums recorded in `bun.lock`, plus `.npmrc` to preserve the graph's existing optional-peer behavior. Verify it with a fresh online `npm ci` on your machine before merging. `npm ci --offline --dry-run` passes here, **actual downloads were not tested**.
2. Vercel should build **only the React/TanStack Start frontend**; the Node gateway + long-lived Express/MySQL server require a separately hosted Node process. `vercel.json` explicitly selects TanStack Start, `npm ci`, and `npm run build:vercel`, which runs Vite with `NITRO_PRESET=vercel`. It does **not** use `build:all` or `npm run start` on Vercel.
3. Separate GitHub Actions jobs independently install/test/build frontend and install/compile backend. A failing job should now clearly identify the tier. If the repository already contains other workflows, inspect them too; this workflow will not automatically replace their failing checks.

## Vercel settings

- **Root directory**: repository root (contains `package.json` and `vercel.json`).
- **Framework preset**: TanStack Start.
- **Node version**: 22.x, aligned with CI / local npm deployment.
- **Install command**: `npm ci --no-audit --no-fund`.
- **Build command**: `npm run build:vercel`.
- **Output directory**: leave automatic. Nitro Vercel preset handles functions and assets.
- Set **`VITE_API_URL`** to the **public HTTPS address of your independently hosted Express API**, including `/api/v1` (example `https://api.example.com/api/v1`). `VITE_` values are publicly visible; never put secrets in them.
- On the API host, set `CORS_ORIGINS` to the exact Vercel frontend URL(s), and set MySQL/JWT/SMTP secrets **only on that API host**. Do not put `DATABASE_URL` or `JWT_SECRET` in Vercel's frontend variables.
- **Do not** point `VITE_API_URL` to `localhost`, a Docker service name, or a private MySQL host. If unset, the frontend uses local **demo/mock mode**, which is not the connected business application.

**Vercel deploys the frontend only.** If you want one host for both services, use the existing npm deployment (`npm run build:all` then `npm start`) on a Node machine, with a separate MySQL instance. The existing Docker configuration is unchanged.

## Local validation on a network-enabled machine

```sh
node --version                  # use Node 22
npm ci
npm run test:conversion
npm run build:vercel
cd backend
npm ci
npm run build
cd ..
```

Also test `npm run build:all` to validate npm/self-hosted mode. If npm decides the converted lockfile needs metadata normalization, run `npm install --package-lock-only` online on Node 22/npm 10, inspect the diff, and commit the resulting lockfile.

## Diagnose anything still failing

- GitHub → Pull requests → your PR → **Checks** → **Details** on the failed `Frontend` and `Backend` jobs. Copy the first actual `npm ERR!`, `TSxxxx`, `vite`, or `nitro` error and the commands that ran.
- Vercel → Project → Deployments → failed preview → **Build Logs**, including the first error and Framework Preset/Root Directory.
- Provide the **PR URL** and those three log excerpts. Without them I cannot attribute the current failures to particular lines or certify green deployment.
