# Customer workflow and WhatsApp distribution

## Behavior

* The first **completed quotation save** creates immutable version 1 and a queued delivery in the same database transaction. Personal incomplete autosaves do not send.
* Saving identical business content does not create a version or resend. Generated line IDs do not count as business changes.
* Changed quotations create a new pending revision and supersede older unsent versions. A different Owner/Manager must approve the current exact version, with a reason. Rejected and superseded versions cannot be sent through retry.
* Existing pre-feature quotations are baselined as legacy, not silently auto-sent. Editing one requires approval.
* Existing quotation lifecycle restrictions remain: edit draft quotations; converted/cancelled documents are immutable. This change does not introduce post-acceptance commercial amendments.
* Issuing an invoice queues its immutable snapshot. Payment/status changes, prints and reopening do not queue another invoice. The repository currently implements tax invoices, not a separate non-tax invoice document type.
* Customer dashboards are internal staff views (Owner/Manager/Accountant), not a customer-login portal. History includes quotations, orders, invoices with items, deliveries, receipts and the latest 200 communication records. Totals exclude cancelled invoices and do not count orders as additional revenue.
* Invoice dispatch warehouses are captured from challan allocations at issuance. Older invoices fall back to linked challans. Earlier transfer origin is not inferred from pooled stock; serialized/lot traceability is a separate feature.

## Deployment

1. Back up and migrate the intended staging MySQL database using `npm run db:migrate`. New tables are additive: `document_distributions`, `customer_communication_preferences` and append-only `customer_communication_events`.
2. Deploy backend and frontend together; the new screens require the new endpoints/tables.
3. Configure secrets through the server environment, never frontend `VITE_` variables. See `backend/.env.example`.
4. Onboard a Meta business phone, obtain appropriate access, and approve document-header templates. Do not paste secrets into tickets, source, or chat.
5. Set Graph version explicitly. Both templates require a PDF document header and five body parameters in this order: customer name, document number, revision, total, customer ID. Match the configured language code exactly.
6. Configure `GET/POST /api/v1/webhooks/whatsapp` on a publicly reachable HTTPS backend. The GET handshake uses a verification secret; POST uses HMAC-SHA256 over raw bytes with the Meta app secret. Phone-number ID and environment-bound organisation scope status updates.
7. Record actual recipient opt-in evidence in the customer dashboard. Supply E.164 international numbers, e.g. `+919876543210`; consent is never inferred from a stored phone number.
8. Start the worker with `npm --prefix backend run start:notifications` after build, or `docker compose --profile notifications up -d --build`. The Compose worker waits for the migrated API to be healthy. API webhook environment is configured separately from worker access credentials.
9. Enable `WHATSAPP_ENABLED=true` only after sandbox/device acceptance. The configured sender is bound to one `WHATSAPP_ORG_ID`; other organisations fail closed. Multi-sender secret storage is not implemented.

## Delivery reliability

The worker claims queued work transactionally. It rechecks the current source, cancellation, current revision, approval and consent before sending. Source-document and consent row locks serialize revision/consent changes with an active send. PDF upload and sending have timeouts; documents may be delayed during provider outages without failing billing commits.

`accepted` means accepted by Meta, not delivered. Signed webhooks move status through sent/delivered/read. Replays and out-of-order callbacks cannot regress a delivered/read message. Configuration/consent problems become blocked. Definite failures can be retried by Owner/Manager after resolving the issue; rejected requests are not retried automatically.

Network failures after message submission, ambiguous provider responses, process crashes and database failures around external calls cannot provide exactly-once delivery. `uncertain` or stuck `processing` records require operator reconciliation against provider logs before resend. The UI intentionally offers no blind retry for them. There is no automatic SMS fallback or marketing campaign sending in this implementation.

## Security boundaries

All CRM/document reads require existing JWT/organisation membership plus explicit role permissions; document reads also use warehouse scope. Approval is checked server-side and cannot be supplied in quotation input. Same-user approval, stale-version approval and duplicate decisions are rejected. API error strings and dashboard output never include provider credentials or raw provider error bodies. API keys stay server-side. Media is uploaded directly from the immutable snapshot; no caller-controlled remote URL is fetched. No public invoice URL or guessable-ID download endpoint is added.

Consent changes retain current preferences and append historical evidence/recorder events in the same transaction. PDF uses a bundled DejaVu font; verify the actual customer-language glyph coverage and invoice layout before production sending. The PDF is a distribution rendering, not a replacement for statutory invoice review.

## Staging acceptance checklist

1. New completed quotation -> one queued v1 -> approved template PDF delivered to an opted-in test recipient.
2. No-op save -> no new event; changed save -> v2 pending, no send.
3. Author and Sales cannot approve; another Manager can; v3 invalidates pending v2 approval.
4. Rejection does not send; cancellation before worker send suppresses delivery.
5. Consent disabled/invalid number/missing credentials -> blocked; after correction, deliberate retry succeeds once.
6. Issue invoice from multiple challans -> one message; payment update/reopen/print -> none.
7. Click invoice -> item quantities, dispatch warehouses, batch and challan allocations reconcile.
8. Cross-organisation/customer/document attempts fail; forged webhook is rejected; duplicate/out-of-order statuses do not regress.
9. Provider failure/timeout/restart: no blind replay; operator can identify uncertain jobs.
10. Desktop/mobile: approve/reject, long history, invalid forms, toast visibility, navigation and keyboard focus. Confirm PDFs on recipient devices and required languages.

## Test evidence and open release gates

See `crm-whatsapp-qa.md` for executed checks and blockers. Do not mark live messaging or manual UI acceptance passed based on mock/provider-stub tests. No claim of zero security risk is made.
