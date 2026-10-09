# Stage 10 — Tax Invoices (approval build)

**Review status:** Stage 10 ready for source review, built on approved Stages 1–9. **Stop after this stage until the user approves.**

## Screens retained and enhanced

- **`/invoices`**: keeps all eight original columns (Invoice, Date, Customer, Challans, Due, Total, Balance, Status) and status chips. Adds keyword search over document, customer, challan and dates, a Cancelled chip, 25-row pagination, organisation-scoped React Query keys, and role-aware issue action.
- **`/invoices/new`**: preserves the original customer/challan picker, item preview, GST totals by supply type, due balance and oldest-first advances. Uses the current **India business date** and the active organisation's GST state (not a hardcoded Telangana code). Prevents issuing while advance data is loading, rejects duplicate/missing challans, mixed place-of-supply, mixed customers, invalid/future/backdated invoice dates, already-invoiced challans and nondelivered challans. The API revalidates on submit, not only the browser.
- **`/invoices/:id`**: keeps the detail, linked documents, GST-by-rate and received payments panels. Adds a print-specific A4 view with organisation name/GSTIN, hides navigation and action controls in print, and adds a confirmation dialog for permitted cancellations with an audit reason.

## Backend, tenancy and cancellation

- **`POST /api/v1/invoices`** is a strict payload validated by shared rules in both the Express API and mock. Missing or cross-organisation IDs reject the **entire** request. All challans must be delivered, unbilled, from the same customer and place of supply. A real calendar date not later than the India business date and not before any selected dispatch is required.
- The existing invoice-number counter is acquired and incremented **inside the MySQL transaction** that saves the invoice, applies existing advances, posts the receivable and links the delivered challans. No stock is deducted at invoicing: it was already posted by delivery challans.
- **`POST /api/v1/invoices/:id/cancel`** requires Owner/Manager/Accountant, a 5–500 character audit reason, no recorded payments, and an invoice dated **within the current India GST calendar month**. It never reuses invoice numbers. It restores applied advances, reverses the invoice's unpaid customer receivable, marks the invoice cancelled with `by`/`at`/`reason`, unlinks original challans for reinvoicing, and marks associated sales-order document links Cancelled. All of this is in **one locked DB transaction**. A second cancellation or missing linked record fails atomically. **It does not adjust stock**.
- Invoice list and detail reads are role-guarded in Express, and all SQL document reads are scoped by authenticated `org_id`. Demo mode now tracks explicit `invoiceOrgIds`; direct-detail reads, open invoices, advances, reports and invoice search do not expose other organisations. The cancelled invoice remains in GSTR-1 document-series totals but is omitted from taxable sales totals, using existing shared reports logic.
- The existing JSON-document storage and MySQL tables (`invoices`, `challans`, `sales_orders`, `advances`, `parties`, `doc_counters`) already support these changes: **no new SQL migration**. The full schema, earlier password-reset migration, Docker Compose, frontend/backend Dockerfiles, JWT and SMTP setup remain in this package.

## Critical production boundaries

- **Statutory e-invoicing/IRN** and live GST portal submission are **not implemented**; an A4 browser printout is not a signed IRN-generated invoice or a stored server-rendered PDF. If IRN generation is required, integrate an authorised provider and the applicable cancellation rules before use.
- **Credit notes/returns**, reversal journals and general-ledger posting are **not implemented in this stage**. A paid or prior-month invoice cannot be cancelled here; it needs a separately built and validated credit-note workflow. Do not treat this approval build as production accounting certification.
- Browser-level pixel-by-pixel design comparison, end-to-end React+Express+MySQL tests, real Docker build/run, real SMTP delivery and tax-expert verification still require a suitable running environment.

## Manual approval checklist

1. Visit `/invoices` with Owner/Manager/Accountant; check all eight original columns, search, chips, cancelled filter, pagination and organisation switching. A direct URL from a different org must not disclose the invoice.
2. Create/deliver a sales order and open `/invoices/new` from its challan. Check pre-selection, original line items, GST rate summary, advances oldest-first, Indian due date and balance due.
3. Try selecting the same challan twice by API, a missing/foreign ID, a mixed-customer or mixed-place-of-supply selection, and a future/invalid/date-before-delivery invoice. Every attempt must fail **without allocating a number**.
4. Issue a valid invoice; verify the counter advances once, challan becomes invoiced, advance remaining decreases, party outstanding increases by the net balance, and no stock ledger entry is added by invoice issuance.
5. Print an invoice: check A4 layout, company identity/GSTIN, customer, lines, tax summary and absence of app navigation. Verify cancel text prints prominently on a cancelled invoice.
6. Cancel a **current-month, unpaid** invoice with a valid reason. Verify advance restoration, receivable reversal, retained cancelled invoice number, linked SO's cancelled status, and returned challan eligibility. Repeat cancellation and verify rejection. Paid/prior-month cancellation must be blocked.
7. Verify frontend does not offer issuing/cancellation to Sales/Storekeeper/Driver. Attempt the API directly with a lower-privilege JWT; expect access denied.
8. Run `npm run test:invoices` and `npm run test:conversion`; check live MySQL transaction rollback by deliberately forcing a linked-record failure. Verify JWT expiry, SMTP and web/mobile pixel comparisons separately before production release.

## Automated checks

- **13 Stage 10 native Node tests** for selection safety, date/place-of-supply constraints, cancellation rules, tenant isolation, searching, advances and status/due-date computations.
- **83/83 total native regression tests** passing in `npm run test:conversion` (Stages 2–10).
- TypeScript/TSX syntax parsing and Compose YAML checking performed. No dependency-resolving typecheck or live MySQL/Docker/browser runs were possible here.
