# Stage 15 — Stock Adjustments — approval build

**Checkpoint:** Stages 1–14 have been approved. This delivery implements the Stock Adjustments screen/workflow only; Stage 16 is not started.

## Screens retained and improved

- `/adjustments`: original nine-column adjustment list with status chips for all, pending, posted and rejected; text search across document number/date, warehouse, reason, creator and status; 25-row pagination, loading/error/empty handling, role-aware create action and organisation-specific query caching.
- `/adjustments/new`: original godown/date/reason/notes header and item/direction/batch/quantity/cost grid. Only active godowns and active current-organisation items may be selected. The default warehouse is an actual active warehouse, not a fixed seed ID. Uses the current India business date and limits future dates. Displays held-aware free stock. Reason/direction restrictions, batch checks, price and quantity precision, value preview, pending-approval forecast, and error messages match the server. Adds Cancel/discard and unload warning.
- `/adjustments/:id`: original item rows, net up/down value, approval/rejection actions and audit history preserved. Queries are scoped to the active organisation. Only Owner/Manager can decide; rejection requires a reason. Posted documents link to the stock ledger.

## Business rules and security

- `src/lib/adjustment-rules.ts` and `backend/src/shared/adjustment-rules.ts` are generated/shared rules. Both the Express/MySQL implementation and demo-mode API use `adjustmentDraftProblems` and `adjustmentValue`. Dates must be real and non-future; selected warehouse and items must be active, quantities finite/positive with up to three decimals, stock-up unit costs positive with up to two decimals, and notes and batches length-limited. Maximum 200 lines.
- **All reductions are aggregated by item and by source batch** before validation. Available free stock is `onHand - held`; a gain on another line cannot mask an overdraw. Tracked write-offs require an existing batch belonging to the selected warehouse. Tracked found-stock adjustments can specify a new batch; unknown reduction batches are refused.
- Creating a posted adjustment or approving a pending Storekeeper adjustment updates item/batch balances, weighted-average cost for increases and stock-ledger audit rows in one MySQL transaction. MySQL uses the existing `Uow` item locks in stable ID order. Pending adjustments **recheck live stock and reservations at approval**, so stale stock cannot be depleted. A rejected/posted adjustment cannot be processed twice. Rejection notes are required and limited to 500 characters.
- Demo-mode seeded and created adjustments now have explicit organisation ownership. List, direct ID access, creation and decision paths check it. Server relies on per-request organisation-scoped MySQL queries and role permissions. The original approval limit remains organisation configurable (default ₹25,000; Storekeeper adjustments above that limit require Owner/Manager approval).
- Existing `adjustments`, `items`, `item_stock`, `batches`, `stock_ledger`, `doc_counters` and `org_settings` tables support Stage 15; **no new MySQL migration**. Existing Stage 1 SMTP/JWT and Stage 13 supplier-invoice migration and separate Docker files remain unchanged.

## Review checklist

1. As Owner/Manager/Storekeeper, create an adjustment; confirm visible actions and Storekeeper approval threshold. Verify other roles cannot access adjustment routes or API actions.
2. Change organisations and direct IDs; confirm demo and real API list/detail cannot expose foreign adjustments, items, warehouses, or batches.
3. Try a damaged/expired/theft write-off, found stock increase, correction up/down, and sample. Verify reason/direction mismatches are blocked.
4. Write off two lines for the same item and two for the same batch: combined demand must not exceed `onHand - held` or batch balance, including before approval. Try missing, nonexistent and wrong-godown batches.
5. Test inactive warehouses/items, future or impossible date, zero/negative/overly precise quantities, invalid cost, and 201 rows. Verify no ledger posting or document number consumption on invalid requests.
6. Submit Storekeeper adjustments above/below the configured value limit. Change stock/reservations after submission and verify approval revalidates the current state and blocks overdraw. Approve and reject a pending adjustment, then attempt a second decision.
7. Confirm posted stock and batch quantity movements, weighted-average cost on increases, audit event and `ADJ_IN`/`ADJ_OUT` ledger records. Compare list/detail/form layouts at mobile and desktop widths to the original source.

## Automated checks and limitations

- `npm run test:adjustments`: **16** Stage 15 rule tests (aggregated demand, reserved stock, batch rules, cost/quantity precision, date, role threshold, tenant filtering and search).
- `npm run test:conversion`: **154/154** automated rule and regression tests across Stages 2–15.
- Source changes passed TypeScript/TSX **syntax parsing**. `compose.yaml` parses. Stage 15 archive retains all Stage 14 files.
- **Not verified here:** installed-dependency full typechecking, live Docker/MySQL stock-transaction and concurrency testing, browser E2E tests, and pixel-perfect screenshot comparisons. These are required before production deployment.

**Stop for approval. Suggested Stage 16: Stock Ledger & Alerts.**
