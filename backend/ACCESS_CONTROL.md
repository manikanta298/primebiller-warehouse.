# Server access controls

The API now checks read roles before invoking protected routes. Hiding a UI page is not an authorization boundary. Warehouse assignments are loaded from active warehouses in the authenticated organisation on every request, so changing an assignment affects existing sessions immediately.

Owner and Manager retain organisation-wide administration. Accountant retains organisation-wide financial access; it is a head-office role, not a branch-limited role. Sales, Storekeeper and Driver are limited to assigned active warehouses. No assignments means no warehouse access. The company item/customer catalogue remains shared with roles permitted to use it; item stock/batches are filtered by warehouse. Local accounts cannot read bank/GSP settings, organisation notifications or unassigned documents/stock. Drivers see only warehouse-assigned challans matching their existing driver assignment.

Transfers can be sent from an assigned source to another active warehouse in the same organisation. The destination directory contains only id, code, name and active status. Receiving requires assignment to the destination; assignment to the source alone is insufficient. Owner/Manager can cancel transfers as before.

## Deployment

1. Back up the database. Verify `user_roles` and `user_godowns` exist. No schema change is necessary on a database using the current full schema.
2. If either table is missing, select the correct database in phpMyAdmin and import `db/migrations/003_access_control_tables.sql`. Its prerequisites are existing `users`, `orgs` and `godowns`; it does not change existing table definitions or any stored roles.
3. Sign in as Owner and use the existing Users screen's role selector and warehouse checkboxes to review active assignments before deployment. Do not promote branch staff to Owner/Manager/Accountant to work around a missing assignment.
4. Deploy the backend and frontend together. SQL alone cannot fix API access control.
5. Confirm an Owner sees all warehouses, a Storekeeper sees only assigned stock, a Sales user cannot read invoices/receipts through search, and a source-only Storekeeper cannot receive a transfer at its destination. Test in a separate test organisation with synthetic records.

## Verification and limits

HTTP regression tests use signed JWTs and a simulated database to exercise the real Express/auth/routes. They cover direct role bypass, warehouse filtering, cross-organisation rejection, changing assignments without changing tokens, transfer receipt denial, and a document-cache bypass. These are not live Aiven or browser tests. The SQL has been reviewed against the full schema but must be tested on a restored database before production import.

This change addresses role/warehouse authorization. It is not a complete security certification: live TLS/network grants, phpMyAdmin configuration, dependency auditing, durable sessions, import resource limits and stable driver IDs need separate review.
