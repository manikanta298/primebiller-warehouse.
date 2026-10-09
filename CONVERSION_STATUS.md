# Girder conversion — incremental delivery

**The supplied source already included React, Node.js/Express, MySQL schema, and JWT auth.** This stage deliberately retains existing screens and business rules; MySQL replaces MongoDB in the requested "MERN-style" stack.

## Stage 1 — Sign in / account recovery (approved to proceed)

- React `/login`: retained the original desktop branding column, sign-in form, demo-only hints, and organisation picker. Added a small "Forgot password?" link and matching recovery/reset form states in the *same* screen.
- Express `/api/v1/auth/login`: retains JWT auth and organisation-specific roles.
- Express `POST /api/v1/auth/forgot-password`: anonymous, normalised email, non-enumerating response, max three recovery messages per account per 15 minutes, SHA-256 hash of one-time 32-byte random token in MySQL, 60-minute expiry, sends reset URL by SMTP.
- Express `POST /api/v1/auth/reset-password`: validates a single-use reset token, bcrypt-hashes new password, marks recovery tokens spent and increments `users.token_version` to revoke previously issued JWTs.
- MySQL DDL for the full original application is in `backend/db/schema.sql`; separate upgrade script `backend/db/migrations/001_password_reset.sql` adds recovery to an existing MySQL installation.
- `compose.yaml` starts MySQL 8.4, Express API, React server, Nginx gateway and a local Mailpit test inbox. Frontend and API have separate Dockerfiles.

## Start the stack

1. `cp .env.example .env`, then generate unique secrets (`openssl rand -hex 32` for each of JWT_SECRET and SETTINGS_KEY) and replace the sample database passwords. Keep MySQL password URL-safe or percent-encode it in DATABASE_URL.
2. `docker compose up --build -d`
3. Open `http://localhost:8080/login`. Check `http://localhost:8080/api/v1/auth/login` with a POST request. Development recovery emails arrive in Mailpit at `http://localhost:8025`.
4. Create your first owner **once**, after setting `SETUP_ORG_NAME`, `SETUP_ORG_GSTIN` (valid GSTIN), `SETUP_OWNER_NAME`, `SETUP_OWNER_EMAIL`, `SETUP_OWNER_PASSWORD` (min 8 chars) via `docker compose run --rm -e SETUP_ORG_NAME=... -e SETUP_ORG_GSTIN=... -e SETUP_OWNER_NAME=... -e SETUP_OWNER_EMAIL=... -e SETUP_OWNER_PASSWORD=... backend npm run setup:owner`. Avoid leaving the owner password in files or terminal history.

Database schema is automatically applied on initial MySQL volume creation and idempotently at backend startup. Existing app data is not replaced. Keep the named `mysql_data` volume when updating.

For a real deployment, change SMTP_SECURITY to `starttls` (587) or `tls` (465) with a provider, set a verified sender address, set APP_URL to your HTTPS origin, and front the gateway with TLS. The local Mailpit plaintext SMTP transport is **only** for the local test setup. Do not expose port 8025 or the database publicly.

## Stage 2 — Dashboard (approved)

- Original dashboard layout retained: six KPI cards, stock value by godown, sales pipeline, high-value movements, and needs-attention lists.
- Dashboard REST endpoint now scopes metrics to the selected organisation and godown and validates the selection; India-local today and seven-day ledger windows are calculated against stored UTC timestamps.
- React renders scoped data, loading/error/zero-data states, and role-safe action links. The new query cache key separates organisations.
- Mock mode mirrors the actual dashboard rule calculations and explicitly uses its fixed 8 October 2026 demo fixture date.
- Test suite: `npm run test:dashboard`; see `STAGE_2_DASHBOARD.md` for review steps and verification limits.

## Stage 3 — Items List (approved)

- Preserved original list architecture: Masters heading, four KPI strips, search box and seven stock, tax and price table columns.
- Added working category, stock-condition and active-state filters; deterministic sort choices; 25-row pagination; CSV export (formula-safe), and role-protected Import items link.
- The summary cards reflect the full active catalogue for the selected organisation/godown; filtering changes the visible rows, not KPI totals. Free stock subtracts held reservations.
- The real MySQL endpoint already enforces organisation scoping; demo item records now track organisation ownership, including freshly imported items. Query cache and filter states reset appropriately across organisation changes.
- Shared pure UI rules generated into the backend and tested with `npm run test:items`. The complete Docker and MySQL setup from previous stages is unchanged, with no additional migration needed.
- See `STAGE_3_ITEMS_LIST.md` for test coverage, manual QA steps, and limitations.

## Stage 4 — Item Details and Edit Forms (approved)

- Updated `/items/:id` retaining all five original detail tabs, heading and inventory KPIs. Adds editable/validated prices, HSN/GST, unit conversion rows, per-godown thresholds, active/batch controls, live India-date batch ageing, unsaved-change handling and role-safe navigation.
- Backend PATCH accepts **only** master fields and thresholds; rejects stock quantities and batches, validates organisation-specific godowns, unique SKU, zero-stock deactivation, unit/tracking invariants and previous stock-ledger movements. The demo client mirrors these rules.
- Shared rules and Node tests added. `npm run test:conversion` runs 21 native tests across Stages 2–4. Docker/MySQL schema are unchanged; see `STAGE_4_ITEM_DETAILS_EDIT.md` for review instructions and test limitations.

## Stage 5 — Units, Categories, Brands & HSN Masters (approved)

- The existing `/masters` screen retains its four tab layouts and edit dialogs. Added search/status filtering, keyboard-operable row edits, inline validation, cancel/discard confirmation and correct India-date defaults.
- Shared master rules validate units, GST/HSN codes and effective dates, category parent hierarchy and cycles, and brand names. Published HSN rates require a new dated revision instead of overwriting historical tax rates.
- The Express API and mock service now enforce organisation ownership for reads and writes, prevent foreign parent IDs/cross-org updates and handle immutable HSN fields. MySQL DATE/DECIMAL response values are normalised.
- No SQL schema change or Docker change is needed. 11 new tests bring `npm run test:conversion` to **32** passing tests. See `STAGE_5_MASTERS.md`.

## Stage 6 — Godowns / Warehouses (approved)

- `/warehouses` retains its cards and master-data dialog while adding location search, active/inactive filter, stocked-SKU count, and a read-only per-item stock drill-down with reserved/free quantities and per-item units.
- Shared rules validate names/codes, state/GSTIN consistency, active/default combinations, and safe deactivation; server writes require an org-matching URL and an authorised role. Default-for-sales changes are serialised on the organisation row to keep one selected default. Demo mode mirrors the rules.
- Existing MySQL tables and Docker configuration are reused; no migration needed. `npm run test:conversion` passes **39** tests, with 7 new warehouse tests. See `STAGE_6_WAREHOUSES.md` for review steps and test limitations.

## Stage 7 — Parties / Customers & Suppliers (approved)

- Preserves the six-column `/parties` list and `/parties/:id` form layout. Adds customer/supplier/both/transporter and blocked filters, complete search, live credit display, supplier payment terms and role-safe edit controls.
- Frontend, Express API and demo share GSTIN/PAN/state, contact, credit amount and payment-term validation. Master edits cannot change outstanding balances, other organisations' data or party IDs. MySQL's existing per-org GSTIN unique index is retained; no migration required.
- `npm run test:conversion` passes **48** native tests (nine new party tests). See `STAGE_7_PARTIES.md` for manual QA and verification limits.

## Approval checkpoint

**Stages 1–14 are approved. Stage 15 Stock Adjustments is the current approval build.**

## Stage 8 — Sales Orders (approved)

- Preserved sales-order list and editor layout. Added list search/page controls, org-state GST labels and scoped query caches; editor now selects current India business date, active local godown and organisation-scoped item autocomplete. Save/confirm and cancel actions have shared validation and unsaved/discard warnings.
- Express and mock enforce customer/role/tenant protection, strict editable fields, master-derived HSN/GST, line and date validity, and duplicate-item aggregate stock holds. Confirmation revalidates status and stock under row locks; document numbering and holds commit in one transaction, and confirmed cancellation releases holds.
- `npm run test:conversion`: **58** Node tests passed, 10 new sales-order-rule/ownership tests. The backend shares `sales-order-rules` generated from the frontend. Existing MySQL schema, Docker images and SMTP/JWT features retained without a migration.
- Pending verification: full dependency typecheck, live Docker/MySQL execution, screenshot-by-screenshot pixel comparison, and end-to-end browser/API integration. Refer to `STAGE_8_SALES_ORDERS.md` for the approval checklist.

## Stage 9 — Delivery Challans (approved)

- Preserved `/challans` list, `/challans/new` five-step wizard and `/challans/:id` detail/POD/transport panels. Added search, paging, scoped query caching and stricter permission checks.
- Shared dispatch rules validate aggregate item and batch demand across repeated lines, FIFO suggestions, non-batch/tracked allocations, transport fields and override reasons. MySQL transaction validation and demo mode use the same helpers; driver reads are restricted to assigned challans; mock challans and linked orders are organisation-isolated.
- **EWB limitation:** Government e-way bill integration is not present. Test placeholders are marked `TEST` throughout; do not use them as legal documents. The cancellation window is respected for test records.
- Existing MySQL DDL and Docker setup retained; no migration needed. `npm run test:conversion` has **70/70 passing tests**, including 12 new challan tests. See `STAGE_9_DELIVERY_CHALLANS.md` for detailed limitations, review steps and suggested live QA.

**Historical checkpoint:** Stage 9 approved and Stage 10 Tax Invoices completed.

## Stage 10 — Tax Invoices (approved)

- `/invoices` retains original eight table columns and chips, adding search, pagination, Cancelled status, role-aware issue and organisation-scoped cache.
- `/invoices/new` retains the live tax and advance previews, now based on the selected organisation state and India business date. Shared rules validate delivered and uninvoiced distinct challans, same customer/place of supply, valid invoice dates, and known organisation-owned IDs. Express rechecks before assigning an invoice number.
- `/invoices/:id` retains line and GST details and linked documents, adds A4 browser printing plus audit-reason cancellation for an unpaid invoice dated in the current GST calendar month. Express transaction restores applied advances and receivable balances, unlinks challans, and marks the original invoice/SO link cancelled; no stock moves.
- Read roles and organisation isolation are enforced in the API and mock. Demo reports and invoice search are scoped to the selected organisation. Docker/MySQL/JWT/SMTP setup remains unchanged; no migration required.
- **83/83** native Node rule tests pass, including 13 new invoice cases. Syntax parsing and Docker Compose YAML validated. Dependency-resolving typecheck, live MySQL transaction tests, Docker build, browser screenshot comparisons and production tax/IRN compliance remain unverified.
- **Out of scope:** Government IRN/e-invoicing, full credit notes, signed PDF storage, and accounting journal posting. Paid or prior-period invoices need a separate credit-note process.
- Review `STAGE_10_TAX_INVOICES.md` for the manual approval checklist.

**Historical checkpoint:** Stage 10 approved; Stage 11 Receipts & Advances follows.

## Stage 11 — Receipts & Advances (approved)

- `/receipts` retains the original receipt and advance tabs and columns, adding search, pagination, scoped React Query keys, and separate loading/error/empty states. `/receipts/new` retains customer, date, payment method, reference, automatic/manual allocations and advance summary, with India-date defaults, unsaved-change warnings and strict validation.
- Express and demo share new receipt posting rules: exact paise, positive two-decimal payments, valid nonfuture dates, allocated dates not preceding invoices, payment references, strict invoice ownership, no repeated invoice IDs or overpayments, and customer-role-only counterparties. All changes occur in one MySQL transaction before issuing a durable receipt number.
- The demo layer now tracks receipt and advance organisation ownership for seeded and new records; the real backend requires the authorised role and scopes SQL to the current organisation.
- Full MySQL schema, original password-reset migration, separate React/Express Dockerfiles, JWT and SMTP setup preserved; **no new schema migration**. **96/96 native regression tests pass** (13 new receipt cases). Syntax, Compose YAML and ZIP integrity verified. Live deployment, full dependency typecheck, pixel-level browser comparison, cheque clearance/reconciliation and accounting journals not verified or implemented.
- Review `STAGE_11_RECEIPTS_ADVANCES.md` before approving Stage 12.

**Historical checkpoint:** Stage 11 approved. Stage 12 Purchase Orders follows.

## Stage 12 — Purchase Orders (approved)

- `/purchases` preserves the original seven-column PO list and GRN tab; adds search, status filtering, paging, role-safe actions and organisation-scoped TanStack query caches. `/purchases/new` retains the header, line grid and notes, with date, master-data, quantity/price and duplicate-item checks plus live GST preview. `/purchases/:id` includes draft approval and guarded cancellation with an audit reason.
- Shared PO rules in `src/lib/purchase-rules.ts` and the generated backend copy enforce validity and protect against bad supplier, warehouse, item, pricing or organisational ownership. The Express and demo flows support Save Draft, Approve, Raise (already approved/open) and Cancel only if no GRN has been posted. Linked GRNs validate PO status, supplier/godown and cumulative pending quantities.
- The existing MySQL `purchase_orders`/`doc_counters` schema, JWT/SMTP setup and Docker files are sufficient; no migration required. 13 new rule tests bring `npm run test:conversion` to **109/109 passing**. Ten changed/generated TypeScript/TSX files passed syntax parsing. Full Docker/MySQL, dependency-resolving typecheck and pixel-level browser comparison still require verification.
- See `STAGE_12_PURCHASE_ORDERS.md` for exact review scenarios and limits. **Stop for approval before Stage 13 — Goods Receipts (GRN).**

**Historical checkpoint:** Stage 12 approved; Stage 13 Goods Receipts completed.

## Stage 13 — Goods Receipts / GRN (approved)

- Original GRN list, editor, detail, seven-column GRN list and eight-column receipt detail preserved. Added organisation-safe React Query keys, direct/PO filtering, India-date defaults, supplier eligibility, complete validation/error/loading messages and unsaved/discard controls.
- Added `src/lib/grn-rules.ts` and generated `backend/src/shared/grn-rules.ts` to validate supplier/warehouse, dates, quantities/prices/freight precision, accepted vs rejected quantities, rejection reasons, tracked batches and production/expiry dates, reuse of historical batch metadata, invoice uniqueness and PO status/line ownership/aggregate pending quantities.
- The Express/MySQL transaction keeps stock, weighted-average cost, batch quantities, immutable GRN, stock ledger and supplier payable consistent. A new registry table with a unique key prevents concurrent duplicate supplier invoice posting. `schema.sql` is idempotently upgraded; the optional standalone migration is `002_grn_invoice_registry.sql`.
- **14 new tests** bring native rule checks to **123/123 passing**. TypeScript/TSX syntax parsing, YAML, migration and archive checks accompany the approval package. Real MySQL/Docker, E2E browser tests, full dependency typecheck, and pixel-perfect comparisons are outstanding.
- See `STAGE_13_GOODS_RECEIPTS.md` for review steps. **Stop for approval before Stage 14.**

## Stage 14 — Stock Transfers (approved)

- Retains stock-transfer list, dispatch form, transfer/receipt detail and event history. Adds organisation-scoped search and pagination, safe active warehouse defaults, India business dates, role-aware actions, clearer shortage totals, and properly scoped query caches.
- Shared transfer rules check source/destination eligibility, active item, actual source batch, reserved/free stock, date, precision and **aggregate item and batch demand** across repeated lines. Receiving requires explicit exact per-line quantities and written shortage reasons. Express item/batch row locks, transactional stock posting, one-time cancellation/receipt, and audit-ledger events are retained and hardened.
- Demo transfers are separated by organisation and seeded transit stock, batches and ledger now agree. No new MySQL migration is needed: Stage 13 SQL schema/migrations and existing Docker, JWT/SMTP remain in the updated ZIP.
- **15 new tests bring the conversion regression suite to 138/138**. Syntax, YAML and archive integrity validated; full Docker/MySQL execution, complete dependency typechecking, browser E2E and exact visual comparison are not verified. See `STAGE_14_STOCK_TRANSFERS.md`.

**Historical checkpoint:** Stage 14 approved.

## Stage 15 — Stock Adjustments (approved)

- Preserves the nine-column adjustment list, grid-based new adjustment form and detail/approval history. Adds organisation-aware search/pagination, active godown defaults, current India business date, role-aware creation, free-stock visibility and unsaved/discard controls.
- Shared adjustment rules validate dates, reason/direction, active items/warehouse, quantities and cost precision, existing reduction batches, **aggregate reductions across repeated item/batch lines**, and free stock after reservations. API and mock revalidate current balances before posting an approval.
- Organisation-safe demo records and explicit server authorisation protect list/detail/create/approval. All stock and batch changes, weighted-average costs and stock-ledger movements remain atomic in the existing MySQL transaction. No schema migration needed; Docker/JWT/SMTP retained.
- **16 new Stage 15 tests; 154/154 regression tests pass.** TypeScript/TSX syntax, Docker Compose YAML and ZIP integrity checked. Full Docker/MySQL live transaction tests, full typecheck and screenshot parity still need verification. See `STAGE_15_STOCK_ADJUSTMENTS.md`.

**Historical checkpoint:** Stage 15 approved.

## Stage 16 — Stock Ledger & Alerts (ready for approval)

- Original stock-ledger filter bar, KPI cards and movement table retained. Fixed client and Express stock-stream loading so document/type filters never change the physical running balance. Date-range openings include every earlier movement. Multiscreen item/godown/batch filters, URL state, error and invalid-date handling, 25-row pagination, secure filtered CSV export, accurate balance caveat for mixed units, and estimated valuation label added.
- Express checks item and godown ownership, reads complete matching transaction history sorted by timestamp and ID, and rejects histories over 5,000 entries rather than silently truncating. API and demo enforce inventory-reader role restrictions; Client and backend use matching shared stock rules. The selected godown `all` is no longer interpreted as a nonexistent database godown.
- Alerts retain original four tabs, groups, value-at-risk and acknowledgement controls. Added item/SKU/batch search, selectable godown, organisation-specific React Query keys and demo data, verified active alert IDs before acknowledgement, API role checks, and real role-controlled Create PO/Transfer navigation. Out-of-stock is now detected when free stock is zero even if the reorder threshold is zero.
- **14 new Stage 16 tests; 168/168 conversion regression tests pass.** TS/TSX syntax checks, Compose YAML and ZIP integrity checks accompany handoff. Existing MySQL schema, migrations, Docker, JWT and SMTP stay intact. No new migration required. Full dependency typecheck, Docker/MySQL integration, actual browser end-to-end testing, and pixel-perfect screenshot parity are unverified.
- See `STAGE_16_STOCK_LEDGER_ALERTS.md`. **Stop for approval before Stage 17.**

**Historical checkpoint:** Stage 16 approved; Stage 17 prepared for review.

## Stage 17 — Reports & GSTR-1 (ready for approval)

- Retained the existing four reporting tabs: GSTR-1, sales register, receivables ageing and item sales/margin, and their original headings, KPI cards and table columns. Added current India business-month defaults and table pagination.
- Corrected VAT/GST return draft classification for the August 2024 B2CL threshold, recipient-specific HSN B2B/B2C breakdown, and multi-rate B2CL invoice grouping. JSON is explicitly labelled **review-only, not a GST Portal-ready return** because statutory tables and official validation are not implemented.
- Converted GSTR-1 CSV from an invalid concatenation of section files into a single structured table. Added spreadsheet-formula-safe escaping across report CSV exports.
- Express now validates date range/month; React Query keys and demo item cost are organisation-aware. JWT report permissions and relational/MySQL data scoping remain in place.
- **15 new Stage 17 tests; 183/183 native business-rule and regression tests pass.** Seven changed/generated TS/TSX files passed syntax parsing. Docker Compose YAML and ZIP integrity checked. No new schema migration required.
- Full Docker/MySQL integration, dependency-resolving typecheck, browser end-to-end, visual parity and GSTN Offline Tool upload acceptance remain unverified. See `STAGE_17_REPORTS_GSTR1.md` for review steps and filing limitations.

**Stop for user approval before Stage 18 — Print Profiles & Document Printing.**

## Stage 18 — Print Profiles & Document Printing (ready for approval)

Preserved the two-profile settings screen, added shared front/back print validation and per-organisation demo settings and profiles. The original print buttons on issued invoices and delivery challans now use saved profile preferences, the document's actual monetary values, multiple labelled copies and a print-only A4/80 mm layout. A clear sample preview replaces misleading bank/QR placeholders. QR image and logo upload are not implemented; see STAGE_18_PRINT_PROFILES.md. Existing SQL and Docker retained, no new migration. **193/193 Node rule/regression tests pass**, isolated shared typing and 9 file syntax checks passed. Full installed build, Docker, live MySQL, thermal printer and pixel-perfect rendering remain unverified. Stop and ask for approval before Stage 19.

**Historical checkpoint:** Stage 18 approved; Stage 19 prepared for review.

## Stage 19 — Users, Roles & Application Settings (ready for approval)

- Retained original Users & roles (list + seven-column matrix), Numbering series, and five-tab Settings layouts. Added user search and status/role filters, visible form validation, unsaved-change warning, tenant-specific React Query keys, and explicit manual invite-link instructions. Invites are NOT emailed automatically; the Owner must share the link securely.
- Added shared `admin-rules.ts` validation for user fields, active godowns, one-active-Owner protection, GSTIN/PAN/state consistency, financial-year dates, banking details, thresholds and reason codes; rules synced to Express. The server serialises Owner edits by locking the organisation row, revokes JWTs after role change/deactivation, and prevents organisation admins from modifying a multi-org account's global identity or active status.
- Every numbering type is immutable once issued, even if its current-year counter is zero. The server locks the `doc_series` row during both posting and editing so concurrent writes cannot change a sequence mid-post. Demo users and series are now organisation scoped, with separate demo counters; seeded demo GSTIN checksums corrected.
- GSTIN changes are blocked on organisations with issued invoices, preventing historical documents being rebranded. GSP secrets remain server-side AES-GCM encrypted. No new MySQL migration; existing schema and migrations remain intact.
- **210/210 automated rule/regression tests pass**, including 17 Stage 19 tests. Shared administration/numbering modules passed isolated TypeScript typechecking and modified files passed syntax parsing; Docker Compose parses. **Not yet verified:** full dependency-aware application build, live MySQL/Docker, browser pixel parity, concurrent DB tests and SMTP delivery of invites. Financial-year `closed` flag is persisted but does not yet universally block all posting routes; the UI no longer implies otherwise.
- See `STAGE_19_USERS_ROLES_SETTINGS.md`. **Stop for user approval before a subsequent stage.**


## Stage 20 — System Integration & Production Readiness (ready for approval)

- Added process-local and Nginx gateway IP rate limits to login, password recovery, invitation acceptance and password reset paths. Protected API routing and organisation-aware JWT checks remain intact.
- Added offline production environment preflight (`npm run verify:production-env`) requiring non-placeholder distinct secrets, an HTTPS public URL and real secure SMTP. The local example intentionally fails that production-only check.
- Added gateway health/sign-in/protected-route smoke checks (`npm run smoke:gateway`), a transactional `mysqldump` backup helper and deployment operator instructions. The smoke checks require a running Docker/DB deployment and **were not executed against a live instance here**.
- Expanded the native test suite with release-security and smoke-config checks. Backend/frontend dependency-aware builds and live integration testing were attempted but dependency installation could not be completed in this environment; no production launch approval is claimed.
- See `STAGE_20_INTEGRATION_READINESS.md`. Stop and ask for user approval before another stage.

## Stage 21 — Deployment validation toolkit (ready for review)

Approval of the Stage 20 release candidate initiated validation work. This environment has no Docker/MySQL runtime and cannot resolve dependencies from npm / SheetJS hosts, so live containers, financial database transactions and pixel-perfect visual comparisons were **not** performed. Replaced **144 private Lovable dependency tarball URLs** in `backend/package-lock.json` with public npm registry URLs while retaining versions and integrity hashes. Added an offline package audit, a tenant-aware read-only authenticated HTTP smoke script, and six tests. Full regression suite: **225/225 passed**; offline package audit, Compose YAML parse and backup script syntax passed. The stage records the environment blockers and precise host-run procedures. See `STAGE_21_DEPLOYMENT_VALIDATION.md`. Production rollout remains unapproved pending full integration and compliance verification.

## Stage 22 — Two-organisation integration test handoff

Approved Stage 21 remains the baseline. Added a strict read-only two-account live-tenant smoke script and offline mock tests plus a dedicated operator runbook (`STAGE_22_TENANT_INTEGRATION.md`). No live Docker, MySQL, SMTP, browser, or tenant-access assertions are made by this stage. Production status: **BLOCKED pending live acceptance**.

**Historical checkpoint:** Stage 22 approved. Stage 23 offline acceptance tooling prepared for approval.

## Stage 23 — Cross-module acceptance readiness (ready for review)

- Adds six authenticated read-only document checks for a selected PO→GRN and SO→challan→invoice→receipt chain, with seven link/quantity/settlement invariants. It deliberately requires pre-existing *test* documents and does not post business data.
- Adds an isolated opt-in MySQL rollback + unique-constraint probe using an InnoDB TEMPORARY table; it does **not** certify application transactions or business concurrency.
- Adds a permission-checked `GET /receipts/:id` endpoint using organisation-scoped document lookup, and extends the offline deployment audit.
- **247/247 automated tests pass** including 15 new tests. Native TS syntax check and package checks pass; Docker/MySQL live execution, installed-dependency build, real email and browser parity remain unverified. See `STAGE_23_LIVE_ACCEPTANCE.md` for the complete live acceptance matrix.
- Stop for user approval; production deployment remains blocked pending real-world verification.

## Stage 24 — Reverse-proxy authentication rate-limit correction (ready for review)

Stage 23 remains the accepted baseline. Reproduced and fixed a potential cross-user denial-of-service problem: the backend's login/forgot-password rate limiter keyed all proxied users to the Nginx socket IP. The packaged Nginx gateway now overwrites client-supplied forwarding headers, the Express server trusts exactly one private proxy hop, and the rate limiter keys on the resulting client `req.ip`. Added fail-closed deployment-audit checks for proxy configuration and exposed backend ports. **251/251 tests pass**, including four new tests; the original failure was demonstrated before the correction. No new schema or screen changes. **Not live verified**: Docker/MySQL, real two-client-IP gateway behaviour, SMTP, builds, business transactions and visual parity. See `STAGE_24_PROXY_SECURITY.md`.

**Stop for approval after Stage 24; production release remains blocked pending live evidence.**


## Stage 25 — npm-first deployment (review requested)

The default deployment path is now `npm install` (frontend), `npm run install:backend`, `npm run build:all`, and `npm run start`; the same-origin Node gateway runs the React SSR and Express backend without Docker/Nginx. MySQL still runs separately. `.env.npm.example` supplies the npm-specific configuration, while the existing Docker `.env.example`, `compose.yaml` and Dockerfiles remain unchanged. API binding in npm mode is loopback-only to keep the Stage 24 single-proxy-hop limiter protected. Stage 25 added 4 npm runtime/gateway tests; see `STAGE_25_NPM_DEPLOYMENT.md`. Registry-dependent builds and live MySQL/SMTP remain unverified here.

## Stage 26 — Warehouse dashboards and fast stock adjustments

Added bookmarkable individual warehouse dashboards, all-catalogue inventory including zero-stock products, +/− adjustment actions using existing audit/approval posting, and tenant-scoped 30-day ledger-derived inbound/outbound values. Kept challan-dispatch stock deduction without double deduction on invoice issue. Direct POS billing without a challan is outside this stage. npm deployment remains preferred; Docker is retained. See `STAGE_26_WAREHOUSE_MANAGEMENT.md`.
