# Search and Find Items

Customer, supplier and item selectors now offer suggestions after two characters. Matching ignores case and prioritises names beginning with the typed text. The matching text is highlighted, and the first eligible suggestion is highlighted automatically. Use Enter to choose it, arrows to move, Escape to dismiss, or tap/click a suggestion. Typing alone never changes a record selection. Disabled/blocked choices are excluded from suggestions and remain disabled in the native fallback selector. Existing selections remain intact when searching produces no result. Suggestions float outside scrolling item tables, follow the input during scroll/resize and remain within the viewport.

The shared NativeSelect enables this behavior for customer, supplier and item fields in invoice creation, receipts, purchasing, GRNs, transfers, adjustments and stock-ledger filters. Quotations use the shared searchable selector directly. Sales Orders use it for customers and their item picker uses the same case-insensitive matching. Status, tax-rate, date and other fixed-value selectors remain unchanged.

Global search includes items, permitted Sales Orders and parties, with keyboard/touch activation and matching-name highlights. Its query keys include the organisation, and results are filtered by the current role even when a query cache exists. Catalogue and party searches use only the existing authorised API records.

List search results also highlight matching names/numbers after two characters across items, parties, warehouse products, masters, documents, users and other record lists. Highlighting is plain React text and never interprets input as HTML or regular expressions.

The sidebar now has **Find Documents** and **Find Items** together. Find Items searches item name, SKU, HSN, brand and category, shows free stock and inactive/out-of-stock labels, and opens the existing item detail screen. Enter opens the first highlighted result; Show more reveals further matches. Access follows the existing item-view permissions, including Storekeeper access and excluding Driver access. CA users keep their dedicated portal.

Deploy the updated frontend after merging. No backend or MySQL migration is required; no saved transactions or master records are changed.
