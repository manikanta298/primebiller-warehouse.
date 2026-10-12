# Invoice audit foundation — phase 1

This change adds invoice-number validation and transactional audit history to the existing single-organisation billing model. It does not implement multiple GST registrations, delegated CA grants, general-ledger accounting, GST return filing or GSTR-2B reconciliation.

## Database migration and deployment

1. Back up the existing database using your normal backup procedure.
2. In phpMyAdmin select the existing application database, then run `backend/db/migrations/20261012-invoice-audit.sql`. It creates one new table and optionally records the current state of historical invoices. It does not update invoice numbers, invoice bodies, stock, balances or counters.
3. Deploy the backend. `npm --prefix backend run db:migrate` also creates the audit table through the main schema; the standalone migration additionally seeds historical baselines. The audit table must exist before invoice writes run.
4. Deploy the frontend to use the same series validation.
5. Issue a test invoice in your test organisation and read the audit endpoint. Verify receipt allocation and cancellation create further events while retaining the invoice number.

The script may be rerun; the unique baseline marker prevents duplicate baselines. A baseline's timestamp is the migration timestamp. Its actor is unknown and its checksum is null. It is not reconstructed issuance history. If invoices already have post-deployment audit events, no baseline is inserted for them.

No live database migration is performed by opening the PR. The SQL must be validated in your staging MySQL database before production deployment.

## Numbering

The existing `doc_series` and `doc_counters` remain authoritative. Both are locked inside the existing posting transaction. The existing unique `(org_id, number)` index on invoices is retained. Draft/future enterprise numbering is not introduced here.

New invoice numbers must contain only letters, digits, hyphens and slashes and be at most 16 characters. The actual generated number is checked before updating the counter, including counter growth beyond configured padding. New invoice-series configurations must leave enough space for the existing five-character financial-year label and two separators. A prefix of INV with five digits creates `INV/26-27/00001`.

Existing invoice numbers remain untouched, even if historical numbers exceed the limit. Such invoices can still be settled or cancelled. An already-issued invalid/overlength series is locked by the existing settings policy: it requires a controlled series-remediation migration before further issuance, not direct historical renumbering. Review your INV configuration before deploying.

## Immutable financial fields

Before saving an existing invoice the backend locks and reads its stored snapshot. Identity, issue/due dates, customer/tax identity, supply classification, linked challans, lines, tax amounts, rounding, total, rate breakdown and original creator cannot change. Existing payment/advance settlement and cancellation workflows remain supported.

New issue, settlement change and cancellation events are saved with the same MySQL transaction as the invoice and related changes. Failure to save audit history rolls back the write. There is no audit update/delete API. Direct database administrators can still alter data; these checksums are integrity aids, not external signatures or a tamper-proof audit certification.

## Read API

`GET /api/v1/invoices/:id/audit?after=0&limit=50`

Send `Authorization: Bearer <token>` and `X-Org-Id: <existing-org-id>`. Only Owner, Manager and Accountant roles have access. The invoice must belong to that organisation. This is existing Accountant access, not delegated CA-firm access.

The response includes `invoiceId`, `currentSnapshotHash`, `events`, `nextCursor` and a history-coverage explanation. Each event has a string ID, event type, actor ID/name, timestamp, before/after snapshots and a SHA-256 checksum of canonical after-snapshot JSON. Baselines have an unknown actor and null checksum. The default page size is 50 and the maximum is 100. Use the returned cursor rather than arithmetic on BIGINT IDs.

Example event types: `baseline`, `issued`, `settlement_updated`, `cancelled`.

## Subsequent phases

Map organisations and warehouses to GST registrations without renumbering history; add document-version/idempotency contracts and relational tax snapshots; implement balanced journals; then introduce scoped CA grants, purchase/2B reconciliation and frozen return approvals. These require separate reviewed migrations and deployment checks.
