# Girder API (Node.js + Express + MySQL)

REST API for the Girder frontend. Base path: `/api/v1`. Every response matches the types in
`src/shared/types.ts` (a copy of the frontend's `src/api/types.ts`), so the screens work unchanged.

## 1. Requirements
- Node.js 20+
- MySQL 8 (Aiven, PlanetScale-compatible MySQL, RDS, or local). Tested locally on MariaDB 11.4 too.

## 2. Setup
```bash
cd backend
npm install
cp .env.example .env        # fill in DATABASE_URL, JWT_SECRET, SETTINGS_KEY, CORS_ORIGINS
npm run db:migrate          # creates any missing tables; safe to re-run, never deletes data, inserts nothing
npm run setup:owner         # one time: your organisation + first Owner login (see below)
npm run dev                 # http://localhost:4000/health
```
Generate secrets with `openssl rand -hex 32` (use one for `JWT_SECRET`, another for `SETTINGS_KEY`).

For Aiven: set `DB_SSL=true` and download the CA certificate from the Aiven console, then point
`DB_SSL_CA_PATH` at it. **Rotate the Aiven password that was shared in chat before using it.**

### First Owner login
The database starts completely empty — there is no demo data. Before running `npm run setup:owner`, add these
to `.env` (and remove the password afterwards):
```
SETUP_ORG_NAME=Your Business Name
SETUP_ORG_GSTIN=36XXXXX0000X1ZX      # must be a valid GSTIN; state is taken from it
SETUP_OWNER_NAME=Your Name
SETUP_OWNER_EMAIL=you@example.com
SETUP_OWNER_PASSWORD=at-least-10-characters
SETUP_OWNER_MOBILE=                  # optional
```
It creates the organisation, document numbering (5 digits, e.g. `INV/26-27/00001`), default settings and the two
print layouts, then the Owner. It refuses to run a second time. Add godowns, items, parties and other users from the app.

### First registration as master admin

The master admin uses the existing `Owner` role, which has full access to its organisation. For a new installation with no users or organisations:

1. Generate a separate private setup code with `openssl rand -hex 32`.
2. Set `SETUP_REGISTRATION_TOKEN` to that code in the backend's Render environment. Never set it as a frontend `VITE_*` variable.
3. Deploy the backend and frontend with the correct `VITE_API_URL`, `APP_URL` and `CORS_ORIGINS`.
4. Open the frontend sign-in page and select **Register first master admin**. Enter your business name, valid GSTIN, name, email, password (10+ characters), and the private setup code.
5. Registration creates the organisation, Owner, document series, settings and print profiles in one transaction, then signs you in. Remove `SETUP_REGISTRATION_TOKEN` after setup.

`GET /api/v1/auth/setup-status` only enables the form when a private code is configured and the database is empty. `POST /api/v1/auth/register` verifies the code and never accepts a caller-supplied role. The web and CLI setup share a MySQL advisory lock so only one first account can be created, even during simultaneous requests. Existing installations keep their current users and roles; later users are invited by the Owner.

## 3. Connect the frontend
In the frontend's hosting settings (Vercel/Render), set:
```
VITE_API_URL=https://your-api.onrender.com/api/v1
```
and add the frontend URL to the API's `CORS_ORIGINS`. Without `VITE_API_URL` the frontend runs on demo data.

## 4. Deploy (Render example)
- New → Web Service → root directory `backend`
- Build: `npm install && npm run build` · Start: `npm start`
- Add the environment variables from `.env.example`
- Run `npm run db:migrate` and then `npm run setup:owner` once (Render Shell).

## 5. How it is built
| Part | Where |
| --- | --- |
| Tables | `db/schema.sql` — masters, users, roles (separate `user_roles` table), stock balances, batches and the append-only `stock_ledger` are normal relational tables. Business documents keep header columns (number, date, party, status, total) plus the full document in a JSON `body` column. |
| Business rules | `src/shared/*` — generated from the frontend's rules by `node scripts/sync-shared.mjs` in the repo root (a developer tool outside this folder). The copies are committed, so this folder builds and runs on its own. Never edit the copies. |
| Transactions | Every write runs in one transaction (`src/http.ts` → `write`), rows are locked with `SELECT … FOR UPDATE` as they're loaded (`src/uow.ts`). |
| Numbering | `doc_series` (prefix, digits) + `doc_counters` row-locked inside the posting transaction, so invoice numbers have no gaps. |
| Auth | `POST /auth/login` → JWT. Each request sends `Authorization: Bearer …` and `X-Org-Id`. The role is read from `user_roles` on every request; changing a user's role or deactivating them revokes their tokens. |
| Permissions | `src/shared/permissions.ts` — the same table the screens use to hide buttons. |

## 6. Endpoints
```
POST /auth/login | /auth/accept-invite | /auth/logout
GET  /orgs/:orgId/godowns[?detail=1]      POST|PUT /orgs/:orgId/godowns[/:id]
GET  /notifications  /dashboard?godownId=
GET|POST /items   GET|PATCH /items/:id
GET|POST /parties GET|PUT /parties/:id
GET|POST /masters/:kind   PUT /masters/:kind/:id        (uoms | categories | brands | hsn)
GET|POST /sales-orders  GET|PUT /sales-orders/:id  POST /sales-orders/:id/confirm | /cancel
GET|POST /challans  GET /challans/:id  POST /challans/:id/deliver | /cancel | /eway/(extend|part-b|cancel)
GET|POST /invoices  GET /invoices/:id   (GET /invoices?customerId=&open=1)
GET|POST /receipts  GET /receipts/advances[?customerId=]
GET|POST /purchase-orders  GET /purchase-orders/:id
GET|POST /grns  GET /grns/:id
GET|POST /transfers  GET /transfers/:id  POST /transfers/:id/receive | /cancel
GET|POST /adjustments  GET /adjustments/:id  POST /adjustments/:id/approve | /reject
GET  /stock/ledger  /alerts   POST /alerts/:id/acknowledge  /alerts/acknowledge-all
GET|POST /users  PUT /users/:id
GET|PUT /settings   GET /settings/numbering   PUT /settings/numbering/:docType
GET  /print-profiles   PUT /print-profiles/:id
GET  /search?q=&docTypes=&status=&datePreset=&min=&max=
POST /import/parse   { fileName, contentBase64 } | { url }  → rows (Excel, JSON, CSV, Google Sheets link)
GET  /reports/gstr1?period=YYYY-MM | /reports/sales-register?from=&to= | /reports/receivables | /reports/item-sales?from=&to=
```
Errors always come back as `{ "code": "...", "message": "...", "details": ... }`.

## 7. Not done yet (be aware before going live)
- **E-way bills are fake.** `src/ewb.ts` returns numbers starting with `TEST`. Connect your GSP there.
- **Invite emails/SMS are not sent.** Creating a user returns an invite link the Owner must share; it is also logged.
- No PDF rendering for print profiles, no file uploads (POD photos/signatures), no sales returns / credit notes,
  no stock counts, no audit log table, no cursor pagination (lists return everything; search is capped at 500).
- Bulk import calls `POST /items`, `/parties`, `/orgs/:id/godowns` one row at a time — fine for hundreds of rows, slow for tens of thousands.
- Registration and password recovery have automated tests with database and SMTP substitutes. Live MySQL verification and automated tests for the remaining business API flows are still needed.

## 8. Password recovery (Stage 1)

The login flow now includes `POST /auth/forgot-password` with `{ "email": "..." }` and
`POST /auth/reset-password` with `{ "token": "64 lowercase hex chars", "password": "10+ chars" }`.

Reset tokens are single-use, expire after 60 minutes, and are stored in MySQL only as SHA-256
hashes. Resetting a password increments `users.token_version`, invalidating all prior JWTs.
The forgot-password endpoint uses the same outward-facing response whether an account exists
or not and restricts accepted requests for a registered account to 3 per 15 minutes.

SMTP uses Node's built-in socket/TLS modules; no additional packages are necessary. Configure
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY` (`tls`, `starttls`, or `none` for local Mailpit only),
`SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`. A local SMTP mail catcher is included in
`compose.yaml`; production environments must use TLS and verified sender credentials.

For Render, set `APP_URL` to the deployed frontend origin so reset emails link to the correct sign-in page. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM` using your email provider's settings. Use `starttls` for port 587 or `tls` for port 465, and a provider-approved sender address. Store the SMTP password only in Render's private environment settings.

Render Free web services block outbound SMTP ports 25, 465 and 587. Standard SMTP on those ports therefore requires a hosting plan that permits them; see https://render.com/docs/free. The code does not bypass that network restriction. No live SMTP delivery is claimed until you configure a real provider and test a reset email.

Password-reset links remain single-use, expire after one hour, and invalidate earlier JWT sessions. An email accepted by SMTP remains usable even if the server drops the closing QUIT reply. Run `npm test` in `backend/` for registration and recovery tests; they use an in-memory database substitute and local SMTP server, never a live account.

For a new database, `db/schema.sql` includes `password_reset_tokens`. For existing databases,
run `db/migrations/001_password_reset.sql` or rerun the idempotent schema migration.
