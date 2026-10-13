# Quotation entry and dispatch

Quotation entry and the printed quotation no longer show a warehouse. New quotations store an empty `godownId` in their existing JSON body; existing documents retain their warehouse reference. No SQL migration or existing-data rewrite is required.

Search customers by name, phone or GSTIN. Search active items by name, SKU or HSN. The native selectors support keyboard and mobile touch input. Searching retains the current selection. Blocked customers remain disabled.

Item availability is the sum of positive free stock (`onHand - held`) across the warehouse rows visible to the current user. Empty balances and fully held stock show **Out of stock**. Quotations can still include these items because they do not reserve stock. Availability is advisory and refreshed through the existing item query.

After customer acceptance, select the dispatch warehouse in **Sales Order dispatch**, then convert. The server checks that it is active, belongs to the organisation and is assigned to the user. Conversion retries return the same order. Sales Order confirmation continues to validate stock before reserving it.

## Tax calculation

The existing shared GST engine calculates taxable value after percentage discount, using item master GST rates. For ordinary domestic goods deliveries, the customer's configured state is used as the place of supply: the same state uses CGST and SGST, and a different state uses IGST. Line and document previews now use the same supply type, including when editing an existing draft and changing its customer. The backend overwrites submitted HSN, GST rate and item name from the item master and recomputes totals.

CGST, SGST, IGST and round-off appear separately. Existing engine rounding is preserved: taxable amounts and line GST to two decimals, document total to a whole rupee with a separate round-off adjustment. Issued quotations keep their recorded tax snapshot; conversion rejects changed item tax/unit or customer-state details.

This change retains the application's domestic goods model. SEZ/export, reverse charge, cess, special place-of-supply cases, UTGST distinctions and historical effective-date tax rates are not introduced by this change. Keep item master rates and customer delivery state correct; a quotation is not a tax invoice.

## Deployment

1. Merge the quotation form pull request.
2. Deploy the backend and frontend from the same revision. Deploy the backend first so it accepts warehouse-free quotation drafts and dispatch selection on conversion.
3. No database script is needed.
4. Test a same-state and a different-state customer, a stocked and an unstocked item, then accept and convert a quotation with a permitted dispatch warehouse.

## Sales Order confirmation fix

A loaded Sales Order line includes `id` and `deliveredQty`; these are response fields, not editable save-request fields. The editor now removes the persisted line ID when loading local form state and explicitly maps only `itemId`, `itemName`, `hsn`, `uom`, `qty`, `rate`, `discountPct` and `gstRate` when saving. This fixes both Save draft and Confirm & hold stock, which saves first. Keep the backend's strict line schema. Existing records and stock remain unchanged until normal confirmation succeeds.
