# Stage 14 — Stock Transfers — approval build

**Checkpoint:** Stages 1–13 are approved. This delivery implements only the Stock Transfers screen/workflow; it does not start Stage 15.

## Screens

- `/transfers`: retain the seven original table columns and status chips (all, in transit, received, shortage, cancelled); add text search (transfer number, source, destination, vehicle, status or date), 25-row pagination, India-business-day stuck-transfer indicator, tenant-scoped cache keys, loading/errors and role-aware creation.
- `/transfers/new`: preserve source → destination header and batch/item/quantity grid. Default to an actual active godown in the selected organisation, offer active stock items and valid source batches, clear batches on source/item change, preview cost, and block dispatch until shared validation passes. Transfer dates default to India business date and cannot be in the future. Removed the blanket claim that internal stock transfers never need transport documentation: the screen creates **inventory documents only**.
- `/transfers/:id`: original item/batch rows, details, event history, stock ledger link, and receipt/cancellation actions. Receipt is restricted to approved roles. Each line requires an explicit received quantity; shortages require a reason. Read-only review displays sent, received and shortfall totals. Cancellation requires a reason and is available only while in transit to Owner/Manager.

## Business logic and database

- Shared `src/lib/transfer-rules.ts` is generated into `backend/src/shared/transfer-rules.ts`; frontend form, demo API, and MySQL API apply the same checks. Positive quantities are capped and limited to three decimals. Transfer dates must be real, not future, and both warehouses active and distinct. All items must belong to the selected organisation and be active. Source free stock excludes reservations. Tracked items require an existing source batch; unknown batch numbers are rejected.
- **Repeated item and batch rows are aggregated before validation** so an order cannot draw more than item free stock or batch on-hand through several individually valid lines. Multiple different batches for one item are supported. The Express API locks each relevant item/stock/batch row in a stable item-ID order while validating/posting, using the existing MySQL transaction and unit of work.
- Dispatch posts `TRANSFER_OUT` and decrements source item and batch balances, without crediting destination while in transit. Receiving accepts **exactly one explicit quantity per dispatched line** and posts `TRANSFER_IN` for the dispatched quantity, plus a traceable `ADJ_OUT` transit-loss entry for any shortage, leaving net destination stock equal to physical goods received. A transfer becomes received or partially received, and cannot be received or cancelled a second time. Cancellation before receipt returns the dispatched quantities and batches to source and records `TRANSFER_IN` with an audit event/reason.
- Real API uses per-request organisation-scoped SQL, validated warehouse/item lookups, and role permissions; the demo backend now maintains explicit organisation ownership for seeded and newly created transfers and blocks foreign ID access. The seeded in-transit transfer now has a linked source batch, an initial source decrease and a ledger event.
- Existing `transfers`, `items`, `item_stock`, `batches`, `stock_ledger`, and `doc_counters` MySQL tables are sufficient: **no Stage 14 migration**. All Stage 13 SQL scripts, React and Express Dockerfiles, JWT, SMTP and `compose.yaml` remain included.

## Review checklist

1. Switch between organisations; verify that search results, direct transfer IDs, item choices and godown choices never expose a record owned by another organisation.
2. Dispatch unbatched goods between two active godowns. Confirm the source free stock decreases and destination stock does **not** increase until the receipt is posted; verify the `TRANSFER_OUT` ledger entry.
3. Dispatch a tracked item from a named batch. Test missing/foreign batch, negative/zero/more-than-three-decimal amounts, inactive items/warehouses, same source/destination, future/impossible dates and combined quantities across two lines exceeding one item or batch.
4. Receive with all quantities; verify `TRANSFER_IN`, destination item and batch stock, status and audit history. Repeat the receive request and verify a 409/no second posting.
5. Receive less than sent, with and without a reason. Check transit-loss `ADJ_OUT`, total net stock, shortage details, partial status and read-only detail. Test missing/excess receive lines and over-receiving.
6. Cancel an in-transit transfer with Owner or Manager, supplying a reason; verify stock/batches returned once to source. Ensure Storekeeper cannot cancel, and a received/partially received/cancelled transfer cannot be reversed through the same action.
7. Test search, status chips, 25-row pagination, empty/error states, keyboard input, responsive widths and stock-ledger navigation. Compare screenshots to the source application manually.

## Automated checks and known limitations

- `npm run test:transfers`: **15 new native tests** for quantities, aggregate stock/batches, dates, scope, receipts and search.
- `npm run test:conversion`: **138/138** rule tests across Stages 2–14.
- TypeScript/TSX **syntax parsing** for modified files, YAML parsing, required deployment files and ZIP integrity checks are performed as part of packaging.
- Full dependency-aware typechecking, a live Docker/MySQL transaction test (including concurrent dispatches), browser E2E testing and pixel-perfect rendering against the original application **are not performed here**. Receipt shortages are immediately classified as transit losses, not a separate claims/approval workflow. Inter-GSTIN stock transfers, statutory challans and e-way bills are **not** generated by this screen; compliance must be assessed and implemented separately for a real deployment.

**Stop here for approval. Next proposed screen: Stage 15 — Stock Adjustments.**
