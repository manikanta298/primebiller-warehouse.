import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { z } from "zod";
import { api } from "@/api/client";
import { formatDate, formatINR } from "@/lib/format";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { filterChallans } from "@/lib/challan-rules";
import { orderPage } from "@/lib/sales-order-rules";
import { Input } from "@/components/ui/input";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Chips } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/challans/")({
  validateSearch: z.object({ status: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Delivery challans — Girder" },
      { name: "description", content: "Dispatch sales orders, track goods in transit, e-way bills and proof of delivery." },
      { property: "og:title", content: "Delivery challans — Girder" },
      { property: "og:description", content: "Dispatch sales orders, track goods in transit, e-way bills and proof of delivery." },
    ],
  }),
  component: ChallanList,
});

const STATUSES = [
  { value: "all", label: "All" },
  { value: "in_transit", label: "In transit" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

function ChallanList() {
  const { status = "all" } = Route.useSearch();
  const navigate = useNavigate();
  const session = useSession();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["challans", session?.orgId, status], queryFn: () => api.listChallans(status), enabled: !!session?.orgId });
  const rows = useMemo(() => filterChallans(q.data ?? [], status, search), [q.data, status, search]);
  const result = orderPage(rows, page);
  useEffect(() => { setSearch(""); setPage(1); }, [session?.orgId]);
  useEffect(() => { setPage(1); }, [status]);

  return (
    <div>
      <PageHeader
        title="Delivery challans"
        eyebrow="Sales"
        actions={can(session?.user.role, "dispatch") ? <Button asChild><Link to="/challans/new"><Plus /> New challan</Link></Button> : undefined}
      />
      <div className="mb-4">
        <Chips value={status} onChange={(v) => navigate({ to: "/challans", search: v === "all" ? {} : { status: v } })} options={STATUSES} />
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm flex-1 basis-56">
          <Search aria-hidden="true" className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search delivery challans" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search challan, customer, vehicle, order" className="pl-8" />
        </div>
        {q.data && <span className="text-xs text-muted-foreground">{rows.length} of {q.data.length} challans</span>}
      </div>
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !rows.length ? (
        <EmptyState title="No challans here" hint={search ? "Try a different search." : "Dispatch a confirmed sales order to create one."} />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr className="eyebrow">
                {["Challan", "Date", "Customer", "Sales order", "Godown", "Vehicle", "E-way bill"].map((h) => <th key={h} className="px-4 py-2.5 text-left font-semibold">{h}</th>)}
                <th className="px-4 py-2.5 text-right font-semibold">Value</th>
                <th className="px-4 py-2.5 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((c) => (
                <tr key={c.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => navigate({ to: "/challans/$id", params: { id: c.id } })}>
                  <td className="num px-4 py-2.5 font-medium">{c.number}</td>
                  <td className="num px-4 py-2.5">{formatDate(c.date)}</td>
                  <td className="px-4 py-2.5">{c.customerName}</td>
                  <td className="num px-4 py-2.5 text-muted-foreground">{c.soNumber}</td>
                  <td className="px-4 py-2.5">{c.godownName}</td>
                  <td className="num px-4 py-2.5">{c.vehicleNo}</td>
                  <td className="num px-4 py-2.5 text-xs">{c.ewb ? (c.ewb.status === "cancelled" ? <span className="text-destructive line-through">{c.ewb.number}</span> : c.ewb.number) : <span className="text-muted-foreground">Not needed</span>}</td>
                  <td className="num px-4 py-2.5 text-right">{formatINR(c.value, 0)}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.totalPages > 1 && <div className="mt-4 flex items-center justify-end gap-3 text-sm">
        <Button variant="outline" size="sm" disabled={result.page === 1} onClick={() => setPage(result.page - 1)}>Previous</Button>
        <span className="num text-muted-foreground">Page {result.page} of {result.totalPages}</span>
        <Button variant="outline" size="sm" disabled={result.page === result.totalPages} onClick={() => setPage(result.page + 1)}>Next</Button>
      </div>}
    </div>
  );
}
