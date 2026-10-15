# Warehouse inventory isolation

## Behaviour

- On-hand, held, free stock, reorder and maximum levels, batches, stock ledger movements and moving-average inventory cost are warehouse-specific.
- Adding/removing stock in warehouse A writes only A's changed stock/batch rows. Warehouse B's quantities, reservations, costs and thresholds remain unchanged. No shared product quantity or global stock counter is updated.
- GRNs and positive adjustments calculate an average using only the receiving warehouse's quantity and cost. Negative adjustments use that warehouse's current cost. Stock operations no longer rewrite the shared item master cost price.
- Sales Order confirmation holds stock only in its selected warehouse; dispatch/reversal operates on the challan warehouse. Permissions and negative-stock/held-stock checks remain enforced.
- Explicit transfers are intentional movements: dispatch reduces the source, receipt increases the destination by the received quantity, and cancellation restores the source. Transfer line costs carry the source cost; receipt/cancellation averages it into only the receiving warehouse.
- The item master/catalogue is shared. Inventory quantity cards, catalogue stock status/exports and Find Items availability require selecting a warehouse. Item detail can show explicitly labelled per-warehouse rows without a combined balance. Quotation availability uses the warehouse selected in the top bar; quotations remain stock-neutral.
- The all-warehouses dashboard retains separately labelled warehouse values, while combined stock value/count cards are hidden. Stock ledger running/closing balance and estimated closing value require both one item and one warehouse. Organisation financial reports remain derived reports; no separate global stock balance is persisted or frozen.

## Storage and migration

`item_stock` retains its existing warehouse key. Add nullable `unit_cost DECIMAL(18,2)` for the warehouse moving-average cost. Existing rows, quantities, reservations, thresholds, batches, documents, audit events and stock history are preserved.

Legacy NULL costs read the existing item master default cost. The first subsequent receipt/positive adjustment calculates that warehouse's average from this opening baseline. Historical warehouse costs cannot be reconstructed from a previously shared average by this additive migration, so no historical revaluation is attempted. Explicit master cost edits are separate from stock movements.

The unit of work snapshots loaded items and persists only changed master/stock/batch rows. Reading an item during a transaction no longer rewrites it or every warehouse balance.

## Deployment

1. Back up the application database.
2. Merge this change and deploy the backend first. Its existing `npm run db:migrate` applies `backend/db/schema.sql`, including the idempotent column upgrade.
3. For manual phpMyAdmin deployment, select the existing application database and execute `backend/db/migrations/007_warehouse_stock_isolation.sql`. Rerunning is safe. It adds only the missing column and does not recalculate or overwrite existing data.
4. Deploy the frontend after the backend migration succeeds. No new environment variables are required.
5. Select warehouse A, add/remove a small test quantity, and verify A's balance/ledger. Switch to B and verify its balance, batch quantity, reservations and value are unchanged. Repeat after refresh.

Existing approval rules still apply to adjustments; a pending adjustment changes no stock until approval. Changes in one warehouse can alter a deliberately requested derived organisation report, but are never copied into another warehouse's balance or a global mutable stock record.
