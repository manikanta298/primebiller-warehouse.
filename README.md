# Girder — React + Express + Node.js + MySQL

This is an incremental migration of the uploaded Girder inventory and GST app. The upload already used React/TanStack Start in the frontend, Express/Node.js in the backend, and MySQL plus JWT for authentication. Those working foundations were preserved so that screens can be reviewed one at a time rather than replaced wholesale.

**Stage 1 implemented:** the original Sign in screen, with password recovery and password reset states. The login layout, colours, labels, responsive structure, and organisation picker remain the same as the source. The tiny Forgot password link and reset form are additions.

**Stage 2 approved:** the `/dashboard` screen now uses organisation- and godown-scoped API metrics, India business-day dates, role-aware actions and empty states while retaining the original card and panel layout. Other content screens remain unchanged. See [STAGE_2_DASHBOARD.md](STAGE_2_DASHBOARD.md).

**Stage 3 approved:** the `/items` list retains the original KPI strips and table, adds functional searching, filters, sort, pagination and CSV export, and fixes demo-mode organisation isolation. See [STAGE_3_ITEMS_LIST.md](STAGE_3_ITEMS_LIST.md).

**Stage 4 approved:** `/items/:id` retains the source item detail tabs and adds safe editable item masters, GST, units, godown thresholds and read-only batches. The API rejects direct quantity/batch edits and cross-organisation godown settings. See [STAGE_4_ITEM_DETAILS_EDIT.md](STAGE_4_ITEM_DETAILS_EDIT.md).

**Stage 5 approved:** `/masters` retains its four original tabs, tables and add/edit dialogs, with searchable/filterable lists, shared validation, organisation-isolated data, cycle-safe category trees and immutable historical HSN rates. See [STAGE_5_MASTERS.md](STAGE_5_MASTERS.md).

## Repository layout

```
frontend/   React + TanStack Start app (src, public, tests, vite/ts config, Dockerfile, vercel.json)
backend/    Express + MySQL API (src, db, scripts, Dockerfile)
scripts/    Deployment, smoke-test and ops scripts (npm gateway, preflight, sync-shared)
tests/      Deployment/ops tests (frontend rule tests live in frontend/tests)
docker/     Nginx gateway config;  compose.yaml wires mysql + backend + frontend + gateway
```

Each side has its own `package.json` and lockfile. Root `npm run ...` scripts orchestrate both
(`install:all`, `build:all`, `start`, `test`, `sync:shared`). After editing a shared rule in
`frontend/src/lib`, run `npm run sync:shared` to refresh `backend/src/shared`.
**Vercel:** set the project's *Root Directory* to `frontend`.


## Preferred quick start (npm — no Docker required)

Use **Node.js 22**, **npm 10+**, and an existing MySQL 8 database. From the project root:

```bash
npm install
npm run install:all
cp .env.npm.example .env.npm
# Set DATABASE_URL, unique JWT_SECRET/SETTINGS_KEY, APP_URL and SMTP in .env.npm.
# Start MySQL separately and create the girder database.
npm run db:migrate
# For a brand-new installation, fill SETUP_* in .env.npm and run npm run setup:owner once.
npm run build:all
npm run start
```

Open `http://localhost:8080/login`. **`npm run start` or `npm start`** is the supported start command (`npm server run` is not a valid npm command). The npm gateway serves React and Express on one origin while MySQL runs separately. See **[STAGE_25_NPM_DEPLOYMENT.md](STAGE_25_NPM_DEPLOYMENT.md)** for configuration, SSL, real SMTP, production warnings and checks. Docker files stay intact for future use.

## Optional quick start (Docker, retained for future use)

```sh
cp .env.example .env
# Edit .env and supply strong unique secrets and database passwords.
# Generate JWT_SECRET and SETTINGS_KEY separately with: openssl rand -hex 32
docker compose up -d --build
```

- Frontend: http://localhost:8080/login
- API health: http://localhost:8080/health
- Local SMTP inbox: http://localhost:8025
- SQL schema: `backend/db/schema.sql` (all tables), `backend/db/migrations/001_password_reset.sql` (upgrade for existing installations)
- Tests: `npm run test:frontend` (Node.js 22), or separate Stage scripts including `npm run test:parties`.
- Full setup, first Owner account instructions, limits and checkpoint: [CONVERSION_STATUS.md](CONVERSION_STATUS.md)

The gateway proxies `/api/v1` to Express and the remaining routes to the React/TanStack Start server. Both applications have their own Dockerfiles (`frontend/Dockerfile`, `backend/Dockerfile`), and MySQL data is persisted in a named Docker volume. No real emails are sent to customers in the default local environment: Mailpit catches reset emails.

For hosting, supply verified SMTP credentials, HTTPS, a real `APP_URL`, secure secrets, and database backups. The existing mock frontend mode remains available for development *outside Docker* when `VITE_API_URL` is not set.

## Stage 6 — Godowns / Warehouses (approved)

The `/warehouses` screen now supports org-scoped warehouse search and status filtering, a read-only per-item stock drill-down, and validated create/edit. Warehouse deactivation is blocked for any on-hand or held stock. Default-for-sales changes are serialised in MySQL. See `STAGE_6_WAREHOUSES.md`. Run `npm run test:godowns` for the Stage 6 warehouse tests.

## Stage 7 — Parties / Customers & Suppliers (approved)

`/parties` retains its original list with type, blocked-state and search filters. `/parties/:id` validates GSTIN/PAN/state, contact and credit/payment terms; shows read-only receivables/payables and enforces role permissions. Demo parties are organisation-isolated. The Express API forbids editing outstanding balances, foreign records or party IDs and uses the existing MySQL schema; no Stage 7 migration required. See [STAGE_7_PARTIES.md](STAGE_7_PARTIES.md). `npm run test:frontend` covers **48 tests** across Stages 2–7.

## Stage 8 — Sales Orders (approved)

`/sales-orders` and `/sales-orders/:id` retain their original list/editor layouts, with organisation-scoped list search/pagination, IST dates, validated line-entry, real-time GST/credit calculations, blocked customer/inactive master checks, atomic stock holds and cancellation/release rules. Repeated item lines are aggregated before free-stock validation. The server validates editable fields and rejects cross-organisation or forged records. `npm run test:sales-orders` runs the 10 new pure-rule tests; `npm run test:frontend` runs all **58** stage regression tests. No Stage 8 SQL migration is necessary; see [STAGE_8_SALES_ORDERS.md](STAGE_8_SALES_ORDERS.md).

## Stage 9 — Delivery Challans (approved)

The `/challans` list preserves its status chips and nine columns, adding search, paging and organisation/driver scope. The existing five-step dispatch wizard and detail/POD screen share strict stock and batch validations with the Express API. FIFO suggestions allocate across all selected lines, including repeated items. Test EWB numbers are explicitly labelled **not government-issued**; no GSP integration is included. 12 new tests bring the Stage 2–9 native rule suite to **70/70**. The Docker/MySQL schema and previous stages are included unchanged. See [STAGE_9_DELIVERY_CHALLANS.md](STAGE_9_DELIVERY_CHALLANS.md) for details.

## Stage 10 — Tax Invoices (approved)

`/invoices`, `/invoices/new`, and `/invoices/:id` retain the eight-column invoice list, challan conversion, original tax summary and linked-document panels. This stage adds invoice search and pagination, organisation isolation, server-backed issue validation, organisation-specific CGST/SGST/IGST preview, India business-date validation, browser A4 printing, and reason-logged cancellation of current-month unpaid invoices with atomic restoration of advances and receivables. A cancelled invoice number is never reused. No new SQL migration is needed. **83/83 native regression tests pass** (`npm run test:frontend`). See [STAGE_10_TAX_INVOICES.md](STAGE_10_TAX_INVOICES.md) for review and production limitations. Live IRN/e-invoicing, credit notes, accounting journals, MySQL/Docker integration and pixel-perfect browser comparison are not verified or implemented as noted.

## Stage 11 — Receipts & Advances (approved)

`/receipts` and `/receipts/new` retain the original receipt/advance layout. This stage adds organisation-safe receipt and advance lists, search and pagination, Indian business-date and currency validation, exact-paise oldest-first or manual allocation, noncash reference checks, duplicate/missing invoice protection and role-gated posting. Express validates and posts receivables, receipt numbers, invoice payments, sales-order links, and unused advances in a single MySQL transaction; demo mode shares the same rules and tenant boundaries. No new SQL migration is necessary; the existing Docker, JWT and SMTP setup is included. **96/96 native rule tests pass** (`npm run test:frontend`). See [STAGE_11_RECEIPTS_ADVANCES.md](STAGE_11_RECEIPTS_ADVANCES.md) for review steps and production limitations. Live MySQL/Docker end-to-end execution, browser pixel-perfect comparisons, bank reconciliation and cheque-clearance workflows remain outside this approval build.

## Stage 12 — Purchase Orders (approved)

The `/purchases` list retains the original PO/GRN tabs and seven PO columns, with organisation-aware search, status filters and 25-row pagination. `/purchases/new` has an India-date default, active supplier and godown selection, strict line quantities/prices and live CGST/SGST/IGST calculations. Owner/Manager can raise an approved/open order or save a draft, later approve it at `/purchases/:id`, or cancel an unreceived order with an audit reason. The Express API and mock share validation and organisation isolation; linked GRNs cannot receive draft, cancelled or fully received orders and cannot over-receive duplicate PO line submissions. MySQL DDL and Docker/JWT/SMTP infrastructure are unchanged. **109/109 native tests pass** (`npm run test:frontend`), including 13 new PO tests. See [STAGE_12_PURCHASE_ORDERS.md](STAGE_12_PURCHASE_ORDERS.md). Live Docker/MySQL and pixel-perfect browser verification remain outstanding.

## Stage 13 — Goods Receipts (GRN) (approved)

The original GRN list, posting form, and immutable receipt detail are retained at `/purchases?tab=grn`, `/purchases/grn/new` and `/purchases/grn/:id`. Shared frontend/Express rules now validate dates, supplier and warehouse eligibility, item/batch data, quantities, landed freight, supplier invoice uniqueness, and cumulative linked-PO receipts before inventory posting. Accepted quantities affect item/batch stock, inventory valuation, ledger and supplier payables; rejected quantities remain only on the receipt and count toward inspected PO quantity. The list adds direct/linked filtering, and the form adds unsaved-change, role and loading/error safeguards. A new MySQL `grn_invoice_registry` with a unique primary key protects against simultaneous duplicate supplier invoices; deploy `backend/db/migrations/002_grn_invoice_registry.sql` or rerun `npm run db:migrate` before starting the API on an existing database. **123/123 native tests pass**; see [STAGE_13_GOODS_RECEIPTS.md](STAGE_13_GOODS_RECEIPTS.md). Live Docker/MySQL, browser end-to-end, installed-dependency typechecking and pixel-perfect parity remain unverified.

## Stage 14 — Stock Transfers (approved)

`/transfers`, `/transfers/new`, and `/transfers/:id` retain the original table/form/detail layouts. New organisation-safe search, paging and date defaults accompany shared frontend/Express business rules that aggregate repeated item/batch quantities, check active warehouses and reserved/free inventory, validate exact receiving quantities/shortage reasons, and protect dispatch/receipt/cancellation under one MySQL transaction with row locking and stock-ledger audit. The demo layer now isolates transfers by organisation and reconciles the seeded in-transit example. Existing MySQL schema and migrations plus Docker/JWT/SMTP infrastructure remain intact; no migration is required. **138/138 native regression tests pass** (`npm run test:frontend`, with 15 new Stage 14 tests). See [STAGE_14_STOCK_TRANSFERS.md](STAGE_14_STOCK_TRANSFERS.md) for review steps and the outstanding live/visual verification.

## Stage 15 — Stock Adjustments (ready for review)

`/adjustments`, `/adjustments/new` and `/adjustments/:id` retain the original table/form/detail layouts. Added organisation-scoped search and pagination, live India business-date defaults, active warehouse/item choices, stock-free-after-reservations display, unsaved/discard controls, and role-aware approval actions. Shared frontend/Express rules prevent aggregate reductions over item or batch stock, reject invalid quantities, costs, dates, unknown batches and inaccessible records, and recheck current inventory before approving a pending adjustment. MySQL transaction, ledger, Docker/JWT/SMTP and earlier schema/migrations are retained. **154/154 native regression tests pass** (16 new Stage 15 rule tests). Read [STAGE_15_STOCK_ADJUSTMENTS.md](STAGE_15_STOCK_ADJUSTMENTS.md) for manual checks and live test limitations.

## Stage 16 — Stock Ledger & Alerts (ready for review)

`/stock-ledger` preserves the existing ledger layout, filters item/warehouse/batch/type/doc/date, derives actual balances from all physical movements, and includes 25-row pagination and CSV export (filtered and protected from spreadsheet formulas). The `GET /api/v1/stock/ledger` endpoint reads up to 5,000 org-scoped matching movements and returns a clear error on larger queries rather than returning a misleading partial ledger. `/alerts` retains the original inventory alert tabs, adds search and godown filtering, enforces tenant-scoped acknowledgement and role checks, and links permitted users to new purchase orders and stock transfers. No new MySQL migration is required. **168/168 native rule tests pass** (`npm run test:frontend`, 14 new Stage 16 tests). Review [STAGE_16_STOCK_LEDGER_ALERTS.md](STAGE_16_STOCK_LEDGER_ALERTS.md) for use and production verification limits. Installed-dependency compilation, live Docker/MySQL and browser pixel-parity remain unverified.

## Stage 17 — Reports & GSTR-1 (ready for approval)

`/reports` preserves the original GSTR-1, sales-register, receivables-ageing and item-sales/margin tabs. It now defaults to the current India business month, validates API reporting periods, scopes query caches and demo item costs to the selected organisation, paginates visible tables and exports complete CSV data with spreadsheet-injection protection. GSTR-1 calculates August 2024 B2CL threshold rules and separates HSN B2B/B2C rows (required from May 2025); multi-rate B2CL draft JSON records are grouped by invoice. **IMPORTANT:** the available GSTR-1 JSON is a reconciliation draft, **not a verified GST Portal upload file**. Credit notes, all statutory sections, official Offline Utility validation and filing are not implemented. The existing Docker/MySQL/JWT/SMTP infrastructure and prior migrations are included; no migration needed. **183/183 rule tests pass**, with 15 new Stage 17 cases (`npm run test:reports`). See [STAGE_17_REPORTS_GSTR1.md](STAGE_17_REPORTS_GSTR1.md). Live deployment and visual parity remain unverified.

## Stage 18 — Print Profiles & Document Printing (ready for review)

`/print-profiles` retains profile A (80 mm gate passes) and profile B (A4 invoices) and now validates all configurable fields, scopes preview and saved settings to the selected organisation, and shows an unmistakable illustrative preview. The invoice and challan detail print buttons now use the saved profile and real document values with print-only sheets, copy numbering, HSN breakdown, configured bank and footer, cancellation/test-document warnings, and CSS print paper hints. The Express route verifies profile identity/permissions and uses existing MySQL JSON. QR and logo image generation have **not** been implemented (only a basic text initials mark); the UI explains these limitations instead of faking official codes. No migration is required. **193/193 regression tests pass** (10 new print tests); shared print code passed isolated typechecking. Live Docker/MySQL, full installed-dependency build and print-device/browser rendering are not yet verified. See [STAGE_18_PRINT_PROFILES.md](STAGE_18_PRINT_PROFILES.md) for manual review and limitations. Stop for approval after this stage.

## Stage 19 — Users, Roles & Application Settings

This stage retains the Users & roles, Numbering and Settings pages. Administrators can search and filter users, change scoped roles and godown permissions, manage numbering before the first issued document, and validate organisation/GST/bank/reason-code settings. Changing a role or deactivating an account invalidates its JWT. New account invite links are returned to the Owner for manual secure sharing (they are **not** sent by SMTP). Existing MySQL schemas and prior Docker setup remain compatible: no new migration is needed. The `STAGE_19_USERS_ROLES_SETTINGS.md` guide documents review steps, safeguards, and production limitations.


## Stage 20 — Integration readiness (pending live sign-off)

The Stage 20 handoff provides a deployment preflight, backend/auth rate limiting, gateway smoke tests,
backup procedure and manual cross-module verification checklist. Run the no-dependency checks first:

```bash
npm run test:conversion
npm run verify:production-env   # requires real production .env (sample intentionally fails)
```

With Docker on a deployment machine, after configuring secrets and an HTTPS front proxy:

```bash
docker compose config
docker compose up -d --build
npm run smoke:gateway                # expects http://localhost:8080 by default
./scripts/backup-mysql.sh ./backups  # after MySQL is healthy
```

This is an **integration-readiness release candidate**, not proof of production readiness. Here Docker,
MySQL, full installed-dependency builds, physical printing and browser pixel comparisons remain unverified.
See [STAGE_20_INTEGRATION_READINESS.md](STAGE_20_INTEGRATION_READINESS.md) for validation and launch gates.

## Stage 21 — Deployment validation toolkit (ready for review)

The Stage 20 release candidate now includes a public-registry backend lockfile (144 tarball links updated without changing versions/integrity hashes), a repeatable offline deployment audit (`npm run audit:deployment`), and a read-only JWT/organisation-scoped HTTP probe (`npm run smoke:authenticated -- http://localhost:8080` with `SMOKE_TOKEN` and `SMOKE_ORG_ID` set securely). **225/225** native regression and deployment validation tests pass. These are **offline checks**: Docker/MySQL, `npm ci`, frontend/backend builds, real SMTP and browser parity are not verified in this runtime. See [STAGE_21_DEPLOYMENT_VALIDATION.md](STAGE_21_DEPLOYMENT_VALIDATION.md) for deployment host commands and blocking live checks; do not launch in production on the strength of these checks alone.

## Stage 22 — Two-organisation access verification

The new read-only command `npm run smoke:tenant -- https://your-test-gateway.example` checks 12 protected API requests with two **exclusive test-organisation accounts**, including own-organisation reads and negative cross-organisation access. Set `SMOKE_A_TOKEN`, `SMOKE_A_ORG_ID`, `SMOKE_B_TOKEN`, and `SMOKE_B_ORG_ID` securely on the validation host; do not store JWTs in source or print results containing tokens. Full setup and acceptance criteria are in `STAGE_22_TENANT_INTEGRATION.md`. The script has only been tested against mocked HTTP responses here; live Docker/MySQL, browser parity, and write-path isolation remain unverified.


## Stage 23 — Cross-module live acceptance toolkit (approval required)

Stage 23 adds a **read-only cross-module reconciliation** (`npm run smoke:workflow -- https://your-test-gateway.example`) and an **isolated MySQL temporary-table rollback probe** (`npm run smoke:mysql-rollback`). It also adds an organisation-scoped, permission-checked `GET /api/v1/receipts/:id` endpoint used by reconciliation. Configure six known linked test document IDs and one disposable test organisation; for rollback, use a separately named MySQL test database and explicit opt-in. See [`STAGE_23_LIVE_ACCEPTANCE.md`](STAGE_23_LIVE_ACCEPTANCE.md) for exact environment variables and safe instructions. **No live server, MySQL, SMTP, browser screenshot, or business posting has been tested in this runtime; do not treat it as a production approval.**

## Stage 24 — Authentication gateway acceptance hardening

The previous per-worker auth limiter used the shared gateway container socket IP, allowing one user to exhaust the login quota for all users behind Nginx. Stage 24 fixes client-IP resolution with a single trusted private proxy hop, gateway-overwritten forwarding headers and regressions to prevent reintroduction. `npm run test:frontend` now runs **251** passing tests and `npm run audit:deployment` rejects a publicly exposed backend or unsafe forwarding configuration. **Do not expose the backend service directly** or assume that this one-hop setup works unchanged behind a separate CDN/load balancer; trusted upstream real-IP setup is required there. No screen or schema changes. See [`STAGE_24_PROXY_SECURITY.md`](STAGE_24_PROXY_SECURITY.md). Full Docker/MySQL/browser/SMTP acceptance has not been run and production sign-off is still blocked.

## Stage 26 — Per-warehouse inventory dashboards (npm-first)

Open **Warehouses → Dashboard & stock**. All organisation products appear in each warehouse's catalogue (zero quantity until physically posted), with audited +/− stock adjustments, reservation and batch safeguards, and separate 30-day incoming/outgoing movement dashboards. Stock already decreases at **delivery challan dispatch** for the selected warehouse; the linked tax invoice never deducts it a second time. Direct POS invoices without challans are not included. Full behavior and testing instructions: `STAGE_26_WAREHOUSE_MANAGEMENT.md`. Continue using `npm run start`; Docker files are unchanged.

## CI and Vercel frontend deployment (Stage 27)

See [`CI_AND_VERCEL_FIXES.md`](CI_AND_VERCEL_FIXES.md) for the separated frontend/backend CI, committed root npm lockfile, Vercel Nitro build and required public API configuration. This is a **source-level repair candidate**, not a verified green GitHub/Vercel run. Local npm-and-MySQL deployment and Docker support remain available.
