import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { z } from "zod";
import { api } from "@/api/client";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { filterInvoices } from "@/lib/invoice-rules";
import { orderPage } from "@/lib/sales-order-rules";
import { formatDate, formatINR } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Chips } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/invoices/")({
  validateSearch: z.object({ status: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Tax invoices — Girder" },
      { name: "description", content: "Convert delivered challans into GST tax invoices, apply advances and track payment." },
      { property: "og:title", content: "Tax invoices — Girder" },
      { property: "og:description", content: "Convert delivered challans into GST tax invoices, apply advances and track payment." },
    ],
  }),
  component: InvoiceList,
});

const STATUSES = [
  { value: "all", label: "All" },
  { value: "awaiting_payment", label: "Awaiting payment" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];

function InvoiceList() {
  const { status = "all" } = Route.useSearch();
  const navigate = useNavigate();
  const session = useSession();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["invoices", session?.orgId, status], queryFn: () => api.listInvoices(status), enabled: !!session?.orgId });
  const rows = useMemo(() => filterInvoices(q.data ?? [], status, search), [q.data, status, search]);
  const result = orderPage(rows, page);
  useEffect(() => { setSearch(""); setPage(1); }, [session?.orgId]);
  useEffect(() => { setPage(1); }, [status]);
  return (
    <div>
      <PageHeader title="Tax invoices" eyebrow="Sales" actions={can(session?.user.role, "issueInvoice") ? <Button asChild><Link to="/invoices/new"><Plus /> New invoice</Link></Button> : undefined} />
      <div className="mb-4">
        <Chips value={status} onChange={(v) => navigate({ to: "/invoices", search: v === "all" ? {} : { status: v } })} options={STATUSES} />
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm flex-1 basis-56">
          <Search aria-hidden="true" className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search tax invoices" className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Invoice, customer, challan, date" />
        </div>
        {q.data && <span className="text-xs text-muted-foreground">{rows.length} of {q.data.length} invoices</span>}
      </div>
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !rows.length ? (
        <EmptyState title="No invoices here" hint={search ? "Try another search." : "Convert a delivered challan to issue one."} />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr className="eyebrow">
                {["Invoice", "Date", "Customer", "Challans", "Due"].map((h) => <th key={h} className="px-4 py-2.5 text-left font-semibold">{h}</th>)}
                <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
                <th className="px-4 py-2.5 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((i) => (
                <tr key={i.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => navigate({ to: "/invoices/$id", params: { id: i.id } })}>
                  <td className="num px-4 py-2.5 font-medium">{i.number}</td>
                  <td className="num px-4 py-2.5">{formatDate(i.date)}</td>
                  <td className="px-4 py-2.5">{i.customerName}</td>
                  <td className="num px-4 py-2.5 text-xs text-muted-foreground">{i.challans.map((c) => c.number).join(", ")}</td>
                  <td className="num px-4 py-2.5">{formatDate(i.dueDate)}</td>
                  <td className="num px-4 py-2.5 text-right">{formatINR(i.grandTotal, 0)}</td>
                  <td className="num px-4 py-2.5 text-right">{formatINR(i.balance, 0)}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.totalPages > 1 && <div className="mt-4 flex items-center justify-end gap-3 text-sm">
        <Button size="sm" variant="outline" disabled={result.page === 1} onClick={() => setPage(result.page - 1)}>Previous</Button>
        <span className="num text-muted-foreground">Page {result.page} of {result.totalPages}</span>
        <Button size="sm" variant="outline" disabled={result.page === result.totalPages} onClick={() => setPage(result.page + 1)}>Next</Button>
      </div>}
    </div>
  );
}
