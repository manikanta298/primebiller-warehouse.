# Stage 2 — Dashboard review checkpoint

**Route:** `/dashboard` (requires a signed-in account with an organisation selected).

This stage retains the supplied dashboard's existing card, bar chart, pipeline, movement table, and attention-list layout. No other content screen has been changed; the shared app-shell keyboard shortcut now checks role access.

## Implementation

- React/TanStack Query fetches `GET /api/v1/dashboard?godownId=<id|all>` with the JWT and `X-Org-Id` headers supplied by `src/api/client.ts`. The query cache key includes organisation and godown to prevent mixing snapshots when switching organisations.
- Express validates that a selected godown belongs to the signed-in organisation; an invalid or cross-organisation godown returns `404`.
- MySQL-backed metrics: current stock value, today's ledger movements, stock-alert counts (free stock includes held reservations), godown comparison, four sales pipeline stages, high-value movements from the last seven India business days, and actionable attention items.
- Snapshot date is supplied by the backend using the current business date in `Asia/Kolkata`. Ledger timestamps are stored as UTC without zone suffixes in MySQL, so query boundaries convert India midnight to UTC and display the original movement day in India.
- Selecting a godown scopes all dashboard metrics; overdue invoices are matched via their linked challans. If the selected godown has no movements, godowns, or attention items, the relevant panel displays an empty state.
- The original "New sales order", Alerts, and Stock ledger links are shown as links only to roles permitted to use those screens. Ctrl/Cmd+N now also respects the sales-order role guard.
- Both real API and demo-mode mock share `src/lib/dashboard-rules.ts` / `backend/src/shared/dashboard-rules.ts`, regenerated with `node scripts/sync-shared.mjs`.

## Run

On a clean installation, configure `.env` and start with `docker compose up -d --build`, then create the first Owner as described in `CONVERSION_STATUS.md`. On an existing Stage 1 installation, replace its source with this complete Stage 2 archive and run the same Compose command; **do not delete** the `mysql_data` volume. No new database migration is required in Stage 2.

Open `http://localhost:8080/login`, sign in, select an organisation, and visit `http://localhost:8080/dashboard`. Change godown in the top bar and compare all KPI cards, pipeline stages, the movement table, and the attention items to the selected scope. Verify permitted and restricted user roles; try the Ctrl/Cmd+N shortcut. Verify an empty organisation and an organisation with posted stock movements.

## Automated checks

`npm run test:dashboard` runs the Node.js 22 tests covering stock and alert scoping, zero-data scenarios, pipeline stages, cross-organisation exclusions and India/UTC day boundaries. The shared module and edited TypeScript/TSX were syntax-checked in the packaging environment.

The full Docker deployment, authenticated API against a live MySQL database, cross-browser layout comparison, and pixel-level screenshots **were not run in this environment**. These require a running Docker engine, project dependencies and the original screen's reference screenshots or running application.

## Approval checkpoint

Please approve **Dashboard** before Stage 3. Suggested next screen: **Items list**, followed by its detail and edit forms as separate reviews where necessary.
