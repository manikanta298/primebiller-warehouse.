# Stage 4 — Item Details / Edit screen review checkpoint

**Route:** `/items/:id`, reached from the Stage 3 Items List. **Scope:** the existing five-tab item detail screen and its PATCH API; no other screens are part of this approval stage.

## Implemented

- **Original layout retained:** Items breadcrumb, SKU/name/brand/HSN/GST heading, stock-ledger link (shown only to authorised roles), five summary KPIs, and the General / Tax / Units / Per godown / Batches tabs. No new route and no design rebuild.
- **General / pricing:** edit name, SKU, brand, category, sale price, cost price, batch tracking, negative-stock policy, and active flag. Invalid prices, empty names, excessive field lengths, and unsafe deactivation have explicit validation. Margin displays an em dash when the sale price is zero rather than `NaN`/Infinity.
- **Tax:** HSN requires 4, 6 or 8 digits. GST is limited to the application's existing choices (0/5/12/18/28%), with intra-state CGST/SGST and inter-state IGST previews.
- **Units:** base UOM can change only before inventory exists; alternate conversions can be added, removed, renamed or have factors edited, with positive/unique factors and a mandatory base factor of 1. Malformed older unit data can be repaired from the form.
- **Per godown:** shows current on-hand, held and free quantity, and allows owners/managers to edit only reorder/maximum thresholds, including for godowns with no stock row yet. Out/low/over-max statuses use free inventory for reorder alerts. Validation prevents duplicate/foreign godowns, negative thresholds and maximum less than reorder (when a max is configured).
- **Batches:** keeps the original read-only batch/heat table; expiry and age use the **current India business date** rather than a hard-coded fixture date. Batch records are not writable through the item form.
- **Unsaved changes:** Save is enabled only when something editable changed and validation passes; Discard restores last persisted data; a browser leave/reload warning is shown while dirty. API failures produce a toast without clearing the draft. React Query keys are per organisation and item, preventing a draft from another organisation appearing when switched.
- **Access:** Owner/Manager editing; Storekeeper/Sales/Accountant see a read-only detail view. Stock-ledger link appears only for a role authorised to access that screen.

## Backend and data guarantees

`PATCH /api/v1/items/:id` is role- and organisation-protected. The validated payload is strict: it **rejects** `id`, `batches`, `onHand`, `held`, and other unexpected keys. Only editable master fields and per-godown `reorderLevel` / `maxLevel` are accepted. Server checks that all godowns belong to the selected organisation, validates conversions and prices, and detects duplicate SKUs. Base UOM and batch-tracking changes are refused when there are balances, batches **or historical stock-ledger records**. Deactivation is refused if any balance or reservation remains. All item changes use the existing MySQL transaction and existing schema. No new migrations and no Docker changes are needed.

The local demo API (`src/api/mock.ts`) uses the same item-edit validation and prohibits item quantity/batch mutations so local review behaves like Express. Shared `src/lib/item-detail-rules.ts` is copied to `backend/src/shared/item-detail-rules.ts` via `node scripts/sync-shared.mjs`.

## How to review

1. Keep your existing Stage 3 `mysql_data` volume and update to the Stage 4 archive. Configure `.env`, then `docker compose up -d --build`. If new, follow `README.md` to create your first Owner and add/import sample items (the real MySQL database has **no demo records**).
2. Sign in as Owner/Manager, go to `http://localhost:8080/items`, select an item. Confirm the five tabs, KPIs and ledger navigation match the source layout.
3. Change sale price, HSN/GST, unit factors, and reorder thresholds. Confirm Save persists after reload, Discard restores baseline values, and an invalid input blocks saving with an actionable message.
4. Confirm a user without edit permission cannot change toggles or fields. Try editing item stock quantities/batches through the API: the PATCH must return validation errors.
5. In a second organisation, verify an item ID from the first organisation returns 404 and a godown ID from the first cannot be used in the PATCH of the second.
6. Check expired/near-expiry batch colours and ages against the current India calendar date, and visually compare desktop/mobile layouts against the original app screenshots.

## Checks run and limits

- `npm run test:conversion`: **21/21 native Node tests** (5 Dashboard, 6 Items List, 10 Item Details/Edit).
- TypeScript/TSX parser/transpilation checks passed for all modified React and Express files; regenerated shared business rules were checked.
- The project dependencies and Docker engine are **not installed** in this execution environment. No full frontend/backend typecheck, real MySQL transaction test, live Docker startup, or pixel-perfect screenshot comparison has been performed. Those checks are required before production release. The same existing Docker Compose setup, full `backend/db/schema.sql`, and SMTP password-recovery migration remain in the archive.

## Approval checkpoint

**Stop after Stage 4 — Item Details/Edit.** Request explicit approval before working on the next screen (suggested Stage 5: Units/Categories/Brands/HSN masters).
