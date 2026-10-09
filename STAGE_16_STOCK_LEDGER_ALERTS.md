# Stage 16 — Stock Ledger & Alerts

**Status:** Ready for approval. Continue to another screen only after explicit user approval.

## Delivered screens

### `/stock-ledger` — Inventory movement history

- Preserves the original page layout: item/godown/batch/type/date/document filters, five KPI cards, movement table and export.
- URL-based filters permit direct navigation from Items, Adjustments and Alerts. Item and godown queries are scoped to the signed-in organisation; an `all` godown is normalized before the REST request.
- Real movement balances are computed from **all** posted movements in a selected stream. Type/document filters affect displayed rows and displayed movement totals but **never** the actual opening, running or closing balance. The opening balance includes *all* records before the From date; To date limits the physical closing state.
- When no item is selected, mixed-unit balances and running balances display dashes instead of misleading sums. Estimated closing value uses current item cost, not historical purchase valuation.
- 25-row pagination is for presentation only; CSV exports **all filtered rows**, escapes delimiters and quotes, and neutralizes spreadsheet formula prefixes. Date-range validation and error/empty states remain visible.
- Server checks role (Owner, Manager, Storekeeper or Accountant), item and godown ownership, and returns up to 5,000 ledger rows for a requested item/godown/batch stream. Larger results produce an explicit 422 (`ledger_too_large`) to avoid silently misrepresenting the account. Narrow the stream further to view its complete history. All records are ordered by `at, id`.

### `/alerts` — Stock and batch risk

- Retains Out of stock, Below reorder, Near expiry and Over-aged tabs, value-at-risk groups and acknowledgement indicators.
- Adds search across item, SKU, batch and godown, plus godown selection and organisation-scoped query cache. Groups use godown ID, not just name, to avoid merging warehouses that share a name.
- Free quantity is `onHand - held`, reorder shortfall reflects free rather than on-hand stock, and zero free stock is alerted even without a configured reorder threshold. Expiry is within 45 calendar days and aged batches are over 180 days old.
- Only valid, currently active alert IDs for the signed-in organisation can be acknowledged. Backend and mock both enforce Owner/Manager/Storekeeper access, and the backend limits a single bulk acknowledgement request to 500 IDs. Acknowledge all applies to alerts visible under the active tabs/search/godown selection.
- Owner/Manager get a working **Create PO** link; Owner/Manager/Storekeeper get a working **Transfer** link for stock-level alerts. These actions launch existing forms and do not automatically create transactions.

## Automated verification

Run from repo root:

```bash
npm run test:ledger-alerts
npm run test:conversion
node scripts/sync-shared.mjs
```

- **14** Stage 16 tests for filtered running balance, dates, document matches, item/godown/batch scope, CSV escaping and alert computation.
- **168/168** shared-business-rule regression tests across Stages 2–16.
- Seven changed/derived TS/TSX files were syntax parsed (not a dependency-aware typecheck).
- Docker Compose syntax and final ZIP contents were checked; existing Docker setup, database schema, migrations, JWT and SMTP are included.
- **Not performed:** live MySQL/transaction concurrency integration, Docker boot, installed-dependency TypeScript checks, browser end-to-end, or pixel-level screenshot parity. For production, test these separately against a restored copy of real data.

## Reviewer checklist

1. Open Stock Ledger with all godowns. Filter one item and one godown; verify balance vs the on-hand stock and include an opening transaction.
2. Set a From/To date and a type or partial document number. Displayed records must change, but running/closing figures must reflect hidden movement types too. Reverse the date range to see validation.
3. Pick a batch or a second godown; verify different streams cannot contaminate the balance. Clear all filters, paginate and export CSV. Verify filtered export includes all results, not only the current page.
4. Create over 5,000 ledger rows and verify a clear narrow-your-search error, not a silent first-page balance; narrow to one item/godown/batch.
5. Create stock below reorder, stock held entirely by reservations, zero stock with reorder=0, near-expiry and old-batch examples. Check quantity, shortfall and value-at-risk.
6. Filter alerts by godown, search by SKU/batch and acknowledge one or visible group. Verify cross-org direct IDs and unauthorized roles cannot fetch or acknowledge alerts through the REST API.
7. Confirm Create PO and Transfer links only appear for authorized roles and do not create transactions automatically; compare desktop and mobile layouts with the original app.

**Next checkpoint:** Pause for user approval before a Stage 17 screen.
