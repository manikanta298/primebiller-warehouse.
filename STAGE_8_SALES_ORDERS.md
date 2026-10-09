# Stage 8 — Sales Orders list, editor, confirmation and stock holds

**Review status:** Awaiting Stage 8 approval. **Screens:** `/sales-orders` and `/sales-orders/:id` (including `/sales-orders/new`). Built on the approved Stage 7 project. **Stop here until approval.**

## Implemented

- Preserved the source six-column order list (Number, Date, Customer, Supply, Status, Total), status chips, new-order button, original editor's customer/date/godown header, editable item lines, GST totals, credit-check panel, notes, linked documents and action buttons.
- The list adds multi-token search by order number, customer, date or status, a total-results count, 25-order pagination and a consistent newest-first order. Supply label compares each order's place of supply to the **current organisation's** state instead of a fixed Telangana code. Query cache and filters reset when the organisation changes.
- The editor defaults to **today in India (IST)**; selects an active sales/default godown from the selected organisation, not a hard-coded location. The item picker scopes its cache by organisation, hides inactive items, and clears the old item ID when users type over a selection.
- Shared validation checks real calendar dates, customer and godown selection, at least one item, up to 200 lines, positive quantity with three decimals, nonnegative rate with two decimals, discount from 0 to 100%, notes length and numeric boundaries. Validation errors appear before an API call; Express enforces the same checks.
- The Express API rejects foreign customers, suppliers masquerading as customers, blocked customers, foreign/inactive godowns, inactive/foreign items, forged line unit changes, forbidden body properties, supplied IDs on create and mismatched update IDs. It obtains HSN/GST from the item master while retaining the explicitly entered quote rate and discount.
- Confirmation rechecks customer, godown, item status and line details and **sums demand across repeated lines for the same item before comparing to free stock (on-hand minus held)**. Items are row-locked in predictable order in a MySQL transaction; number allocation and stock holds commit atomically. Repeated confirm and cancel actions are rejected by status. Confirmed-order cancellation releases holds; orders that have begun delivery cannot be cancelled here.
- Credit-limit checks are enforced on confirmation. Only an Owner can submit an override, and a 3–500 character reason is recorded. Related challan, invoice and receipt screens remain as in the approved baseline; they are not part of this stage.
- Unsaved-order changes trigger a browser reload warning and a discard confirmation on the editor's back link. Cancelling an order now requests confirmation.
- Demo orders and order lookups are tenant-isolated with explicit ownership records, including newly created orders. The demo performs the same validation, stock-demand aggregation, credit and role checks as the API.

## SQL and Docker

- No new table or migration is required: the existing `backend/db/schema.sql` already includes `sales_orders`, `doc_series`, `doc_counters`, `item_stock` and `parties` with organisation keys. The schema is retained without dropping data.
- The existing `compose.yaml`, `frontend.Dockerfile`, `backend/Dockerfile`, MySQL 8.4 container, and SMTP Mailpit test service remain present. Run `docker compose up -d --build` after configuring `.env`.
- Shared logic is authored in `src/lib/sales-order-rules.ts` and regenerated into `backend/src/shared/sales-order-rules.ts` by `node scripts/sync-shared.mjs`.

## Review steps

1. Login as Owner or Sales to `/sales-orders`; review each status chip, search by customer/number, and pagination. Check the six columns and navigate to an order. Switch organisation and confirm that another organisation's list/detail cannot be accessed.
2. Start a new order. Verify IST order date and organisation's default dispatch godown. Pick an item, change the quantity, rate and discount; check live taxable, CGST/SGST or IGST totals and credit headroom.
3. Save/reopen a draft, check changes. Try impossible dates, negative/over-precision prices, zero/negative/fractional quantities and more than 100% discount. Type over a previously selected item name without picking a new item: the previous ID must be cleared.
4. Add two lines of the same item with a combined demand larger than free stock. Confirmation must fail, and no stock should be held or order number consumed. Lower demand and retry; check the confirmed number and stock hold.
5. Confirm an over-credit order without override (blocked) and with an Owner override and reason (allowed). Sales role must not override. Check customer blocking, inactive items/godowns and foreign-organisation attempts fail.
6. Cancel a confirmed order, confirm the held stock is released once. Attempt a second cancel and confirm that a partly dispatched order cannot be cancelled. Verify linked documents still display and creation of a delivery challan remains possible for confirmed orders.
7. Check small/mobile viewport overflow, browser reload with unsaved draft edits, and previous stages' screens for regression.

## Automated checks / limits

- `npm run test:sales-orders`: 10 shared-rule tests including duplicate-item stock demand, calendar dates, line limits, customer eligibility, filtered searches, pagination and organisation isolation.
- `npm run test:conversion`: **58 native Node.js tests pass** across Stages 2–8 (the 48 earlier tests plus the 10 new tests).
- Syntax transpilation of changed TS/TSX files and YAML parsing of Compose were performed. No full npm dependency typecheck, running MySQL/Docker integration, JWT/SMTP end-to-end test or browser screenshot-based pixel comparison was possible in this environment. Those checks remain a preproduction requirement.

**Approval checkpoint:** Wait for the user's approval before implementing Stage 9 (Delivery Challans).
