# Stage 21 — Deployment Validation Toolkit

**Status: offline deployment checks passed. Live deployment not validated. NOT approved for production launch.**

This stage follows approval of the Stage 20 release candidate and preserves all existing screens, business APIs, SQL tables/migrations, JWT/SMTP and Docker architecture. This runtime lacks Docker, a MySQL service, access to the required npm package hosts, production SMTP, and an original-app browser session. No live credentials were supplied. Accordingly, no live stack, financial posting, cross-module database transaction, SMTP delivery, or pixel-level browser comparison has been asserted.

## Changes to the release package

1. **Backend lockfile portability:** Replaced 144 private Lovable npm mirror tarball locations in `backend/package-lock.json` with equivalent `https://registry.npmjs.org/` tarball URLs. Versions and SHA-512 integrity digests are unchanged. The explicit SheetJS tarball remains at `https://cdn.sheetjs.com/`; an operator must verify access and licensing as appropriate. The lockfile is pinned for reproducible `npm ci` on a host with outbound network access. **No download was possible here, so an actual npm install or Docker image build has not passed.**
2. **Offline package audit:** `npm run audit:deployment` checks required project/container/SQL files, lockfile consistency, permitted public HTTPS tarball sources with integrity hashes, essential Compose services, GRN registry DDL and Nginx routes. It is a static audit, *not* a running deployment test.
3. **Authenticated read-only smoke:** `npm run smoke:authenticated -- https://your-host` reads `SMOKE_TOKEN` and `SMOKE_ORG_ID` from environment variables, then verifies a JSON array of items, parties and godowns, plus a dashboard object. Only GET requests are made; read failures, access errors and unexpected JSON shapes fail the test. The token and response bodies are never printed. Use a dedicated short-lived Owner/Manager account, one disposable test organisation, and revoke access afterwards.
4. **Six offline tests:** `tests/deployment-validation.test.mjs` asserts the audit catches private registries and broken Compose references, and runs the authenticated smoke against mocked HTTP responses, covering tenant headers, read-only requests, failure handling and HTTPS-only remote URLs.

## Local verification completed

- `node --experimental-strip-types --test tests/*.test.mjs`: **225/225 passed**, including all previously delivered Stages 2–20 tests and six new Stage 21 tests.
- `node scripts/package-audit.mjs`: passed.
- `bash -n scripts/backup-mysql.sh`: passed syntax check.
- Python YAML parser: all five Compose services found (`mysql`, `backend`, `frontend`, `gateway`, `mailpit`). **This is not `docker compose config`.**
- `node scripts/production-preflight.mjs .env.example`: **expected failure** (sample credentials are not suitable for production).
- `node scripts/authenticated-smoke.mjs http://localhost:8080` without the required variables: **expected safe rejection**. Live authenticated GETs were **not** run.
- Backend `npm run typecheck`: **blocked** by missing `@types/node` and incomplete dependencies. `npm ci` could not reach npm/SheetJS hosts (DNS `EAI_AGAIN`). Frontend `bun install` / `bun build` and live Docker containers were not available.

## Run on a Docker-enabled validation host

Use a non-production environment with safe sample business data. Back up existing data and do not reuse real customer credentials.

```bash
cp .env.example .env
# Fill secrets / production-appropriate SMTP and APP_URL, then:
node scripts/production-preflight.mjs .env
node scripts/package-audit.mjs
cd backend && npm ci && npm run typecheck && npm run build && cd ..
docker compose config
docker compose up -d --build
docker compose ps
node scripts/http-smoke.mjs http://localhost:8080
```

For a **local-only, HTTP development installation**, preflight intentionally rejects non-HTTPS APP_URL; set development values for smoke testing separately and use an HTTPS edge with real credentials for production preflight. Do not expose local Mailpit or MySQL to the public internet.

Next, while an authorised disposable organisation is selected, securely provide `SMOKE_TOKEN` and `SMOKE_ORG_ID` in the validation host's process environment (not in source files). Run:

```bash
node scripts/authenticated-smoke.mjs http://localhost:8080
./scripts/backup-mysql.sh ./backups
```

Ensure a test restore succeeds in an isolated database before considering the backup verified. Afterward conduct these **manual, still-unverified** write transactions with an isolated test organisation: owner login and recovery email, create supplier/customer/item/batch, purchase order → GRN → stock ledger, sales order → stock reservation → challan → invoice → receipt → receivables/GSTR-1 review, cancelled transactions and stock transfers/adjustments. Concurrently post competing batch dispatches and duplicate supplier invoice GRNs. Confirm transaction rollback, cross-organisation access denial, numbering uniqueness, financial totals, print templates and mail delivery. Capture browser screenshots at the original application's sizes and compare screen by screen.

## Production launch blockers

Live Docker/MySQL, installed-dependency builds/full typechecking, real SMTP, original-app browser pixel parity and financial transaction concurrency tests remain unverified. Frontend/SSR runtime, SQL data migrations and external SheetJS tarball availability must be checked on the target host. Original Stage 20 statutory and operational limitations (GSTR-1 draft only, GSP/IRN integration, fiscal-close rules, printer calibration, bank reconciliations, etc.) still apply. **This stage approves the validation toolkit only, not a production deployment.**
