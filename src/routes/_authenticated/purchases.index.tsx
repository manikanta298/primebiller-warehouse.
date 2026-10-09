import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Plus, PackageCheck, Search } from "lucide-react";
import { z } from "zod";
import { api } from "@/api/client";
import { filterPurchaseOrders } from "@/lib/purchase-rules";
import { filterGrns } from "@/lib/grn-rules";
import { can } from "@/lib/permissions";
import { formatDate, formatINR } from "@/lib/format";
import { useSession } from "@/lib/session";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Chips, NativeSelect } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/purchases/")({
  validateSearch: z.object({ tab: z.enum(["po", "grn"]).optional() }),
  head: () => ({ meta: [
    { title: "Purchases / GRN — Girder" },
    { name: "description", content: "Raise purchase orders, track approvals and receive goods into godowns." },
  ] }),
  component: Purchases,
});

const th = "px-4 py-2.5 text-left font-semibold";
const PAGE_SIZE = 25;

function Purchases() {
  const { tab = "po" } = Route.useSearch();
  const navigate = useNavigate();
  const session = useSession();
  const orgId = session?.orgId ?? "";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [grnMode, setGrnMode] = useState<"all" | "linked" | "direct">("all");
  const [page, setPage] = useState(1);
  const pq = useQuery({ queryKey: ["pos", orgId], queryFn: api.listPurchaseOrders, enabled: !!orgId });
  const gq = useQuery({ queryKey: ["grns", orgId], queryFn: api.listGrns, enabled: !!orgId });
  const q = tab === "po" ? pq : gq;
  const orders = useMemo(() => filterPurchaseOrders(pq.data ?? [], search, status), [pq.data, search, status]);
  const grns = useMemo(() => filterGrns(gq.data ?? [], search, grnMode), [gq.data, search, grnMode]);
  const rows = tab === "po" ? orders : grns;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const offset = (currentPage - 1) * PAGE_SIZE;
  useEffect(() => { setSearch(""); setStatus("all"); setGrnMode("all"); setPage(1); }, [orgId]);
  return (
    <div>
      <PageHeader title="Purchases / GRN" eyebrow="Purchases" actions={
        <div className="flex gap-2">
          {can(session?.user.role, "raisePO") && <Button variant="outline" asChild><Link to="/purchases/new"><Plus /> New PO</Link></Button>}
          {can(session?.user.role, "postGrn") && <Button asChild><Link to="/purchases/grn/new" search={{}}><PackageCheck /> Receive goods</Link></Button>}
        </div>
      } />
      <div className="mb-4"><Chips value={tab} onChange={(v) => { setPage(1); navigate({ to: "/purchases", search: v === "po" ? {} : { tab: v } }); }}
        options={[{ value: "po", label: "Purchase orders" }, { value: "grn", label: "Goods receipts (GRN)" }]} /></div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search purchases" className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder={tab === "po" ? "Search PO, supplier or warehouse" : "Search GRN, invoice, supplier or PO"} />
        </div>
        {tab === "po" && <NativeSelect aria-label="Purchase order status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="all">All statuses</option><option value="draft">Draft</option><option value="open">Open / approved</option>
          <option value="partially_received">Partially received</option><option value="received">Received</option><option value="cancelled">Cancelled</option>
        </NativeSelect>}
        {tab === "grn" && <NativeSelect aria-label="Goods receipt source" value={grnMode} onChange={(e) => { setGrnMode(e.target.value as "all" | "linked" | "direct"); setPage(1); }}>
          <option value="all">All receipts</option><option value="linked">Against PO</option><option value="direct">Direct receipts</option>
        </NativeSelect>}
        {!q.isLoading && !q.error && <span className="text-xs text-muted-foreground" aria-live="polite">{rows.length} {tab === "po" ? "purchase orders" : "goods receipts"}</span>}
      </div>
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState error={q.error} onRetry={() => { void q.refetch(); }} /> : !rows.length ? (
        <EmptyState title={tab === "po" ? "No purchase orders found" : "No goods receipts found"} hint={search || (tab === "po" && status !== "all") ? "Try clearing the search or status filter." : "Use the action above to start."} />
      ) : tab === "po" ? (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm"><thead className="bg-muted/60"><tr className="eyebrow">
            {["PO", "Date", "Supplier", "Godown", "Received"].map((h) => <th key={h} className={th}>{h}</th>)}
            <th className="px-4 py-2.5 text-right font-semibold">Value</th><th className={th}>Status</th>
          </tr></thead><tbody>{orders.slice(offset, offset + PAGE_SIZE).map((p) => {
            const ord = p.lines.reduce((a, l) => a + l.qty, 0);
            const rec = p.lines.reduce((a, l) => a + l.receivedQty, 0);
            return <tr key={p.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => navigate({ to: "/purchases/$id", params: { id: p.id } })}>
              <td className="num whitespace-nowrap px-4 py-2.5 font-medium">{p.number}</td>
              <td className="num whitespace-nowrap px-4 py-2.5">{formatDate(p.date)}</td>
              <td className="px-4 py-2.5">{p.supplierName}</td>
              <td className="px-4 py-2.5">{p.godownName}</td>
              <td className="num px-4 py-2.5">{ord ? Math.round((rec / ord) * 100) : 0}%</td>
              <td className="num px-4 py-2.5 text-right">{formatINR(p.grandTotal, 0)}</td>
              <td className="px-4 py-2.5"><StatusBadge status={p.status} /></td>
            </tr>;
          })}</tbody></table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm"><thead className="bg-muted/60"><tr className="eyebrow">
            {["GRN", "Date", "Supplier", "Supplier invoice", "PO", "Godown"].map((h) => <th key={h} className={th}>{h}</th>)}
            <th className="px-4 py-2.5 text-right font-semibold">Total</th>
          </tr></thead><tbody>{grns.slice(offset, offset + PAGE_SIZE).map((g) => (
            <tr key={g.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => navigate({ to: "/purchases/grn/$id", params: { id: g.id } })}>
              <td className="num whitespace-nowrap px-4 py-2.5 font-medium">{g.number}</td>
              <td className="num whitespace-nowrap px-4 py-2.5">{formatDate(g.date)}</td>
              <td className="px-4 py-2.5">{g.supplierName}</td>
              <td className="num px-4 py-2.5">{g.supplierInvoiceNo}</td>
              <td className="num px-4 py-2.5 text-muted-foreground">{g.poNumber ?? "Direct"}</td>
              <td className="px-4 py-2.5">{g.godownName}</td>
              <td className="num px-4 py-2.5 text-right">{formatINR(g.grandTotal, 0)}</td>
            </tr>
          ))}</tbody></table>
        </div>
      )}
      {pages > 1 && <div className="mt-3 flex items-center justify-end gap-3 text-sm">
        <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
        <span className="num" aria-live="polite">Page {currentPage} of {pages}</span>
        <Button variant="outline" size="sm" disabled={currentPage === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>Next</Button>
      </div>}
    </div>
  );
}
