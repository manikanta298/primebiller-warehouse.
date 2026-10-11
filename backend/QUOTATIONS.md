# Quotations

Owner, Manager and Sales can create, issue, accept and convert quotations. Accountant can view/print quotes and record advances. Sales sees only quotes in assigned active warehouses. Financial payment posting still requires Owner, Manager or Accountant.

## Deployment

1. Merge PR #8 (server/warehouse access) first; this feature is based on that security branch.
2. Back up the application database. Select it in phpMyAdmin and import `db/migrations/004_quotations.sql`. It requires the existing base schema and creates only `quotations` and `quotation_counters`. Existing records and numbering series are untouched. New installations can import `db/schema.sql` instead.
3. Deploy the backend and frontend together. `npm run db:migrate` also creates these tables from the updated schema; rerunning the additive migration is safe.
4. In Sales → Quotations create a draft with customer, warehouse, items, validity, notes and terms. Save, then issue it. Print / Save PDF uses the browser print dialog (A4). Draft and cancelled copies are labelled. Quotes are not tax invoices.
5. Record customer acceptance. Payment is optional. Finance staff can record a quotation advance before conversion; this is a numbered receipt entirely earmarked to the quote, not an allocation to old invoices. Amounts cannot exceed the quote total. Review the recorded receipts before posting another payment.
6. Convert to a draft Sales Order. Confirm that order to check and reserve stock, dispatch via delivery challan to reduce physical stock, then invoice the delivered challans.
7. Quote advances apply automatically to invoices containing the linked order, before optional general advances. Advances belonging to other quotes are excluded. A partial invoice consumes only the required amount. The remaining advance stays linked to the same order. Cancellation restores applied advances using the existing invoice cancellation rules.

## Safety and limits

The quote is row-locked inside one transaction for acceptance, advance posting and conversion. Concurrent conversion/retries return its existing order. Advance retries with the same request key return the existing receipt; changing details under that key is rejected. The UI retains its retry key while a request outcome is uncertain. Review Receipts after a browser refresh or uncertain network result before posting a new payment.

Saving/accepting/converting quotes does not change stock quantities, stock holds or customer outstanding. HSN, tax rates and units come from the item master. Conversion refuses changed item tax/units or customer supply state, inactive warehouses, blocked customers and expired quotations. Actual GSTIN validation is unchanged; warehouse NA support is preserved.

Customer and warehouse cannot be changed on an order originating from a quotation. A quote with recorded advances cannot be cancelled; refunds/reassignment are not part of this feature. Cancelling its Sales Order leaves the advances earmarked for finance reconciliation, rather than silently spending them on another sale. General receipts after conversion use the existing receipt workflow. Acceptance is a staff-recorded customer decision, not a public customer portal or digital signature.

Migration SQL was reviewed, not run on live Aiven. Integration tests use an in-memory query harness; production MySQL concurrency and live PDF/browser output still need deployment smoke testing. Full frontend typecheck currently has 50 pre-existing errors (same count and messages as the security base); this feature adds none.
