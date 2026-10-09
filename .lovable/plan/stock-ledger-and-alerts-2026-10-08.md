# Stock ledger and Alerts

## Stock ledger (/stock-ledger)
- Filters: item, godown (follows top-bar godown), batch, movement type, date range, document no. Synced to the URL so a filtered view can be shared or opened from Item detail ("View ledger").
- Opening balance row for the chosen range, then every movement: date/time, document, item, batch, type, in, out, running balance, unit cost, value, user.
- Totals strip: opening, total in, total out, closing, closing value.
- Export CSV of the filtered rows. Sales order documents link to their page; others show as plain numbers until those screens exist.
- Empty, loading and error states.

## Alerts (/alerts)
- Tabs: All, Out of stock, Below reorder, Near expiry, Over-aged (with counts).
- Grouped by godown, each group showing value at risk and alert count.
- Near-expiry and over-aged rows are per batch: batch no., expiry date or age in days, qty, value at risk. Stock alerts show free qty vs reorder level and suggested shortfall.
- Acknowledge per row and "Acknowledge all" per tab; acknowledged alerts hide behind a "Show acknowledged" toggle. Notification bell count reflects unacknowledged alerts.
- "Create PO / Transfer" buttons shown but disabled with a "coming next" note.
- Default windows: near expiry 45 days, over-aged 180 days (from the spec).

## Data
- Mock ledger generated from existing items and batches (opening, purchase in, transfers, challan issues, adjustments) so balances reconcile with current on-hand stock.
- Alerts computed from current stock and batches, with acknowledgement remembered for the session.

## Technical details
- New types `LedgerEntry`, `LedgerFilter`, `StockAlert`; client/mock functions `getStockLedger`, `getAlerts`, `acknowledgeAlert(s)` mirroring `/stock/ledger`, `/alerts`, `/alerts/:id/acknowledge`, `/alerts/acknowledge-all`.
- Rules (running balance, opening row, alert classification with 45/180-day windows, value at risk) in a new `src/lib/stock-rules.ts`, covered by `src/test/stock-rules.test.ts`.
- Dashboard near-expiry/over-aged/low/out KPI cards link to the matching Alerts tab; Item detail gets a "View ledger" link.
- Update roadmap.md.
