<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- All data access goes through `src/api/client.ts`; it calls the external REST API at `VITE_API_URL` with a JWT bearer, else falls back to `src/api/mock.ts` with identical signatures — so screens never change when the real backend lands.
- No Supabase / Lovable Cloud, tRPC or Prisma: the user's backend is a separate Express + MySQL service.
- TanStack Router (not React Router) — it is the fixed router for this stack.
- Signed-in screens live under `src/routes/_authenticated/` (client-only, `ssr: false`) because the session is in localStorage; role access is defined once in `ROUTE_ROLES` in `src/lib/session.ts` and enforced in the layout's beforeLoad and the sidebar.
- GST, credit and e-way-bill rules live in `src/lib/gst.ts` and are covered by `src/test/gst.test.ts`; the UI and mock must import them, never re-implement.
- The backend lives in `backend/` (Express + mysql2 + zod + JWT), deployed separately from the frontend; it must stay standalone (no imports from `../src`), ships no demo data: `db/schema.sql` is idempotent DDL only and the first org/Owner comes from `npm run setup:owner`.
- Server business rules are generated copies in `backend/src/shared/` made by the repo-root `node scripts/sync-shared.mjs`; change rules in `src/lib`, re-run the script, never edit the copies — so screens and API can't drift.
- Who-can-do-what lives once in `src/lib/permissions.ts` (UI hides buttons, mock and server enforce the same table); page access stays in `ROUTE_ROLES`.
- Document numbers come from configurable series (prefix + digits) via `docNumber` in `src/lib/numbering.ts`; the server row-locks `doc_counters` in the posting transaction to keep invoices gapless.
- MySQL keeps masters, users/roles, stock balances, batches and the stock ledger relational; business documents store header columns plus a JSON `body` matching the API type, written only through the unit of work in `backend/src/uow.ts`.
- Every request to the real API sends `X-Org-Id`; the server reads the role from `user_roles` per request and revokes tokens on role change via `users.token_version`.
- Bulk-import files are read by `src/lib/import-parse.ts` (format detected from content: Excel, JSON, Google Sheets link, CSV), shared with the server via sync-shared and exposed as `POST /api/v1/import/parse` — so the import screen stays format-agnostic.
