# Quotation workflow and database autosave

## User workflow

1. Open Sales → Quotations → New quotation. This also resumes your unfinished new quotation for the signed-in user and organisation.
2. Enter customer, items, dates, notes and terms. After 1.5 seconds without a change, the form saves a personal work-in-progress draft to MySQL. Incomplete fields are allowed here. The screen distinguishes pending, saving, saved and failed states.
3. Click **Save draft** to validate and create/update the numbered quotation, or **Save & print quotation** to validate, save and immediately open the browser print/PDF dialog. Printing uses the server-returned quotation, not unsaved form values.
4. When the customer agrees, select a dispatch warehouse and click **Convert to Sales Order**. Confirm the acceptance prompt. There is no separate Issue quotation or Record acceptance step. Existing issued/accepted quotations still convert, and existing advances retain their links.
5. Confirm the resulting Sales Order separately to hold stock. Quotations, autosave and draft order creation do not reserve or reduce stock.

Saved quotation printing remains available. Expired/cancelled quotations cannot convert. Accepted/issued legacy quotations retain their existing read-only behaviour and accepted legacy quotation advances remain available. New order payments can be recorded through Receipts.

## Recovery and concurrent edits

Autosave is personal to `(organisation, user, quotation/new)`. Reopen an existing quotation or click New quotation to restore the last successful database draft. One unfinished new quotation is retained per user and organisation. It is not a numbered quotation until explicitly saved. Other users cannot retrieve personal drafts.

Writes are serialized in the browser and use optimistic versions in MySQL. A stale tab receives a conflict rather than replacing a newer draft. Reopen the quotation to load the current version before continuing. A failed save retains form values and shows Retry autosave. Leaving before persistence finishes displays a warning. Changes entered less than 1.5 seconds before closing may not have reached the database.

Explicit Save waits for an in-flight autosave. Final quotation persistence and clearing its recovery draft happen in one database transaction. A version tombstone prevents late requests from recreating an already-saved draft. Network failure never marks a draft saved. In demo/mock mode only, drafts use localStorage; the configured REST backend uses MySQL.

## Deployment and migration

1. Back up the database.
2. Deploy the backend first. Its existing `npm run db:migrate` reads `backend/db/schema.sql` and creates the new `quotation_drafts` table.
3. If applying SQL manually in phpMyAdmin, select the application database and run `backend/db/migrations/006_quotation_drafts.sql` once. It is safe to rerun; no existing rows, invoice data or document counters are altered.
4. Deploy the frontend pointing `VITE_API_URL` at the backend.
5. Test incomplete draft recovery after refresh, Save & print, direct conversion, and normal Sales Order confirmation.

No additional environment variables are needed. No real production migration or deployment is performed by this source change.

## API

- `GET /api/v1/quotation-drafts/:key`: personal `{ version, input }`, with key `new` or an existing quotation ID.
- `PUT /api/v1/quotation-drafts/:key`: `{ version, input }`; bounded typed input permits incomplete customer/lines, but rejects unknown/oversized fields. Returns incremented version. Owner/Manager/Sales only, with JWT and X-Org-Id; existing quotation warehouse access is enforced.
- Existing `POST /quotations` and `PUT /quotations/:id` accept optional `draftVersion` for atomic version-check/clearing. Normal quotation validation and server-authoritative item tax data remain required.
- Existing `POST /quotations/:id/convert` now permits active draft/issued/accepted quotations, records acceptance metadata if absent, validates current customer/item/warehouse and remains idempotent for retries.

Legacy issue/accept API endpoints remain for compatibility; the new UI does not call them.
