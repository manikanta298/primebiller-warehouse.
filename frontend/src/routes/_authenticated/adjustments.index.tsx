import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Input } from "@/components/ui/input";
import { z } from "zod";
import { api } from "@/api/client";
import { formatDate, formatINR } from "@/lib/format";
import { reasonLabel, searchAdjustments } from "@/lib/adjustment-rules";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Chips } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/adjustments/")({
  validateSearch: z.object({ status: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Stock adjustments — Girder" },
      { name: "description", content: "Write stock up or down with a reason: damage, theft, expiry, found stock, corrections and samples." },
      { property: "og:title", content: "Stock adjustments — Girder" },
      { property: "og:description", content: "Write stock up or down with a reason: damage, theft, expiry, found stock, corrections and samples." },
    ],
  }),
  component: Adjustments,
});

const STATUSES = [
  { value: "all", label: "All" },
  { value: "pending_approval", label: "Awaiting approval" },
  { value: "posted", label: "Posted" },
  { value: "rejected", label: "Rejected" },
];

function Adjustments() {
  const { status = "all" } = Route.useSearch();
  const navigate = useNavigate();
  const session = useSession();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["adjustments", session?.orgId, status], queryFn: () => api.listAdjustments(status) });
  const filtered = searchAdjustments(q.data ?? [], search);
  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const selectedPage = Math.min(page, pages);
  const pageRows = filtered.slice((selectedPage - 1) * pageSize, selectedPage * pageSize);
  return (
    <div>
      <PageHeader title="Stock adjustments" eyebrow="Inventory" actions={can(session?.user.role, "adjust") && <Button asChild><Link to="/adjustments/new"><Plus /> New adjustment</Link></Button>} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Chips value={status} onChange={(v) => { setPage(1); navigate({ to: "/adjustments", search: v === "all" ? {} : { status: v } }); }} options={STATUSES} />
        <Input aria-label="Search adjustments" className="w-full sm:w-60" placeholder="Search number, reason, warehouse…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !filtered.length ? <EmptyState title="No matching adjustments" /> : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60"><tr className="eyebrow">
              {["Adjustment", "Date", "Godown", "Reason", "Lines", "By"].map((h) => <th key={h} className="px-4 py-2.5 text-left font-semibold">{h}</th>)}
              <th className="px-4 py-2.5 text-right font-semibold">Up</th><th className="px-4 py-2.5 text-right font-semibold">Down</th><th className="px-4 py-2.5 text-left font-semibold">Status</th>
            </tr></thead>
            <tbody>
              {pageRows.map((a) => (
                <tr key={a.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => navigate({ to: "/adjustments/$id", params: { id: a.id } })}>
                  <td className="num whitespace-nowrap px-4 py-2.5 font-medium">{a.number}</td>
                  <td className="num whitespace-nowrap px-4 py-2.5">{formatDate(a.date)}</td>
                  <td className="px-4 py-2.5">{a.godownName}</td>
                  <td className="px-4 py-2.5">{reasonLabel(a.reason)}</td>
                  <td className="num px-4 py-2.5">{a.lines.length}</td>
                  <td className="px-4 py-2.5">{a.createdBy}</td>
                  <td className="num px-4 py-2.5 text-right text-success">{a.valueUp ? `+${formatINR(a.valueUp, 0)}` : "—"}</td>
                  <td className="num px-4 py-2.5 text-right text-destructive">{a.valueDown ? `−${formatINR(a.valueDown, 0)}` : "—"}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
            <span>{filtered.length} adjustment(s) · page {selectedPage} of {pages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={selectedPage === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={selectedPage >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
