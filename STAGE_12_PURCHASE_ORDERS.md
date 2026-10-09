# Stage 12 — Purchase Orders (approval build)

**Checkpoint:** Stages 1–11 approved. The next screen must not be started without user approval.

## Screens retained and enhanced

- `/purchases?tab=po`: retains original Purchases/GRN tab navigation and **seven original PO columns** (PO, Date, Supplier, Godown, Received, Value, Status). Adds keyword search (PO number/date/supplier/godown/status), draft/open/partial/received/cancelled filter, stable newest-first ordering, 25-row paging, results count, org-keyed cache and permission-aware actions. GRN table retains the original seven columns and now has search/paging and a separate cache per organisation.
- `/purchases/new`: retains the three original header fields, item grid, notes and total area. Adds local-India business date, explicit active delivery-godown selection, supplier/item eligibility, precise line validation, error/loading states, GST estimate (taxable, CGST/SGST or IGST, round-off, grand total) according to org and supplier states, Save Draft, Raise PO, discard confirmation and unload warning.
- `/purchases/:id`: retains original ordered/received/pending line table, links to GRNs and notes. Adds role-gated Approve PO for drafts, Cancel PO with required reason if no stock has been received, approver/cancellation audit fields and guarded Receive Goods action.

## API and shared validation

- `POST /api/v1/purchase-orders`: accepts only declared input fields; `draft: true` saves a nonreceivable draft. Otherwise, a PO is raised as an approved/open order. Only Owner/Manager may create. Numbering and document persistence run in a single MySQL transaction.
- `POST /api/v1/purchase-orders/:id/approve`: Owner/Manager may approve only drafts. Approval changes status to `open`, records `approvedBy`, and makes the PO eligible for GRNs.
- `POST /api/v1/purchase-orders/:id/cancel`: Owner/Manager can cancel only drafts or open orders with *zero* goods receipts, with a 5–500-character reason; it retains the PO number and records actor and reason. No stock movements are made for a never-received PO.
- Shared `src/lib/purchase-rules.ts` mirrored to `backend/src/shared/purchase-rules.ts` validates real/nonfuture PO dates, supplier kind/blocked flag, active org-owned delivery godown, max 200 lines, active org-owned items, no duplicate item IDs, positive 3-decimal quantities, nonnegative 2-decimal prices, and notes length. Cross-org backend lookups are restricted in `Uow`; mock tracks PO ownership explicitly for all seeded/new orders.
- Linked GRN posting now refuses draft/cancelled/received POs, validates supplier and godown match, rejects forged PO lines or item mismatches, and aggregates repeated GRN lines before checking remaining quantity. A PO approval is not a stock receipt. The GRN form itself is reserved for Stage 13's deeper review.
- No new SQL schema/migration is needed: `purchase_orders` uses the existing `sales_orders` structure with a status column and JSON document body, and `doc_counters` already supports `PO`. JWT, SMTP, Docker files, all previous stages and the full schema are retained.

## Review checklist

1. Switch organisations and verify only that organisation's purchase orders are visible. Search/filter/paginate and check the empty state. Open a PO in a different organisation directly via its ID; expect HTTP 404.
2. With Owner/Manager, select an eligible supplier, an active godown and a few items; verify GST is CGST/SGST for intrastate suppliers and IGST for interstate suppliers, with the same total as Express after saving.
3. Test impossible/future dates, blocked/customer-only suppliers, foreign/inactive warehouses and items, duplicate items, 0/negative/excessively precise quantities and rates, oversized notes and over 200 lines. Neither demo nor Express should accept the PO.
4. Save a draft, verify it cannot be received, approve it as an allowed role, and confirm it can then be received. Use lower-privilege roles to attempt POST approve and cancel; expect HTTP 403.
5. Cancel an unreceived order with a reason and verify the same PO ID/number remains with status cancelled, approver/creator retained and no stock movements. Cancellation of partial/complete receipts, or repeat cancellation, must fail.
6. For an approved PO, attempt a GRN with mismatching warehouse/supplier, invalid PO line, or duplicate GRN lines that collectively exceed pending; expect 422/409 before stock is written.
7. Run `npm run test:purchase-orders` and `npm run test:conversion`. Inspect a live MySQL transaction, Docker build, responsive screen and pixel comparison with the original before production acceptance.

## Verification and production boundaries

- **13 new pure-rule tests** plus 96 previous tests = **109/109 passing**. Ten frontend/backend TypeScript/TSX files pass syntax parsing, and the shared rule copy has been regenerated.
- Docker Compose YAML and archive/source integrity are checked separately when packaging. **Full project/dependency TypeScript typechecking, live Docker/MySQL execution, API integration, browser E2E tests and pixel-by-pixel visual parity remain unverified.**
- This implements a simple Owner/Manager draft-to-open approval, **not** a multi-person approval matrix, supplier-facing approval/signature, email purchase-order delivery, purchase returns or full financial/AP posting. Stage 13 will review goods-receipt details rather than redesign this screen.
