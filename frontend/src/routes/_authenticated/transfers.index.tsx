import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, AlertTriangle } from "lucide-react";
import { z } from "zod";
import { api } from "@/api/client";
import { formatDate, formatINR } from "@/lib/format";
import { isStuck, searchTransfers } from "@/lib/transfer-rules";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Input } from "@/components/ui/input";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Chips } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/transfers/")({
  validateSearch: z.object({ status: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Stock transfers — Girder" },
      { name: "description", content: "Move stock between godowns, track goods in transit and record shortages on receipt." },
      { property: "og:title", content: "Stock transfers — Girder" },
      { property: "og:description", content: "Move stock between godowns, track goods in transit and record shortages on receipt." },
    ],
  }),
  component: Transfers,
});

const STATUSES = [
  { value: "all", label: "All" }, { value: "in_transit", label: "In transit" }, { value: "received", label: "Received" },
  { value: "partially_received", label: "With shortage" }, { value: "cancelled", label: "Cancelled" },
];

function Transfers() {
  const { status = "all" } = Route.useSearch();
  const navigate = useNavigate();
  const session = useSession();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["transfers", session?.orgId, status], queryFn: () => api.listTransfers(status) });
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const filtered = searchTransfers(q.data ?? [], search);
  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const selectedPage = Math.min(page, pages);
  const pageRows = filtered.slice((selectedPage - 1) * pageSize, selectedPage * pageSize);
  return (
    <div>
      <PageHeader title="Stock transfers" eyebrow="Inventory" actions={can(session?.user.role, "transfer") && <Button asChild><Link to="/transfers/new"><Plus /> New transfer</Link></Button>} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Chips value={status} onChange={(v) => { setPage(1); navigate({ to: "/transfers", search: v === "all" ? {} : { status: v } }); }} options={STATUSES} />
        <Input aria-label="Search stock transfers" className="w-full sm:w-60" placeholder="Search transfer, warehouse, vehicle…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !filtered.length ? <EmptyState title="No matching transfers" /> : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60"><tr className="eyebrow">
              {["Transfer", "Date", "From → To", "Lines", "Vehicle"].map((h) => <th key={h} className="px-4 py-2.5 text-left font-semibold">{h}</th>)}
              <th className="px-4 py-2.5 text-right font-semibold">Value</th><th className="px-4 py-2.5 text-left font-semibold">Status</th>
            </tr></thead>
            <tbody>
              {pageRows.map((t) => (
                <tr key={t.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => navigate({ to: "/transfers/$id", params: { id: t.id } })}>
                  <td className="num whitespace-nowrap px-4 py-2.5 font-medium">{t.number}</td>
                  <td className="num whitespace-nowrap px-4 py-2.5">{formatDate(t.date)}</td>
                  <td className="px-4 py-2.5">{t.fromName} → {t.toName}</td>
                  <td className="num px-4 py-2.5">{t.lines.length}</td>
                  <td className="num px-4 py-2.5">{t.vehicleNo || "—"}</td>
                  <td className="num px-4 py-2.5 text-right">{formatINR(t.value, 0)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2"><StatusBadge status={t.status} />
                      {t.status === "in_transit" && isStuck(t.date, today) && <span className="flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="size-3.5" /> Stuck</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
            <span>{filtered.length} transfer(s) · page {selectedPage} of {pages}</span>
            <div className="flex gap-2"><Button size="sm" variant="outline" disabled={selectedPage === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={selectedPage >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}
