# Chartered Accountant workspace

This module adds a distinct `Chartered Accountant` role. It is read-only and organisation-scoped. It does not grant access to every business on the server. Owner, Manager and Accountant can also open this workspace without changing their existing permissions elsewhere.

## Deployment and account setup

1. Merge this PR and deploy the backend/frontend. The existing startup `db:migrate` step expands the `user_roles.role` enum using its existing values. It retains current user IDs, roles, passwords and document data. The migration is conditional and safe to rerun; it may require a metadata lock while altering the enum.
2. For manual phpMyAdmin migration select the existing database and import `backend/db/migrations/20261012-ca-role.sql` as a complete file in one session. Do not replace existing user_roles or user tables.
3. Sign in as Owner, open Users & roles, and create/invite a user with Role=`Chartered Accountant`. Warehouse assignments are not required: CA audit access includes every warehouse in the assigned organisation. Existing users can be changed to the CA role by the Owner; the role change revokes their previous sessions.
4. Share the generated invitation link securely with the CA. They set their own password and sign in with their email. No shared/default CA password is introduced.
5. CA login opens `/ca`. Existing accounts should sign out/in after the upgrade so memberships include their current per-organisation role. Where an account already has memberships in multiple organisations, selecting an organisation updates its UI role; the server rechecks the actual membership on every request.

The current user-management flow creates one new account or updates an existing membership. It does not add an existing email from a different organisation to a new organisation automatically. Multi-client onboarding can use existing administratively established memberships; a dedicated cross-client invitation/grant flow is a separate enhancement.

## Read-only controls

- Every authenticated CA POST/PUT/PATCH/DELETE business request is denied centrally before mutation handlers run. Authentication/password-management endpoints remain available.
- The dedicated viewer exposes invoices, receipts, advances, quotations, sales orders, challans, purchase orders, GRNs, transfers, adjustments, items/current stock/batches, parties, warehouses, stock ledger, units, categories, brands and HSN masters.
- Only whitelisted business tables can be queried. Every list/detail query filters by the authenticated organisation; cross-organisation IDs return no record.
- Password hashes, invitation tokens, backend secrets and settings credentials are not exposed by this viewer.
- CA access cannot issue, post, settle, edit, cancel or delete documents. Existing backend protection of issued invoice identity, line items and financial/tax values remains in place for all roles. Authorised operational reversal/cancellation workflows for other roles are preserved.
- Deactivation and role changes revoke sessions; database memberships, not frontend role claims, authorise requests.

Direct database administration is outside this application permission boundary. Report checksums are integrity aids, not signed audit certification.

## Records and audit history

Choose a record type, use View record and page through the organisation's data. Detail views and JSON downloads show the stored record without edit controls. Invoice views also expose the existing issuance, settlement and cancellation audit history, including pagination and the historical-coverage notice.

## Downloads

Select a reporting month and download GSTR-1 summary, GSTR-3B summary or sales register as CSV/JSON. Exports use a repeatable-read database transaction and include organisation, period, generation time, generator version and a DRAFT_WORKPAPER notice. The response includes a SHA-256 checksum of the downloaded content. CSV generation escapes formula-looking strings. Responses are not cached, and the UI discards a completed export if the selected organisation has changed.

GSTR-1 uses the current application's outward invoice/rate/HSN and cancellation register builder. GSTR-3B uses posted invoice tax components and positive-rate taxable values, plus an inter-State unregistered-customer supporting summary. Cancelled and other-period invoices are excluded from outward totals. Zero-rate taxable values are shown as unclassified for review.

These are audit supporting workpapers, not complete return files. GSTR-3B's eligible ITC, RCM, reversals/reclaims, exports/SEZ, exempt/non-GST supplies, cess, tax payments and interest are not derived from the current data model. They are marked null/PENDING_REVIEW, not zero. GRN tax is not assumed to be eligible ITC. Credit/debit notes, amendments, advance-tax treatment and GST Portal adjustments need additional review. Reconcile against books and portal statements before filing; no return is submitted by this module.

## API

Send Bearer authentication and X-Org-Id to these read endpoints:

- `GET /api/v1/ca/overview`
- `GET /api/v1/ca/records/:collection?after=<cursor>&limit=30`
- `GET /api/v1/ca/records/:collection/:id`
- `GET /api/v1/ca/invoices/:id/audit?after=<cursor>&limit=50`
- `GET /api/v1/ca/reports/gstr1/export?period=YYYY-MM&format=csv`
- `GET /api/v1/ca/reports/gstr3b/export?period=YYYY-MM&format=json`
- `GET /api/v1/ca/reports/sales/export?period=YYYY-MM&format=csv`

Export responses contain filename, MIME type, content, checksum and metadata; the frontend downloads the content as a file. There are no CA mutation endpoints. The workspace requires the configured Express API; it does not emulate CA data in demo/mock mode.
