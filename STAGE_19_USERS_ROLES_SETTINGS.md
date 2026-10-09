# Stage 19 — Users, Roles & Application Settings

**Review checkpoint. Do not start another screen until the user approves this stage.**

## Included screens

1. **Users & roles** (`/users`). Preserves the original seven-column user list, role-permission matrix, and drawer. Adds search by name/email/mobile, active/inactive/role filters, organisation-scoped queries, draft validation, cancel/unsaved-change warning, and a clear invitation workflow. Owner can update staff roles and assigned active godowns; cross-organisation users are not listed. The Owner cannot remove their own Owner role and the backend never permits removal of the organisation's last active Owner. Role and active-status changes revoke old JWTs through `token_version`.
2. **Numbering series** (`/numbering`). Preserves the eight document types, prefix/padding, FY-reset switch, last issued and next-number preview. Any issued document permanently locks changes to that type's prefix, digits or reset choice across all financial years. Express and document posting now both lock the `doc_series` row, preventing a configuration race. Unissued series remain editable.
3. **Settings** (`/settings`). Preserves Organisation, Financial year, Tax, Reason codes, and E-way bill provider tabs. Field validation includes GSTIN checksum, PAN/state matching, IFSC, account details, date/calendar range, positive numeric limits, reason codes and secret length. Settings are organisation-scoped, GSP secrets remain server-encrypted, and GSTIN changes are blocked once a tax invoice has been issued. The model's fixed ₹50,000 EWB threshold is still enforced server-side.

## Backend and database

- Modified `backend/src/routes/admin.ts` and `backend/src/uow.ts`.
- Shared validation lives in `src/lib/admin-rules.ts` and `src/lib/numbering.ts`. Copies in `backend/src/shared/` are generated using `node scripts/sync-shared.mjs`.
- Existing `users`, `user_roles`, `user_godowns`, `org_settings`, `orgs`, `doc_series`, and `doc_counters` tables are reused. **No new migration is required.**
- Demo store now isolates users, numbering settings, and its document-number counters by organisation. Demo GSTIN fixtures have valid check digits.

## Verify locally

```bash
cp .env.example .env
# Set DB credentials, JWT_SECRET, SETTINGS_KEY, SMTP details where appropriate.
docker compose up -d --build
```

Then sign in as an Owner, select an organisation and visit `/users`, `/numbering`, `/settings`. Test: create a user, copy the invite link and open it in a private browser; assign a godown; change their role and verify their prior JWT no longer works. Ensure the last active Owner cannot be demoted. Test each page after switching organisations. Issue a test document in an isolated database and verify its numbering series cannot be changed. Validate the GSTIN/PAN/IFSC and reason-code error messages.

Run rule/regression tests:

```bash
npm run test:conversion
```

## What is not yet complete / not verified

- Account invites are **manual links**, not automatically emailed by SMTP; the existing SMTP setup is for forgotten-password emails.
- No live Docker/MySQL integration, actual concurrency test, full application dependency build or pixel-by-pixel visual comparison was performed in this environment.
- Financial-year `closed` status is persisted, **but this release does not yet guarantee a universal posting lock** across every business workflow. Do not rely on that flag alone to close accounts.
- The configured GSP provider is stored securely, but it is not a live government e-way bill integration.
- For a production rollout: test password invitation links, all role transitions, entity isolation, database concurrency, local tax rules and backups in a staging environment.

**Stop at Stage 19 for approval.**
