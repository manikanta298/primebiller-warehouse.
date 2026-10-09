# Stage 11 — Receipts & Advances (approval build)

**Approval checkpoint:** built on approved Stages 1–10. Stop after Stage 11 and obtain approval for the next screen.

## Screens

- `/receipts`: retains the original Receipts / Unused Advances tabs, the seven receipt columns (Receipt, Date, Customer, Mode, Reference, Against, Amount), and the five advance columns. Adds keyword search, chronological sorting, 25-row pagination, clear empty/loading/error states, and permission-aware New Receipt action.
- `/receipts/new`: retains customer, date, amount, payment mode, reference, invoice allocation and advance summary. Adds India business-date default/max, current-organisation customer filtering, tenant-safe invoice queries, exact-paise allocation, explicit duplicate/overpayment/date validation, one-click reset to oldest-first, loading/error states, disabled submission while stale queries refetch, confirmation when discarding edits, and an unload warning.

## Backend, business logic and security

- `POST /api/v1/receipts` accepts only the declared input fields (strict Zod payload), only for an organisation-owned party with a customer role. The authorised role is Owner/Manager/Accountant.
- The shared `src/lib/receipt-rules.ts` (generated copy in `backend/src/shared/receipt-rules.ts`) rejects invalid/future receipt dates, a receipt date before any allocated invoice, non-finite/zero/more-than-2-decimal amounts, invalid payment modes, missing noncash references, overly long references, unknown/closed/foreign invoices, overallocated lines, duplicate invoice IDs, negative/invalid splits, and aggregate allocation above payment amount.
- Auto allocation is **oldest first** by invoice date and id, using integer **paise** for exact remainder computation. An explicit array can allocate manually or leave the full payment as an advance.
- In Express, the invoice rows, customer row, the receipt number counter, the new receipt document, advances, sales order links, and customer receivables are updated inside **one MySQL transaction**. Validation happens **before receipt numbering**; all invoice balances are checked again with locked rows inside that transaction. A post failure rolls back every change.
- The Express list reads are role-protected and the `Uow` filters all documents by the JWT-selected organisation. Demo mode tracks and filters `receiptOrgIds` and `advanceOrgIds`, including the original seed records and newly posted documents. This also safeguards linked orders.
- The existing MySQL `receipts`, `advances`, `invoices`, `parties`, `sales_orders` and `doc_counters` schema supports all changes. **No new migration is required.** The full SQL schema, Stage 1 password-reset migration, JWT/SMTP setup and both Dockerfiles remain included.

## Manual QA / approval checklist

1. Visit `/receipts` and check both tabs, seven original receipt columns, five advance columns, search, pagination, empty states, and organisation switch (no cross-organisation records).
2. Select a customer, pick Cash/UPI/NEFT/Cheque, set a valid reference (optional for cash), and enter `₹100.30`; check the exact invoice allocation and remainder.
3. Test automatic oldest-first allocation and manually split one payment across several invoices. Exceed an invoice balance, repeat one invoice by direct API request, send a future/invalid date and make a receipt predate an allocated invoice; all must fail without posting.
4. Post a valid receipt and inspect the receipt row, invoice paid/balance/status, customer receivable, sales-order link, created unused advance and receipt-number sequence. Verify unallocated money creates an advance only and doesn't reduce the existing receivable.
5. Verify the unused advance can later be applied at invoice issuance (Stage 10). Test blocked historical customer balances where appropriate; supplier-only/transport-only parties are rejected.
6. Switch organisation with an active form and confirm the selected customer, invoices and manual amounts clear. Try lower-privilege JWTs directly against receipt lists, advance lists and receipt posting; expect forbidden.
7. Run `npm run test:receipts` and `npm run test:conversion`; verify Docker build and API against a live MySQL database, plus browser pixel-comparison with the original UI.

## Verification boundaries

- 13 Stage 11 native rule tests; 96 native regression tests across Stages 2–11 passed. TypeScript/TSX syntax parsing and Compose YAML verification performed. **A full dependency-resolving TypeScript check, live MySQL/Docker posting/rollback test, and browser pixel-perfect comparison have not been performed.**
- **Not implemented:** bank reconciliation and bank-statement import, cheque clearance/bounce lifecycle, refund/advance reversal, general-ledger posting, audit-grade printed receipt/PDF, and statutory tax compliance certification. For cheque entries, recording the receipt currently updates the receivable immediately; do not treat this as verified bank clearance in production.
- For deployment, review access control, transaction concurrency and decimal math under real MySQL load, and perform backup/restore and accounting sign-off before production use.
