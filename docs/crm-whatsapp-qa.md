# CRM and document distribution: implementation QA

Date: 25 October 2026. Base: `0e54d1c2a2f952006f87feefa95fda5e4e8b1107`.

## Implemented

* Transactional immutable quotation/invoice snapshots and distribution queue.
* First completed quotation save queues v1; no-op saves do not resend; changed revisions require another Owner/Manager's approval. Legacy quotations are not treated as new auto-sends.
* Invoice issuance captures warehouse/batch/challan allocations and queues once.
* Internal customer dashboard with financial/document history and consent management.
* Meta document-template provider adapter, snapshot PDF renderer, isolated sender organisation, signed webhooks and monotonic statuses.
* Standalone worker and Compose profile, disabled by default. Uncertain sends require reconciliation.
* Fix for delivered quantities remaining stale after navigation from challans.
* Security dependency updates (Zod 4, body-parser, Vite and compatible transitive packages), explicit test dependency, and existing strict-TypeScript errors corrected without disabling compiler checks.

## Executed checks

| Check | Result |
| --- | --- |
| Backend tests | 40 passed; 5 MySQL-dependent tests skipped |
| Full frontend Vitest run | 147 passed |
| Frontend business-rule conversion tests | 232 passed |
| Root operational/security tests | 48 passed |
| Frontend strict typecheck | Passed |
| Backend strict typecheck/build | Passed |
| Frontend Vercel production build | Passed |
| Backend npm audit, including dev dependencies | Zero known advisories at execution |
| Frontend npm audit, including dev dependencies | Zero known advisories at execution |
| Whitespace/patch validation | Passed |

Counts are separate test commands with overlapping subject matter; do not interpret their sum as independent end-to-end scenarios. Audit results are time-specific advisory checks, not proof that no security issues exist.

## New test scenarios

Backend `tests/distribution.test.mjs`: stable content hashing; price/customer/terms change detection; generated-ID exclusion; first-version queueing; immutable snapshots; no-op deduplication; superseding old work; invoice status update deduplication; self/role approval rejection; stale and duplicate decisions; tenant scope; invalid consent numbers; malformed/tampered signatures; unsigned webhook and handshake rejection; monotonic/replayed status handling; generated PDF signature; exact recipient/version/media provider payload; uncertain message timeout classification; worker fail-closed without permission and refusal to replay processing jobs.

Frontend `src/test/crm-distribution.test.tsx`: approval reason required; approval targets displayed revision; author cannot approve; Sales cannot decide; uncertain jobs expose no resend; invoice sourcing displays multiple warehouse allocations; customer totals exclude cancelled invoices and do not count orders as sales.

Existing quotation HTTP fixtures were extended to model the new outbox SQL. These HTTP tests use an in-memory database adapter and do not establish real MySQL locking, rollback, migration or concurrency behavior. Provider tests stub fetch and do not transmit messages.

## Manual review

Code paths reviewed for server-side role checks, tenant-scoped SQL, parameterized IDs, stale-approval and self-approval rejection, consent checks, raw-body HMAC verification, provider endpoint construction, credential isolation, React text escaping, source snapshots and uncertain-send behavior. No provider token or app secret is included in browser code.

A manual browser session attempted `http://127.0.0.1:5173` after starting the new frontend. The remote browser returned `ERR_CONNECTION_REFUSED`; it cannot reach this workspace server. Therefore **manual UI acceptance is blocked, not passed**. No new live customer messages, invoices or stock movements were submitted during this implementation task.

## Open release gates

1. Deploy a coordinated backend/frontend build to a reachable staging environment and migrate a staging MySQL database. Run the existing optional MySQL tests and new concurrent quotation/worker/consent cases against it.
2. Configure the Meta business phone, organisation binding, access token, app/verification secrets, Graph version, approved PDF-header templates and language via server environment. These were not provided or enabled.
3. Use a real opted-in test recipient; verify new quotation, edited/rejected/approved revision, invoice attachment, recipient PDF rendering and signed delivery callbacks.
4. Exercise source cancellation, consent revocation, rapid revisions, two workers, restart during send, provider failures and uncertain-job reconciliation.
5. Complete desktop/mobile manual checks including toast overlays, keyboard focus, long customer histories and the stale delivered-quantity regression.
6. Review invoice PDF statutory content, print layout and supported customer languages. Embedded DejaVu improves Unicode support but is not a guarantee of all language glyph coverage.
7. The repository has tax invoices only; no separate non-tax invoice model, external CRM synchronization, SMS delivery, customer self-service portal or historical lot-origin reconstruction is claimed.

## Release decision

Prepared as a draft review branch. Not merged, not deployed to production, and not cleared for live automatic sending. See `crm-whatsapp-workflow.md` for setup and staging acceptance steps. Secrets should be configured in the hosting environment rather than shared in chat or committed.
