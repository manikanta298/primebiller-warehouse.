# Stage 22 — Two-organisation live-read validation

**Status: offline validation toolkit implemented and tested. No live deployment or actual tenant data was tested. NOT approved for production launch.**

The Stage 21 source remains intact. This stage adds a **read-only, two-account tenant isolation smoke** to support production acceptance on a separate Docker-enabled validation host. It does **not** replace browser, real DB/SMTP, mutation/isolation, or accounting tests.

## What changed

- Added `scripts/tenant-isolation-smoke.mjs` and `npm run smoke:tenant`.
- Added seven self-contained mocked-HTTP unit tests in `tests/tenant-isolation-smoke.test.mjs`.
- Extended the offline package audit to require the new probe.
- Kept the entire Stage 21 React, Node/Express, MySQL, Docker, JWT/SMTP project, original layouts, and existing transaction code.

## Coverage of the probe (12 GETs, zero mutations)

Use **two different temporary users**, A and B, each entitled to **only their own, distinct test organisation** and granted sufficient Owner/Manager-level read permissions. Each user must not have membership in the other test organisation. Run against a gateway with known-good test data, never with personal credentials.

1. A and B can each GET their **own** items, invoices and goods receipts (6 reads; HTTP 200 and JSON array required).
2. A may **not** switch `X-Org-Id` to B and B may **not** switch to A (2 reads; HTTP 403 required).
3. A may **not** request B's `/orgs/B/godowns` even while sending A's valid header; vice versa (2 reads; HTTP 403 required).
4. A missing JWT and a clearly invalid JWT must both receive HTTP 401 (2 reads).

The probe only accepts remote HTTPS or HTTP loopback, refuses URL credentials, requires distinct identities, disables redirects, imposes an 8-second timeout per request, and reports only pass/fail labels and HTTP statuses. No bearer tokens, business records or response bodies are printed or saved.

## Safe execution on a live test deployment

First follow `STAGE_21_DEPLOYMENT_VALIDATION.md` for `npm ci`, TypeScript checks, `docker compose config`, `docker compose up -d --build`, `node scripts/http-smoke.mjs`, a test restore, and authenticated single-organisation smoke. If any step fails, **do not continue toward production launch**.

Enter test credentials without putting JWTs on the command line or in `.env` or shell history, for example in bash:

```bash
read -r -s -p 'A temporary test JWT: ' SMOKE_A_TOKEN; echo
export SMOKE_A_TOKEN
read -r -p 'A exclusive test org ID: ' SMOKE_A_ORG_ID
export SMOKE_A_ORG_ID
read -r -s -p 'B temporary test JWT: ' SMOKE_B_TOKEN; echo
export SMOKE_B_TOKEN
read -r -p 'B exclusive test org ID: ' SMOKE_B_ORG_ID
export SMOKE_B_ORG_ID
npm run smoke:tenant -- https://your-test-gateway.example
unset SMOKE_A_TOKEN SMOKE_A_ORG_ID SMOKE_B_TOKEN SMOKE_B_ORG_ID
```

**Pass criterion:** all **12** lines say `PASS` and process exit code is 0. Any unexpected 200 on a cross-org case, 401 on an own-org case, HTTP redirect, malformed response, or network error is a failure. Confirm A and B are exclusive memberships before interpreting the negative cases; a legitimately shared user is unsuitable for this test. Revoke both JWTs and tear down the temporary accounts after validation.

## Additional production acceptance requirements (NOT completed here)

- Frontend/build: install dependencies from the pinned lockfiles, run full TypeScript/lint/build, and compare every original and converted screen/form in a browser at the same viewport size.
- Database/integrations: run on MySQL 8.4 using migrations applied to an isolated copy, test backup/restore and concurrent financial/inventory postings with rollback assertions.
- Access controls: repeat cross-tenant attempts for **write** methods and for ID-based document details, using an isolated database and a test matrix of all six roles; check warehouse permissions.
- Finance/GST: manually reconcile PO → GRN → stock, SO → dispatch → invoice → receipt, cancellations/reversals, export totals, and statutory integration limitations.
- External services: verify JWT revocation/password reset email via real SMTP, HTTPS/TLS, ingress header handling, GSP/IRN where required, and print devices.

## Execution record

- Docker CLI: unavailable in this runtime; no actual container launch performed.
- MySQL CLI/service: unavailable; no real database writes/concurrent tests performed.
- Frontend dependencies and Bun: unavailable; no built/browser screenshot results.
- Backend dependencies: partial; `npm run typecheck` could not resolve `@types/node` despite a directory name in `node_modules`; no complete backend build.
- No real test JWTs, test organisation IDs, public gateway URL, SMTP credentials, or live server access were supplied.

**Stage 22 is a test-tooling handoff only, not evidence of live tenant isolation or production readiness.**
