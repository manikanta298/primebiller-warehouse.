# Stage 18 — Print Profiles & Document Printing

**Status:** Ready for user approval. Stop before Stage 19.

## Scope: the existing `/print-profiles` screen and document print paths

The two pre-existing print profiles retain their two-card layout and preview:

- **A — 80 mm thermal:** applied to the Print gate pass button at `/challans/:id`.
- **B — A4 tax invoice:** applied to the Print button at `/invoices/:id`.

Each profile controls copies (1–5), footer (at most 160 characters), whether to show a business initials mark, actual configured bank details on A4 invoices, per-HSN tax summary and signature text. A saved profile is fetched for the selected organisation and applied **at print time**. The main document details displayed in the app are untouched.

`src/components/app/PrintDocument.tsx` is the shared print-only renderer. It creates one real page per configured copy; each has its own Original/Copy N label. It uses the real document, saved organisation settings and GST amounts instead of the old illustrative invoice data. A cancelled document prints with a prominent cancellation warning, and test e-way bills are explicitly marked as unissued placeholders. The on-screen navigation, actions and dialogs are excluded from print. Named CSS pages request A4 or 80 mm media, but the user may need to select the correct paper size in the browser/printer settings.

The `/print-profiles` preview is **SAMPLE PREVIEW · NOT ISSUED** and any example prices are deliberately labelled as sample. It does not imitate a real invoice. The editor has validation, save, discard, dirty-state notice and role checks. QR output remains disabled because no trustworthy UPI/IRN QR payload or renderer exists. No fake QR is generated. An initials brand mark is used, not a user-uploaded logo image.

## Data/permissions

- Shared rules in `src/lib/print-rules.ts`, generated standalone backend copy in `backend/src/shared/print-rules.ts` and 10 new Node rule tests.
- `PUT /api/v1/print-profiles/:id` requires Owner or Manager. Zod requires the exact profile shape. The payload ID must match the URL, name/paper cannot be changed, 1–5 integer copies and footer content are checked, and missing or foreign-organisation profiles return 404 instead of fake success.
- Demo print profiles are now stored by `orgId`. Demo organisation settings are also isolated by `orgId` so switching organisations cannot print the wrong firm's GSTIN or bank details. The real API already scopes settings and profiles by authenticated organisation.
- No MySQL migration required; `print_profiles` stores the profile JSON, existing `org_settings` stores organisation printing details. Existing schema/migrations, Docker, JWT and SMTP remain included.

## Verification performed

- `node --experimental-strip-types --test tests/*.test.mjs`: **193/193 passed** (183 prior, 10 new).
- 9 modified/new TypeScript/TSX files: **syntax parsing passed**.
- Isolated dependency-free TypeScript typechecking of shared print rules and DTOs: **passed**.
- `compose.yaml`: parses; services include mysql, backend, frontend, gateway and mailpit.
- Source archive integrity and retention check performed during packaging.

**Not yet verified:** Full installed-dependency frontend/backend typecheck/build, a real Docker/MySQL run, print output in Chrome/Firefox/physical thermal printers, browser page-break and copy counts, and pixel-by-pixel comparisons with the original app. Full legal invoice compliance (including verified logos, customer address completeness, IRN/QR integration and hardware printer integration) needs further work before production deployment. Browser printing does not produce a server-rendered PDF.

## Manual review checklist

1. Login as Owner/Manager, open **Print profiles**. Adjust profile A and B separately, save, reload and verify saved choices. Verify invalid 0, fractional or 6 copies cannot be saved.
2. Switch demo organisations and verify the second firm's GSTIN, brand and bank are not inherited from the first organisation. Switch back and verify profile changes were retained only for the first firm.
3. Open a delivered or in-transit challan, **Print gate pass**. Inspect 80 mm width, date, actual customer/item/batches/vehicle, configured sections, footer and copy count. Print a cancelled challan and check its watermark.
4. Open an invoice, **Print**. Inspect A4 layout, invoice number, recipient, GST rate summary, totals, bank details if configured, signature and copy numbering. Cancelled invoices must print as cancelled.
5. Use the browser's print preview and select A4 or 80 mm paper. Verify page counts, repeated copy headers and that no app navigation, dialogs or action buttons leak onto customer copies.
6. Try saving a print profile as an Accountant or as a user of the wrong organisation; the backend should reject any unauthorised change.

**Approval checkpoint:** Await the user's approval before proceeding with the next screen.
