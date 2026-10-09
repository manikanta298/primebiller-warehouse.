# Stage 7 — Parties / Customers & Suppliers

**Review status:** awaiting approval. **Screens:** `/parties` and `/parties/:id` (including new party). Continues the approved Stage 6 baseline. Stop after this stage until the next approval.

## What was delivered

- Preserves original **Parties** heading, six-column list (Party, GSTIN, State, Credit limit, Outstanding, Headroom) and the four main edit-form sections (Identity, Contact & address, Credit, Status).
- List searches across name, trade name, GSTIN, PAN, location, email and phone, filters by customer, supplier, customer-and-supplier, transporter, and blocked/unblocked; dual-role parties appear under both customer and supplier filters. Search, filters and results reset when the active organisation changes. Related sales/purchase/receipt party selectors now also partition their query caches by organisation.
- New-party navigation is shown only for permitted roles. Owner/Manager/Sales can edit; Accountant can inspect party details in read-only mode. Edit forms include Cancel/discard confirmation, reload warning for unsaved edits, Ctrl/Cmd+S, field errors, and backend errors.
- Identity: normalised legal name, trade name, PAN/GSTIN; GSTIN checksum must be valid and match PAN and state. Contact: phone, email, billing address, city, state, six-digit PIN. Customer: credit limit, credit days and read-only outstanding, headroom and terms. Supplier: editable payment terms and read-only payable/outstanding summary. Blocked status controls selection in new business documents.
- Finance balances are intentionally **not editable** in the master form; posted invoices, receipts and purchasing documents maintain `outstanding` separately.

## Backend + MySQL

- Existing `/api/v1/parties` list/detail/create/update routes use the JWT session's organisation and permission. A strict input schema rejects client-supplied `orgId`, `outstanding`, `stateName`, and other unknown fields.
- POST disallows a caller-specified party ID; PUT disallows mismatched URL/body IDs and returns 404 for other-organisation or unknown IDs. Update uses `WHERE org_id = ? AND id = ?` and changes **only editable master columns**, preserving any existing outstanding balance.
- All writes validate the same shared rules used in React and demo mode, plus a current-organisation GSTIN uniqueness check. MySQL's existing `UNIQUE (org_id, gstin)` index prevents concurrent duplicates. Unregistered parties can have NULL GSTIN.
- Demo data now has explicit organisation ownership. The original parties belong to `org1`; an isolated example is supplied for `org2`. Party listing, ID lookups, edits and duplicate checking respect that ownership.
- Uses existing `backend/db/schema.sql` and existing Docker Compose infrastructure. **No schema migration is required for Stage 7.** No existing table or data is reset.

## Test / review steps

1. Copy `.env.example` to `.env`, set strong DB/JWT/encryption secrets and run `docker compose up -d --build`; create an Owner account on fresh databases using the README's `setup:owner` instructions.
2. Sign in to `http://localhost:8080/parties`. Check six columns and customer/supplier/both/transporter tabs; search multiple words and test blocked/unblocked filter. Check no results, empty catalogue, mobile table scroll.
3. As Owner/Manager/Sales, create an unregistered customer and a registered supplier. Test GSTIN auto-PAN and state fill; incorrect checksum, PAN or state, invalid email/PIN, negative credit, 3-decimal credit amount, non-integer credit days, empty name and excessive lengths. Verify validation prevents saving.
4. Edit a party, change details, save, reload and verify persistence; check supplier payment terms. Try Cancel and refreshing with unsaved edits. Test Accountant read-only and unauthorised API writes.
5. Create the same GSTIN within one organisation (should reject); repeat from another organisation (allowed). Try a GET or PUT to another organisation's party ID (must return 404). Attempt POST/PUT with `outstanding`, `orgId` or a mismatched ID (must reject).
6. Verify existing invoices/receipts and the supplier's outstanding balances are unchanged by master edits.

## Verification status and limitations

- `npm run test:conversion`: **48/48** native Node tests pass, including **9 new party-rule/ownership tests** and all 39 tests from Stages 2–6.
- TypeScript/TSX syntax transpilation passes for all modified modules; Docker Compose YAML parses; the existing MySQL `parties` schema has the required columns and per-org GSTIN uniqueness index.
- **Not verified here:** full dependency typechecks, Docker/MySQL execution, role/login integration against a live server, SMTP delivery, browser E2E checks, or pixel-accurate screenshot comparisons. A deployed environment is needed for those checks before production sign-off.

**Approval checkpoint:** Do not start Stage 8 until the user approves Stage 7.
