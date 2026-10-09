# Stage 5 — Units, Categories, Brands & HSN Masters

**Screen:** `/masters` (four existing tabs on one screen). **Status:** ready for approval. Stage 1–4 code is retained unchanged except for the shared master-service paths needed by this screen.

## What changed

- **Layout preserved:** Original Masters heading, Units/Categories/Brands/HSN & GST tabs, existing table column structure, row-to-edit interactions and add/edit dialog. Added a compact search field and active/inactive filter shared across the tabs; filters reset when the tab changes. Matching records can be edited by mouse or keyboard.
- **Units:** validates trimmed uppercase unit codes, name, known kind (count/weight/length/area/volume) and integer decimal places 0–4. Prevents invalid writes on the server, in the demo backend and in the modal.
- **Categories:** names, default HSN and GST must be valid. Parent category must belong to the active organisation. Cyclic hierarchies cannot be saved. Nested hierarchies and orphaned legacy categories are displayed rather than silently dropped; the parent selector supports nested parents.
- **Brands:** name validation, case-insensitive duplicate detection and active toggle.
- **HSN/GST:** validates 4/6/8-digit HSN, valid ISO calendar effective date, supported GST and 0–100% cess with two decimal places. Rate changes are new date-effective records; editing an existing record permits description/active-state changes but not historical code/rate/date revisions. The existing **Add new rate from a date** action creates a new record (without changing the prior one). Defaults to India-local business date.
- **Forms:** inline issues disable Save, validation also runs on the server, Cancel/close confirms discarding unsaved edits, and errors remain visible without closing the dialog.
- **Isolation/security:** React Query data is cached separately by organisation; the demo API now scopes master records to the selected organisation. Express always verifies that an edited ID and any parent ID belong to the current organisation, prevents creating with an injected ID and refuses unexpected form fields. Updates target the current organisation explicitly; no cross-organisation `ON DUPLICATE KEY UPDATE` is used.
- **MySQL:** existing `uoms`, `categories`, `brands` and `hsn_rates` tables (including org-scoped unique constraints and date-effective HSN uniqueness) are used unchanged. Date and MySQL DECIMAL values are normalised in responses. No migration was needed. Docker configuration and all earlier SQL scripts remain packaged.

## Review

1. Extract the ZIP; keep the existing MySQL volume when updating. From the project root, copy `.env.example` to `.env`, set passwords and secrets, then run `docker compose up -d --build`. Existing Owner setup instructions remain in `README.md`.
2. Sign in as Owner or Manager and visit `http://localhost:8080/masters`. Verify four tabs and their original column layouts. Search, use the status filter, open/edit/create each kind, save and refresh.
3. Try invalid codes/decimal places, duplicate names, a category as its own descendant, and editing an existing HSN GST rate. Each should show a validation message. Use **Add new rate from a date** to add a new GST rate while preserving the old dated row.
4. Switch organisations: records from the original organisation must not be visible, and attempting a PUT of its ID under the second organisation must return 404. A parent category from the first organisation must be rejected in a second-organisation category.
5. Confirm an unauthorised role is blocked from `/masters`, and backend writes require Owner/Manager. Compare the tab/dialog layouts at mobile and desktop widths to the uploaded source.

## Checks and limits

- `npm run test:conversion`: **32/32 tests** across Dashboard, Items List, Item Details/Edit, and Masters (11 new Masters rule tests).
- `npm run test:masters`: 11 new native Node tests for units, date validation, nested category parents, cycle prevention, HSN immutability, filtering, and India business dates.
- TypeScript parser/transpilation completed for the changed TS/TSX files. A standalone TypeScript semantic check of `src/lib/master-rules.ts` completed successfully.
- The full dependency graph is not installed in this execution environment and there is no Docker engine here. Full frontend/backend typechecking, actual MySQL transactions, SMTP end-to-end execution and browser/pixel comparison were **not** run. Docker and MySQL should be tested in the user's environment before production use.

## Checkpoint

Stop here and request approval before Stage 6. Other screens remain as delivered through Stage 4 or in the original source.
