# Stage 26 — Warehouse management dashboards and quick stock controls

This stage extends the approved Stage 25 **npm-first React/Express/MySQL project**. All Docker resources remain intact and usable later. No additional MySQL tables or migrations are required.

## How to use

1. Start the existing system (`npm run build:all`, then `npm run start`) with a connected MySQL database.
2. Open **Warehouses** and choose **Dashboard & stock** for a warehouse. Every warehouse has a bookmarkable link, for example `http://localhost:8080/warehouses?warehouse=<warehouseId>`.
3. The dashboard shows **current stock valuation**, **30-day inbound/outbound cost value**, counts of incoming/outgoing ledger events, a visual daily movement comparison, and up to 20 recent movements. Monetary values are shown instead of nonsensical sums of different base units (bags + kilograms, etc.).
4. Select **All products** to see *all items in the selected organisation*, including SKUs that have **zero balance** or no `item_stock` row in that warehouse. Search and filter by free-stock status or reservations.
5. Use the `+` and `−` buttons for a numbered, auditable stock adjustment. Enter quantity and a reason. Batch-tracked items require a batch number; reductions must choose an existing batch. The existing backend rejects reductions exceeding free stock after reservations. The server retains approval thresholds for Storekeepers. A pending adjustment does **not** immediately modify the inventory.

## Inventory & billing integration

- The system maintains a **shared product master** and **separate inventory balances per warehouse**. Adding a product does not create physical stock; the new SKU becomes available in every warehouse catalogue at **0** until receipt, transfer or an authorised adjustment.
- The existing Sales Order → Delivery Challan → Tax Invoice workflow already uses warehouse-specific inventory. **Dispatching a delivery challan posts `DC_ISSUE` and reduces that warehouse's stock in the ledger and balances; invoicing that challan must not post another deduction.** Challan cancellation posts a reversal. The new dashboard includes these movements automatically.
- **Direct, stand-alone POS/billing invoices without a delivery challan are not implemented in this stage.** They would need an explicit new posting workflow and paired reversal/cancellation rules. Do **not** double-deduct at tax-invoice issuance in the current flow.
- All inventory edits remain in the existing adjustment endpoint rather than direct `UPDATE item_stock` calls from the UI. The current MySQL transaction, row locks, warehouse/organisation scoping, JWT role permissions, batch validation, and append-only ledger remain the source of truth.

## New technical components

- `src/lib/warehouse-dashboard-rules.ts`: pure catalogue/filter/movement aggregation rules.
- `src/routes/_authenticated/warehouses.tsx`: linked per-warehouse dashboard, full catalogue and quick adjustment form.
- `backend/src/routes/core.ts`: read-only organisation-scoped `GET /api/v1/orgs/:orgId/godowns/:id/activity`, with SQL aggregation and latest movements.
- `src/api/client.ts` and `src/api/mock.ts`: matching real/demo accessors.
- `tests/warehouse-dashboard.test.mjs`: warehouse-specific validation tests. Run `npm run test:warehouse-dashboard` or `npm run test:conversion`.

## Deployment / remaining verification

Run the usual npm flow from `STAGE_25_NPM_DEPLOYMENT.md`. No change to `.env.npm` is needed. Docker is preserved for later. Confirm on the actual deployment machine that a new product appears at zero in two warehouses, increases and decreases correctly in the chosen warehouse, respects held stock and batches, and that a dispatched/billed order deducts **once**. Check role permissions, the approval workflow, and current MySQL movement totals.

Local unit/regression tests and syntax checks do not certify the live API, real MySQL, npm dependency builds, or pixel-perfect browser behavior, which remain to be tested on a host where dependencies are available.
