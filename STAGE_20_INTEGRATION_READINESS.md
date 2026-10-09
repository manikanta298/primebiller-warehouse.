# Stage 20 — System Integration & Production Readiness

**Status: release candidate for operator-led integration testing; NOT production-certified.**

This stage retains the approved Stages 1–19 UI, Express routes, MySQL DDL/migrations, JWT and SMTP recovery. It does not claim pixel parity or a running production system. Production testing requires a host with Docker and a reachable MySQL 8.4 instance, real SMTP credentials, valid company data and browsers/printers.

## What changed

- Express now enforces per-IP fixed-window limits for sign-in (15/15 minutes), forgot-password (5/15 minutes), password reset (10/15 minutes) and invite acceptance (10/15 minutes). `Retry-After` and HTTP 429 are returned on excess requests. Keys are based on the socket address, not untrusted forwarding headers; state is worker-local and is defense in depth, not a distributed limiter.
- The provided Nginx gateway enforces another per-client-IP rate limit on `/api/v1/auth/` (20/minute with burst 10, HTTP 429) so workers are not the only protection. **If deploying multiple gateways, use shared edge/WAF rate limiting as well.**
- `scripts/production-preflight.mjs` checks that the deployment `.env` has two independent 32-byte hex keys, URL-safe strong MySQL passwords, an HTTPS public URL, a non-test SMTP host, TLS/STARTTLS and mail credentials. This is static validation; it cannot prove key entropy, external TLS configuration, or email delivery.
- `scripts/http-smoke.mjs` checks a **running** gateway: GET `/health` returns 200 (DB connectivity), GET `/login` returns 200 and unauthenticated GET `/api/v1/items` returns 401. It requires no account credentials and does not post business documents.
- `scripts/backup-mysql.sh` takes a consistent compressed MySQL dump through `docker compose exec`, verifies gzip integrity, saves with restrictive permissions and only publishes a completed file. Encrypt and securely store backups offsite. A backup is not a verified restore.
- Tests added for limiter isolation/expiry/capacity, production env validation, smoke checker contracts, backup-script integrity and Nginx throttling configuration.

## Local developer verification

```bash
npm run test:conversion
# Separate optional focused tests:
npm run test:release-security
# Syntax / dependency-aware build when packages are installed:
cd backend && npm ci && npm run typecheck && npm run build
cd ..
# Frontend build uses Bun for Docker; install dependencies before local builds.
```

## Required steps on an actual deployment machine

1. Confirm the original application and this build use the same registered organisation / warehouse data, then take a full, encrypted backup of the current database. Do not restore test data over production records.
2. Copy `.env.example` to `.env`. Generate **different** `JWT_SECRET` and `SETTINGS_KEY` values with `openssl rand -hex 32`. Use URL-safe unique passwords for MySQL and set real SMTP credentials and `APP_URL=https://your-domain`.
3. Run `node scripts/production-preflight.mjs .env`. Fix every error; do not use the example `.env` in production.
4. Provision HTTPS outside the supplied HTTP-only Compose gateway, configure firewall, backup storage and appropriate DNS. Ensure that gateway trust, forward headers and real-IP rate limiting are correctly configured by the infrastructure operator.
5. Run `docker compose config` and `docker compose up -d --build`; inspect `docker compose ps` and the backend logs. On an existing database, inspect/backup before upgrading and reconcile any legacy duplicate GRN supplier invoices before treating the uniqueness registry as complete.
6. Run `node scripts/http-smoke.mjs http://localhost:8080` (or substitute the reachable gateway). These checks should all pass; an inaccessible gateway is a failure, not a skip.
7. Run `./scripts/backup-mysql.sh ./backups`, copy the output into encrypted offsite storage, and **restore it to a disposable MySQL instance** to verify integrity. Do not restore into the live app as a test.
8. Test real SMTP password recovery to an owned mailbox, expiry/single-use token, sign-in after reset, JWT revocation on role change, wrong-org API access, Owner preservation, and rate-limit HTTP 429 responses.
9. In an isolated test organisation, run end-to-end database transactions: purchase order → GRN → batch stock → sales order → challan/transfer → invoice → receipt/advance → stock ledger → GST review report; cancel/reverse where allowed and reconcile stock and balances. Also test two concurrent GRNs with the same supplier invoice and competing dispatches for the same batch.
10. Perform browser comparisons screen-by-screen against the original app at desktop/mobile sizes, check key forms' keyboard behavior and field-level validation, run A4 and 80 mm physical printing, and verify legal/GST return outputs with a qualified reviewer.

## Launch-blocking gaps not resolved by this stage

- Live Docker/MySQL execution, parallel/concurrent database tests, production dependency installation, full TypeScript typechecking, frontend build, and browser end-to-end/pixel-accurate comparisons have **not** been demonstrated in this environment.
- Application currently relies on JWT held in browser session storage; review XSS and token-handling risks as part of the security assessment. Rate limiting is per gateway/worker and not a distributed defense.
- The supplied Compose gateway is HTTP; a maintained **HTTPS/TLS-terminating reverse proxy** is required for any public deployment. Production backup encryption, retention policy and recovery exercises are operator responsibilities.
- GSTR-1 export is a reconciliation draft, **not** a verified GST Portal upload. Live IRN/e-invoicing and GSP e-way bills, financial-year-close posting enforcement across every route, bank reconciliation, statutory credit notes, and journal accounting remain incomplete.
- Logo/QR uploads, printer-device calibration and automatic invitation email delivery remain incomplete or unverified.

**Approval scope:** approve this release-candidate hardening and operator checklist, not production launch. Stop here before undertaking any further screens or expanding statutory integrations.
