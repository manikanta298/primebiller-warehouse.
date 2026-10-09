# Stage 17 — Reports & GSTR-1

**Status:** Ready for approval. Do not begin another screen without explicit approval.

## Delivered screen — `/reports`

The original four tabs and business layout are retained:

1. **GSTR-1 review:** five summary metrics, B2B, B2CL, B2CS, HSN summary and invoice document tables. HSN records now distinguish registered (B2B) vs unregistered (B2C) recipients (the May 2025 onwards reporting requirement). B2CL classification uses the August 2024 ₹1 lakh transition; earlier periods use the former ₹2.5 lakh threshold. Multi-rate B2CL invoices are combined by invoice number in the review JSON rather than duplicated.
2. **Sales register:** month-scoped issued/cancelled invoice reconciliation and CSV export. Cancelled invoices remain visible with status so the register can be reconciled against the document series.
3. **Receivables ageing:** current balances and four overdue age bands calculated against the India business date, excluding cancelled/fully paid invoices. This is a live receivables view, not filtered by the monthly selector.
4. **Item-wise sales and margin:** month-scoped quantity, HSN, taxable sales, cost and margin; cancelled sales are excluded. **Cost is calculated from today's item cost, not historical FIFO/COGS**, so the margin estimate is not a financial statement.

Each table has 25-row visual pagination, while CSV buttons export the full matching dataset. Month defaults to the current India business month (rather than a fixed test month); invalid year/month or reversed/invalid server date ranges are rejected. React Query report cache keys now include `orgId`, preventing organisation switches from reusing another tenant's cached reports. Both demo and MySQL providers enforce the report permission and organisation scope; demo item-cost lookups are org-isolated.

### Export safeguards

- **Do not upload the supplied GSTR-1 JSON directly to GST Portal.** The existing export is simplified: this stage marks it **REVIEW ONLY**, adds an explicit warning to the JSON and filenames, and corrects its B2CL multi-rate grouping and HSN B2B/B2C breakdown. It is *not* a validated official GSTN Offline Utility payload and does not cover credit notes, amendments, exempt/nil/non-GST, e-commerce, advances, reverse charge, or every required table.
- The GSTR-1 CSV is now a **single well-formed CSV with a `section` column**, not multiple incompatible CSV files concatenated with comment headers.
- CSV values escape delimiters/quotes/newlines and neutralise spreadsheet formula prefixes to reduce CSV injection risk, including in customer-provided names and notes.
- Data is retrieved from the existing invoices, document, party, item and cost tables. No new tables or migrations are needed. Original JWT, SMTP, Docker files and both MySQL migrations are included unchanged.

### References for tax-period rules

- [GST Portal GSTR-1 creation guide](https://tutorial.gst.gov.in/userguide/returns/Creation_of_Outward_Supplies_Return_in_GSTR-1.htm) — B2CL threshold since August 2024 and B2B/B2C HSN split since May 2025.
- [GST Portal returns offline tool troubleshooting](https://tutorial.gst.gov.in/offlineutilities/gsterrorandresolution/gstissuesandsuggestedsolutions.pdf) — validate payload against the current GSTN download schema rather than assuming a generated JSON is upload-ready.

## Verification

From the repository root, with Node.js 22:

```sh
npm run test:reports
npm run test:conversion
node scripts/sync-shared.mjs
```

- 15 Stage 17 pure report tests cover month and calendar validation, B2CL thresholds, GST tax splits, same-HSN recipient separation, document cancellations, JSON grouping, CSV safety and format, invoice ageing, item margins.
- **183/183** cumulative pure business-rule and regression tests pass across Stages 2–17.
- All seven changed/derived React/TypeScript files passed syntax parsing; Docker Compose YAML and archive contents verified.
- **Not yet verified:** dependency-installed `tsc`, running Express/MySQL Docker integration, live browser screenshot parity, GSTN Official Offline Utility acceptance, filing on the GST portal, and statutory correctness for all corner cases. Always reconcile exports against the actual invoices and a qualified tax professional before filing.

## Manual review checklist

1. Sign in with Owner/Manager/Accountant role; confirm other roles cannot access `/reports` or `/api/v1/reports/*`.
2. Switch organisations and verify all reports, totals and report downloads change accordingly; return to the previous organisation and confirm no leaked cached data.
3. In the GSTR-1 tab switch Oct 2026 / Aug 2024 / Jul 2024 and confirm B2CL threshold and recorded GST rows. Compare B2B vs B2C HSN sections, especially multiple invoices with the same HSN.
4. Create an invoice with multiple GST rates, cancel another eligible invoice and compare B2CL, GSTR-1 totals, sales-register status and documents-issued counts.
5. Inspect JSON: filename and `_notice` explicitly say it is review-only; do **not** upload it as a statutory return. Export CSV and verify a single header, section labels and quote/formula safety in Excel or Sheets.
6. Check receivables ageing with overdue dates, paid invoices and partial payments; review item margin notes about current, not historic, cost.
7. Confirm pagination with 26+ rows and that CSV still exports all rows. Compare the screen at desktop and mobile sizes with the original application.

**Next checkpoint:** Pause for Stage 17 approval before Stage 18 (Print Profiles & Document Printing).
