# Reference-style A4 invoices

Open an issued invoice, select **Preview invoice**, then **Print**. The preview and print use the same bordered A4 layout with blue section headings, business initials, Bill To / Ship To sections, invoice metadata, item/HSN/quantity/rate/taxable/GST/total columns, bank details, amount in Indian number words, GST totals, HSN summary, terms and signature area.

Configure the business name, address, phone, GSTIN, bank account, IFSC, terms and jurisdiction in organisation settings. Profile B controls initials, bank details, HSN summary, signature, number of copies and footer. Printing produces separate copies; it never multiplies amounts. The QR setting remains unsupported and no illustrative QR is printed. Image-logo uploads are not introduced.

New invoices snapshot customer address/city/PIN and phone at issuance. These fields are immutable alongside the invoice's existing financial fields. Existing invoices are not rewritten or backfilled using current party data. Their missing address is shown as not recorded. Shipping address, transport, payment mode and reverse-charge classification are not stored in the current invoice model, so the reference image's example values are not copied into real invoices. Ship To explicitly shows that the delivery address was not captured and lists linked challans.

Totals are taken from the saved invoice. Line taxable value and GST use the existing shared rules, including discounts. Payments/advances and balance are separate from invoice value. Quantities in different units are not added into a misleading subtotal. Cancelled documents have a prominent warning.

Print content is mounted directly on the document body so sidebar/layout containers cannot clip it. A4 tables have repeatable headers, rows avoid page breaks where possible, and each copy starts on a new page. The 80 mm/challan layout is retained. For browser Save as PDF, choose A4, disable browser headers/footers and leave scale at 100%. A screen preview can scroll horizontally on narrow phones without widening the application page.

Deploy the backend and frontend from this PR. No SQL migration is needed: optional snapshots use the existing invoice JSON body. Printing older invoices remains supported. Posted totals and stock are unchanged.
