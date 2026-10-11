# Masters and test records

Sign in as Owner or Manager and select the correct organisation. Create active Units, HSN rates, Categories and Brands in Masters, then Warehouses, Parties and Items. Use existing units instead of creating duplicate codes. These sample values are for testing only; the numeric HSN codes and GST rates below are arbitrary fixtures, not tax classifications for real goods.

## Units

| Code | Name | Kind | Decimals |
| --- | --- | --- | --- |
| PCS | Piece | count | 0 |
| KG | Kilogram | weight | 3 |
| MTR | Metre | length | 3 |
| BOX | Box | count | 0 |

## HSN & GST rates

Set Active=true, Cess=0 and Effective from=2026-10-11 for these test rows.

| HSN | Description | GST % |
| --- | --- | --- |
| 1001 | TEST Tax A | 0 |
| 1002 | TEST Tax B | 5 |
| 1003 | TEST Tax C | 12 |
| 1004 | TEST Tax D | 18 |

Published HSN code, effective date, GST and cess values cannot be edited. Add a new dated rate for a tax change. Existing items retain their stored GST rates; review affected items separately.

## Categories and brands

Leave parent category empty and set Active=true.

| Category | Default HSN | Default GST % | Brand (separate Masters tab) |
| --- | --- | --- | --- |
| DEMO Category A | 1001 | 0 | DEMO Alpha |
| DEMO Category B | 1002 | 5 | DEMO Beta |
| DEMO Category C | 1003 | 12 | DEMO Gamma |
| DEMO Category D | 1004 | 18 | DEMO Delta |

## Warehouses

Create manually with New warehouse. Set State code=36, GSTIN=NA, Active=true and use a test address such as “TEST ONLY, Hyderabad”. Managers/default salespeople can be left unset. Warehouse bulk import does not include the GSTIN field; use Edit afterwards if importing.

| Code | Name | Type |
| --- | --- | --- |
| TWH1 | TEST Main Warehouse | godown |
| TWH2 | TEST Counter | shop_counter |
| TWH3 | TEST Yard | yard |
| TWH4 | TEST Secondary Warehouse | godown |

## Parties

Set State code=36, test address “TEST ONLY, Hyderabad”, GSTIN empty, phone empty and outstanding balance=0. Party GSTIN accepts an empty value; the warehouse NA option is not a party GSTIN value. Use these reserved example email addresses if needed.

| Name | Type | Email | Credit limit | Credit days |
| --- | --- | --- | --- | --- |
| TEST Customer One | customer | test-customer@example.com | 10000 | 30 |
| TEST Supplier One | supplier | test-supplier@example.com | 0 | 30 |
| TEST Trading Party | both | test-trading@example.com | 10000 | 30 |
| TEST Transporter | transporter | test-transporter@example.com | 0 | 0 |

## Items

Use Items → Import items. Download the current template and preserve its column headers; fill these four rows, upload, validate and commit. Set Active=true. Base unit conversion is one unit to itself (factor 1); bulk import creates this automatically. Do not add opening stock to test deletion.

| SKU | Name | Category | Brand | HSN | GST % | Base unit | Sale price | Cost price |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TEST-001 | TEST Item A | DEMO Category A | DEMO Alpha | 1001 | 0 | PCS | 100 | 80 |
| TEST-002 | TEST Item B | DEMO Category B | DEMO Beta | 1002 | 5 | KG | 200 | 150 |
| TEST-003 | TEST Item C | DEMO Category C | DEMO Gamma | 1003 | 12 | MTR | 300 | 220 |
| TEST-004 | TEST Item D | DEMO Category D | DEMO Delta | 1004 | 18 | BOX | 400 | 300 |

## Edit and delete

Warehouse cards and Item/Party list rows expose Edit and Delete. Edit opens the existing editor. Delete requires Owner/Manager permissions and explicit confirmation. Sales can retain their existing permitted party editing but cannot delete records.

Delete succeeds only for unused records. The backend rejects stock, held reservations, batches, stock ledger history, outstanding party balances, warehouse user assignments and references in any existing document, including drafts and cancelled documents. Used items/warehouses should be made inactive when eligible; used parties can be blocked. No existing documents are removed. Only unused zero-balance stock/threshold rows are removed along with an unused item/warehouse, within the same transaction.

For a quick check, create a spare TEST item, edit its name, then delete it before using it in a transaction. Use a different test item in a quotation and confirm deletion is refused.

## Deployment

No SQL migration or schema alteration is required for these changes. Merge the feature PR and redeploy both backend and frontend together. Keep the existing database and its data. No sample records are automatically inserted by this change.
