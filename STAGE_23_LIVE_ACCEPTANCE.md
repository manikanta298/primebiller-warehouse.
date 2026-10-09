# Stage 23 — Cross-module live acceptance handoff

**Approval scope: offline acceptance tooling and a receipt-detail GET endpoint. Production launch is NOT approved.** The previous Stage 22 project, original screen layouts, React/Express/MySQL architecture, JWT/SMTP, Docker and migrations remain intact.

## New code and intent

- `scripts/workflow-acceptance-smoke.mjs` / `npm run smoke:workflow` issues exactly **6 GETs** for a deliberately selected set of linked, already-posted test documents and verifies **7 reconciliation invariants** (13 results). It never creates/edits/deletes transactions, prints tokens, or writes response data. It is *not* a substitute for actual test postings or complete accounting reconciliation.
- `GET /api/v1/receipts/:id` is now implemented in `backend/src/routes/sales.ts`. It requires the `recordReceipt` permission and uses `Uow.doc('receipts', id)` which restricts access to the authenticated organisation. The specific `/receipts/advances` route is registered before the new parameter route.
- `scripts/mysql-rollback-smoke.mjs` / `npm run smoke:mysql-rollback` tests transactional rollback and unique-key behavior using an **InnoDB TEMPORARY table**, destroying no persistent records. It requires a MySQL database explicitly named as test, acceptance or staging, plus an acknowledgement variable. The probe does **not** test actual GRN/invoice postings, simultaneous users, isolation level, or crash durability.
- Fifteen additional offline tests verify the probes, read-only scope and receipt-route guard. The complete automated native test suite reaches **247/247** (when run in this package).
- The deployment audit requires the new scripts. No new MySQL schema migration is required.

## Prerequisites on a live *isolated test* deployment

1. Install all pinned dependencies and complete backend/frontend builds and full dependency-aware typechecks. Boot Docker Compose, apply SQL migrations and verify health/backup-restore; follow `STAGE_21_DEPLOYMENT_VALIDATION.md`.
2. Use **a disposable, populated test organisation** and a dedicated Owner/Manager or an authorised user who can read sales orders, purchases, GRNs, challans, invoices and receipts. Create a test supplier, customer, warehouse and item; post one PO and linked GRN, then a SO, challan, invoice and receipt. Record their *internal IDs*, not printed numbers. The selected invoice must be non-cancelled, and the receipt must allocate a positive amount to it. Partial receipts and payments are fine.
3. Safely set each required environment variable on the test server without adding secrets to `.env` or source control. Never test against a production database with live personal data.

### Run the read-only workflow probe

```bash
# Enter the JWT without echo or command-line arguments.
read -rs -p 'Disposable test JWT: ' ACCEPTANCE_TOKEN; echo
export ACCEPTANCE_TOKEN
# Set using *internal document IDs* for the SAME organisation:
export ACCEPTANCE_ORG_ID='your-isolated-org-id'
export ACCEPTANCE_PO_ID='po-internal-id'
export ACCEPTANCE_GRN_ID='grn-internal-id'
export ACCEPTANCE_SO_ID='sales-order-internal-id'
export ACCEPTANCE_CHALLAN_ID='challan-internal-id'
export ACCEPTANCE_INVOICE_ID='invoice-internal-id'
export ACCEPTANCE_RECEIPT_ID='receipt-internal-id'
npm run smoke:workflow -- https://test-gateway.example
# Then clear secrets and test IDs.
unset ACCEPTANCE_TOKEN ACCEPTANCE_ORG_ID ACCEPTANCE_PO_ID ACCEPTANCE_GRN_ID \
  ACCEPTANCE_SO_ID ACCEPTANCE_CHALLAN_ID ACCEPTANCE_INVOICE_ID ACCEPTANCE_RECEIPT_ID
```

**Pass:** six authenticated reads plus seven reconciliation checks display `PASS` and exit code 0. A mismatch means investigate test fixture or business data. This does not independently verify every item/batch/stock-ledger posting or financial period. The gateway origin is HTTPS-only remotely, with HTTP allowed only on localhost; redirects fail.

### Run the isolated MySQL rollback probe

Use an **isolated MySQL database with `test`, `acceptance`, or `staging` in its name**, reachable from a host where `backend/node_modules/mysql2` has been installed. This command creates/drops an InnoDB TEMPORARY table in its own connection, inserts only disposable test markers and explicitly rolls back. It does not modify any permanent business row.

```bash
read -rs -p 'MySQL test DB URL (mysql://.../girder_acceptance): ' ACCEPTANCE_DATABASE_URL; echo
export ACCEPTANCE_DATABASE_URL
export ACCEPTANCE_DB_CONFIRM=YES_ISOLATED_TEST_DB
npm run smoke:mysql-rollback
unset ACCEPTANCE_DATABASE_URL ACCEPTANCE_DB_CONFIRM
```

**Pass:** two `PASS` results and exit code 0. Failures in database connection, unique constraints or rollback block acceptance. A temporary-table test cannot prove application-level transaction atomicity.

## Live acceptance matrix (no rows completed in this environment)

| Gate | Acceptance evidence required | Current status |
|---|---|---|
| Docker and dependencies | `npm ci`/build/typecheck logs, `docker compose ps`, all health probes healthy | **NOT RUN** |
| MySQL setup & migrations | 8.4 startup log, idempotent migrations, successful backup + restore into separate DB | **NOT RUN** |
| Tenant isolation | Stage 22 twelve GETs against two exclusive test orgs + write-path negative tests | **NOT RUN** |
| Purchase → inventory | Create/approve PO, partially receive GRN, reconcile batch/stock ledger, costs, supplier payable and rejected items | **NOT RUN** |
| Sales → payment | Create/confirm SO, check held stock, dispatch, deliver, issue invoice, receive payment/advance, reconcile receivable and GST totals | **NOT RUN** |
| Concurrency & atomicity | Race duplicate supplier invoice GRNs and competing dispatches; confirm one success, no double stock, one immutable document, no partial writes | **NOT RUN** |
| Reversal & fiscal controls | Cancellation/reversal consistency; numbering and fiscal-close behavior against business policy | **NOT RUN** |
| Email and JWT | Real SMTP reset link, expiry/single use, login throttling, logout/role revocation | **NOT RUN** |
| Browser parity | Original vs React screenshots at equal viewports for every original route/form including errors, empty states, print A4/80 mm | **NOT RUN** |
| Regulatory and external | IRN/e-way/GSP live integration, official GST utility validation, QR/printing and bank reconciliation as needed | **NOT IMPLEMENTED/NOT VERIFIED** |

### Screen-by-screen visual acceptance starting matrix

Capture both original and converted screens at identical viewport sizes (for example 1440×900 desktop and 390×844 mobile), seed identical test records, and record pass/fail plus screenshot paths. Include sign-in/password reset; dashboard; items list/detail/edit/import; masters; warehouses; parties list/detail/edit; sales orders list/new/detail; challans list/wizard/detail; invoices list/new/detail; receipts list/new; purchase orders list/new/detail; GRNs list/new/detail; transfers list/new/detail; adjustments list/new/detail; stock ledger; alerts; reports; print profiles and print output; users, numbering and settings. **No pixel-perfect comparison has been performed here.**

## Offline execution evidence for this stage

- Node 22 test suite: **247/247 passing** (15 new tests) including Stage 22 and prior rule suites.
- Modified TypeScript route parses with `node --experimental-strip-types --check`; new Node `.mjs` scripts pass syntax checks.
- `node scripts/package-audit.mjs` passed, and YAML parser accepts all five Compose services (not a live Compose execution).
- The sample environment continues to fail production preflight deliberately.
- Docker CLI, MySQL service, full installed frontend/backend dependencies, test JWTs, test database URL and an original app browser comparison were **not available in this environment**. No authenticated GET or database transaction was actually run against live services.

## Approval and follow-up

Stage 23 approval covers **only acceptance-code readiness**. Before launching, an operator must execute the live gates, capture logs/screenshots and resolve any differences. Repeat the acceptance matrix on the final release hash. Do not equate mocked tests, static syntax checks, and YAML parsing with end-to-end or production certification.
