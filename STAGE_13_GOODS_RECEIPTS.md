# Stage 13 — Goods Receipts (GRN) — approval build

**Checkpoint:** Stages 1–12 approved. This package stops before Stage 14 and retains the original screens and assets.

## Screens

- `/purchases?tab=grn`: same original seven-column GRN table with search, pagination, direct/PO receipt filter, and organisation-scoped queries. Actions remain role restricted.
- `/purchases/grn/new` and `/purchases/grn/new?poId=...`: original supplier, warehouse, date, supplier invoice, vehicle, item/received/rejected/rate/batch/heat/manufacture/expiry, landed-cost and freight controls. Adds loading/error/permission handling, India business dates, active master selections, read-only supplier/warehouse on linked POs, unsaved/discard warnings, visible validation, and a preview calculated with the common GST engine. Empty draft rows are not posted; partially filled rows must be fixed. Ctrl+Enter posts a valid GRN.
- `/purchases/grn/:id`: preserves the immutable posted receipt and original eight-column item table; additionally shows manufacturing dates beside batch numbers, rejection reasons, freight, supplier invoice and source PO/stock ledger links.

## API, stock ledger, and database

- `POST /api/v1/grns` requires Owner/Manager/Storekeeper and accepts a strict typed document, at most 200 lines. Shared `src/lib/grn-rules.ts`, generated into `backend/src/shared/grn-rules.ts`, checks supplier kind/blocked state, active organisation-owned godown, valid nonfuture received/invoice dates, two-decimal freight and rates, three-decimal quantities, valid/rejected quantities, mandatory rejection reason, batch/heat number for tracked accepted stock, manufacture/expiry dates, existing batch metadata, duplicate item/batch rows, approved linked PO ownership, supplier/godown match, and aggregate pending quantities. The server revalidates under transaction locks.
- Accepted quantities increment the destination godown/item/batch only; rejected units remain on the immutable GRN but do not enter stock. PO received quantities include accepted and rejected arrivals (goods physically inspected), and status updates to partial/received. Accepted units generate stock-ledger PURCHASE_IN entries; supplier payable is updated from accepted taxable value, GST and apportioned freight. Freight rounding drift is applied to the last positive-value line, not a rejected-only line; weighted-average inventory cost is recomputed.
- Duplicate supplier invoices are rejected in the UI/demo and by the API. New **MySQL `grn_invoice_registry`** primary key `(org_id, supplier_id, invoice_key)` provides concurrency-safe protection in the same transaction as the GRN, document number, inventory entries and supplier balance. `backend/db/schema.sql` creates and backfills the registry idempotently; `backend/db/migrations/002_grn_invoice_registry.sql` is the standalone upgrade script. Docker backend runs `npm run db:migrate` at startup. The legacy backfill uses INSERT IGNORE; any duplicate invoices already present in old data must be reconciled by an administrator, not automatically deleted.
- Organisation isolation applies to GRNs, supplier/item/PO/warehouse lookups, cache keys and backend SQL. `GET /grns` and `/grns/:id` require `postGrn` permissions.

## Review checklist

1. Switch organisations; search and filter GRNs; verify foreign document IDs and linked PO IDs return 404.
2. Post a direct GRN with accepted and rejected lines. Confirm batch/warehouse stock, weighted-average cost, PURCHASE_IN stock ledger entries, original document number, and supplier payable. Rejected units must not appear as stock.
3. Post partial and completed GRNs linked to an approved PO; try draft/cancelled/received POs, other suppliers/godowns, counterfeit lines, repeated item/batch lines, and lines whose *combined* quantity exceeds pending.
4. Test duplicate supplier invoice numbers with different letter case/spacing, including two simultaneous API requests. Confirm only one transaction posts (409 duplicate) with no extra stock or payable.
5. Test invalid/future dates, overprecision, zero/negative amounts, rejected > received, missing rejection reason, no batch for tracked accepted stock, expired batches, contradictory manufacture dates, foreign/inactive items, and freight on fully rejected receipts.
6. Check GST totals for intra/interstate suppliers and freight allocation, and inspect the immutable GRN detail, navigation, reload, Ctrl+Enter, cancel/unsaved controls and responsive appearance.
7. On an **existing** MySQL installation apply `npm run db:migrate` (or `002_grn_invoice_registry.sql`) before starting the upgraded API. Compare known legacy supplier invoices for duplicates before production use.

## Automated checks and limitations

- `npm run test:grn`: 14 new native tests. `npm run test:conversion`: **123/123** prior and new rules tests passing.
- Syntax parsing on changed frontend/backend TypeScript/TSX and SQL/compose/archive checks are recorded in the packaging review.
- Real Docker/MySQL execution, concurrent SQL race testing, installed-dependency/full typechecking, live browser E2E and pixel-by-pixel comparison have **not** been completed in this environment. Invoice reconciliation, goods-return/RMA, formal QC inspection, supplier credit notes, and full accounting journal/AP reconciliation are later stages, not claimed here.
