# Stage 9 — Delivery Challans (approval build)

**Review status:** Awaiting Stage 9 approval. Built on approved Stages 1–8. **Stop here until approval.**

## Screens preserved and improved

- `/challans`: retains original status chips and nine table columns (Challan, Date, Customer, Sales order, Godown, Vehicle, E-way bill, Value, Status). Adds keyword search across displayed document, party, vehicle and location fields; 25-row pagination; org-aware React Query keys and role-aware creation action.
- `/challans/new`: preserves the five-step wizard (Sales order, Lines, Batches, Vehicle & driver, Dispatch). Selection, pending quantities, unit displays, GST totals and dispatch action remain. Stock checks now aggregate over the **whole shipment**, rather than evaluating each repeated item/order line independently. FIFO suggestions distribute a batch's available quantity across repeated item lines, and all overrides require a recorded reason. Batch-tracked items may not be dispatched as general stock; untracked items may not claim a batch.
- `/challans/:id`: preserves the original dispatch timeline, printable gate pass, line summary, tax/value totals, e-way bill actions, transport information, linked documents, and proof-of-delivery form. Only authorised roles can cancel/dispatch or convert to invoice; drivers can read/mark delivery only for challans assigned to their account name. Active test e-way bill cancellation is refused after the 24-hour window (including challan cancellation) instead of silently marking it cancelled.

## Security and accounting invariants

- **MySQL API:** Require a valid, active order godown in the authenticated organisation. Validate the complete request against the currently loaded sales-order lines, stock quantities and batches in the same transaction. Reject duplicate order-line IDs, over-dispatch, excessive quantity precision, negative/non-finite inputs, invalid/foreign batches, repeated batch allocations, mismatched allocation sums, combined stock/batch shortages, invalid vehicle/driver/distance information, and FIFO overrides without a reason.
- **Atomic posting:** Once validation passes, existing stock ledger entries, item/batch balances, sales-order delivered quantities, document number and linked document are updated using the existing transactional UoW. Cancel reverses stock, batch and reserved quantity changes only from an in-transit challan, subject to the test e-way bill cancellation window.
- **Mock/demo:** Add explicit `challanOrgIds` ownership, seed those IDs from originating sales orders, and record new challans' organisation IDs. List, detail, dispatch, POD, cancellation and e-way bill changes cannot access another organisation's challan/order. Drivers see only assigned challans in both mock and real APIs.
- **Shared rules:** `src/lib/challan-rules.ts` regenerated into `backend/src/shared/challan-rules.ts` with `node scripts/sync-shared.mjs`; keeps React, mock and Express validation aligned.

## Important: live e-way bills are **not** issued

The inherited `backend/src/ewb.ts` is a **placeholder**, not a Government of India GSP integration. New backend and mock bills have obvious `TEST` numbers, and the UI explicitly warns users; they must not be treated as statutory e-way bills. Calculated validity windows are estimates. Production operation requires integrating an authorised GSP, handling API errors/retries and idempotency, and validating transport-law rules with appropriate experts. SMS notifications, geolocation, scanned signatures and third-party live vehicle tracking are **not** implemented.

## MySQL / Docker

No new SQL migration is needed. Existing `backend/db/schema.sql` contains `challans`, `sales_orders`, `item_stock`, `batches`, `stock_ledger`, `doc_series` and `doc_counters`, with organisation scoping and transactional support. The complete schema, recovery migration, separate frontend/backend Dockerfiles, Nginx gateway, MySQL 8.4 and Mailpit compose setup remain included. Configure `.env` from `.env.example` and run `docker compose up -d --build` in a Docker-enabled environment.

## Suggested manual approval checks

1. Log in as Owner/Manager/Storekeeper; review all list columns, chips, keyword matching and pagination on `/challans`. Switch organisations; confirm no other organisation's records are shown or accessible by direct URL.
2. Select a confirmed sales order, create a partial dispatch, and verify pending quantities and GST totals. Try two lines with the same item: FIFO should allocate a shared batch **only once** across the lines; over-allocating it must fail.
3. Try a nonexistent batch, an unallocated tracked item, a bad vehicle number, invalid 10-digit phone, zero distance when e-way bill is indicated, and non-matching allocation totals. Confirm inline errors and disabled dispatch.
4. Change the FIFO-selected batch; ensure a reason of at least five characters is mandatory and reflected in the detail/ledger. Reset to FIFO and verify the reason is no longer required.
5. Dispatch and check stock, batch balance, held quantity, linked sales order, dispatch timeline, and the generated `TEST` EWB warning. Do not use it as a statutory bill.
6. Log in as a Driver with an exact matching assigned driver name. Verify only assigned challans are visible, and only POD entry is permitted. Verify the invoice-conversion action is offered only to eligible office roles.
7. Cancel an in-transit challan with a reason before the test EWB window expires; check stock and holds reverse exactly once. Ensure repeated cancellation and attempts after the 24-hour window are rejected.
8. Check narrow viewport and print layout. Reconfirm prior stages and run live MySQL/Docker and JWT flow before production sign-off.

## Automated verification / limitations

- `npm run test:challans` — **12** native Node tests for FIFO, repeated lines, totals and stock/batch safety, transport validation, EWB time boundaries, tenancy and search.
- `npm run test:conversion` — **70/70** native tests across Stage 2–9 rules passed.
- Source syntax checked for 7 changed TypeScript/TSX files and generated backend rules; Docker Compose YAML parsed. See latest `CONVERSION_STATUS.md`.
- No full dependency typecheck, live MySQL/Express interaction, executable Docker run, browser/visual pixel comparison, or actual external GSP integration was possible in this environment. Approval is for a **source-code review build**, not production certification.
