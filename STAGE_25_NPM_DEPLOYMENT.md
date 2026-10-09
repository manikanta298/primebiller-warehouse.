# Stage 25 — Native npm deployment (Docker retained for future use)

This revision is **npm-first**. It preserves every React screen, Express endpoint, JWT/SMTP feature, MySQL SQL script/migration, and existing `compose.yaml`/Dockerfiles. It does **not** need Docker or Nginx to run the web application. It **does** require a running MySQL 8 database and npm packages downloaded on the deployment machine.

## Requirements

- **Node.js 22** and npm 10+ (same major runtime used for the existing native tests).
- **MySQL 8.0+ / 8.4** running separately, locally or hosted; npm does **not** install or launch a MySQL database.
- Internet access to the npm registry / `cdn.sheetjs.com` for the first package installation. The repository's frontend contains a package from `@lovable.dev`; ensure it is accessible from your npm environment.
- A real SMTP account if reset-password and invitation emails must be delivered.

## First installation (without Docker)

From the extracted project root:

```bash
node --version                     # use v22.x
npm install                        # React + Vite/TanStack dependencies (root)
npm run install:backend            # locked Express/MySQL dependencies (backend)
cp .env.npm.example .env.npm       # separate from Docker's .env
```

Edit `.env.npm`: add a real `DATABASE_URL`, two **different** 64-character hex values for `JWT_SECRET` and `SETTINGS_KEY`, SMTP settings if required, and correct `APP_URL`/`CORS_ORIGINS`. Generate each key with `openssl rand -hex 32` (or a secure equivalent). For MySQL on your own computer, keep `DB_SSL=false`; use trusted CA and `DB_SSL=true` for managed database connections that require encryption. URL-encode reserved characters in the database password. `.env.npm` is ignored by Git and should never be shared.

Create the `girder` MySQL database and an appropriate user if they do not yet exist (with the credentials in `DATABASE_URL`). Then:

```bash
npm run db:migrate               # applies backend/db/schema.sql (create-if-missing tables)
# For existing databases apply migrations in backend/db/migrations/ as needed.
# Fill the SETUP_* fields in .env.npm only for a brand-new empty organisation:
npm run setup:owner             # one time only; then remove SETUP_OWNER_PASSWORD
npm run build:all               # builds React Node SSR and TypeScript Express API
npm run start                   # OR npm start
```

Open **http://localhost:8080/login** by default. Use `GET http://localhost:8080/health` to verify the API/MySQL health. Stopping the npm command stops both child servers and the gateway. `npm server run` is **not** an npm command; use `npm run start` or `npm start`.

When changing code or npm dependencies, rebuild with `npm run build:all` then restart the app. Do not use the old `npm run dev` for real-MySQL deployment: it is the frontend-only development server, and without `VITE_API_URL` the app uses mock data.

## How it works

`npm run start` launches three local Node processes under one supervisor:

1. Express API at **127.0.0.1:4000** (`backend/dist/index.js`), connected to the MySQL URL.
2. React/TanStack Start SSR at **127.0.0.1:3000** (`.output/server/index.mjs`).
3. Built-in HTTP gateway at **127.0.0.1:8080** forwarding `/api/v1/*` and `/health` to Express, everything else to React.

The browser connects to only port 8080. The gateway replaces untrusted incoming forwarding-IP headers, protecting the Express authentication limiter's single-hop assumption. For intranet access you can change `WEB_HOST=0.0.0.0` and use firewall rules. **For internet-facing production, put an HTTPS termination proxy/load balancer in front** (and review client-IP trust, TLS, CSP and origin policies before launch). The Node gateway does not provide TLS or the additional Nginx IP-rate-limit zone from the Docker configuration.

Configuration file: `.env.npm` (not `.env`). The Docker setup remains at `compose.yaml`, `frontend.Dockerfile`, `backend/Dockerfile`, and `docker/nginx.conf` and uses `.env` separately. Use Docker in the future with its original commands and environment.

## Validations completed / not completed here

- `npm run test:conversion`: 255 native rule/regression tests, including 4 new npm deployment tests, pass.
- The npm proxy integration tests use actual local HTTP servers and verify API routing, frontend routing, health, header sanitisation and unavailable services.
- `npm run audit:deployment` preserves the Docker security audit and passes; no Docker configuration was changed.
- Syntax checks pass for the new JavaScript tooling; the backend host change remains Docker-compatible by default.
- **Not executed here:** `npm install` from registry, the frontend `npm run build:all`, live MySQL and SMTP, and full browser testing. The npm registry was unreachable here; dependencies for a full build were not available. Install and execute on the deployment host before using the app with real records.

## Troubleshooting

- **Missing compiled files**: run `npm run build:all` after installing both sets of dependencies.
- **Port in use**: change `WEB_PORT`, `API_PORT`, or `FRONTEND_PORT` in `.env.npm` and keep all three unique; update `APP_URL` accordingly.
- **API health returns 503**: check MySQL service, `DATABASE_URL`, account permissions, and `DB_SSL` settings.
- **Unable to log in**: configure the first Owner with `npm run setup:owner` on a new database and ensure `VITE_API_URL` compiled to `/api/v1` (the `build:frontend` command enforces this).
- **No recovery email**: SMTP requires a working provider and correctly configured `SMTP_*` entries; `SMTP_HOST` left blank means no mail delivery.
