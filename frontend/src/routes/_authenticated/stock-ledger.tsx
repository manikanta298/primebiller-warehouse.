import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, X } from "lucide-react";
import { api } from "@/api/client";
import type { LedgerType } from "@/api/types";
import { useSession } from "@/lib/session";
import { buildLedger, stockLedgerCsv } from "@/lib/stock-rules";
import { formatDate, formatINR, formatQty } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const TYPES: { v: LedgerType; label: string }[] = [
  { v: "OPENING", label: "Opening" },
  { v: "PURCHASE_IN", label: "Purchase in" },
  { v: "TRANSFER_IN", label: "Transfer in" },
  { v: "TRANSFER_OUT", label: "Transfer out" },
  { v: "DC_ISSUE", label: "Challan issue" },
  { v: "DC_REVERSE", label: "Challan reversal" },
  { v: "ADJ_IN", label: "Adjustment in" },
  { v: "ADJ_OUT", label: "Adjustment out" },
];
const typeLabel = (t: string) => TYPES.find((x) => x.v === t)?.label ?? t;

interface Search {
  item?: string;
  godown?: string;
  batch?: string;
  type?: LedgerType;
  from?: string;
  to?: string;
  doc?: string;
}
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const Route = createFileRoute("/_authenticated/stock-ledger")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const out: Search = {};
    for (const k of ["item", "godown", "batch", "from", "to", "doc"] as const) {
      const v = str(s[k]);
      if (v) out[k] = v;
    }
    const t = str(s["type"]);
    if (t && TYPES.some((x) => x.v === t)) out.type = t as LedgerType;
    return out;
  },
  head: () => ({
    meta: [
      { title: "Stock ledger — Girder" },
      { name: "description", content: "Every stock movement by item, godown and batch with running balance." },
      { property: "og:title", content: "Stock ledger — Girder" },
      { property: "og:description", content: "Every stock movement by item, godown and batch with running balance." },
    ],
  }),
  component: LedgerPage,
});

const sel = "h-9 rounded-md border bg-card px-2 text-sm";

function LedgerPage() {
  const search = Route.useSearch();
  const [requestedPage, setRequestedPage] = useState(1);
  useEffect(() => { setRequestedPage(1); }, [search.item, search.godown, search.batch, search.type, search.from, search.to, search.doc]);
  const navigate = useNavigate({ from: "/stock-ledger" });
  const session = useSession();
  const godownId = search.godown ?? session?.godownId ?? "all";
  const set = (patch: { [K in keyof Search]?: Search[K] | undefined }) =>
    navigate({ search: (prev) => { const n: Record<string, unknown> = { ...prev, ...patch }; Object.keys(n).forEach((k) => n[k] === undefined && delete n[k]); return n as Search; }, replace: true });

  const { data: items = [] } = useQuery({ queryKey: ["items", session?.orgId, "ledger"], queryFn: () => api.listItems("").then((a) => a), enabled: !!session?.orgId });
  const { data: godowns = [] } = useQuery({
    queryKey: ["godowns", session?.orgId],
    queryFn: () => api.listGodowns(session!.orgId!),
    enabled: !!session?.orgId,
  });
  const q = useQuery({
    queryKey: ["ledger", session?.orgId, search.item, godownId, search.batch],
    queryFn: () => api.getStockLedger({ itemId: search.item, godownId, batchNo: search.batch }),
    enabled: !!session?.orgId,
  });
  const invalidRange = Boolean(search.from && search.to && search.from > search.to);
  const view = q.data && !invalidRange ? buildLedger(q.data, { itemId: search.item, godownId, batchNo: search.batch, type: search.type, docNo: search.doc, from: search.from, to: search.to }) : null;
  const hasBalance = !!search.item;
  const pages = Math.max(1, Math.ceil((view?.rows.length ?? 0) / 25));
  const page = Math.min(requestedPage, pages);
  const visible = view?.rows.slice((page - 1) * 25, page * 25) ?? [];
  const item = items.find((i) => i.id === search.item);
  const batches = item ? [...new Set(item.batches.map((b) => b.batchNo))] : [];
  const avgCost = item?.costPrice ?? 0;
  const hasFilters = Object.keys(search).length > 0;

  const exportCsv = () => {
    if (!view?.rows.length) return;
    const blob = new Blob([stockLedgerCsv(view.rows, hasBalance)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stock-ledger.csv";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div>
      <PageHeader
        title="Stock ledger"
        eyebrow="Inventory"
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={!view?.rows.length}>
            <Download /> Export CSV
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <select aria-label="Item" className={sel} value={search.item ?? ""} onChange={(e) => set({ item: e.target.value || undefined, batch: undefined })}>
          <option value="">All items</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <select aria-label="Godown" className={sel} value={godownId} onChange={(e) => set({ godown: e.target.value })}>
          <option value="all">All godowns</option>
          {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select aria-label="Batch" className={sel} value={search.batch ?? ""} disabled={!batches.length} onChange={(e) => set({ batch: e.target.value || undefined })}>
          <option value="">All batches</option>
          {batches.map((b) => <option key={b}>{b}</option>)}
        </select>
        <select aria-label="Type" className={sel} value={search.type ?? ""} onChange={(e) => set({ type: (e.target.value || undefined) as LedgerType | undefined })}>
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
        </select>
        <Input aria-label="From" type="date" className="h-9 w-40" value={search.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
        <span className="text-xs text-muted-foreground">to</span>
        <Input aria-label="To" type="date" className="h-9 w-40" value={search.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} />
        <Input aria-label="Document no." placeholder="Document no." className="h-9 w-40" value={search.doc ?? ""} onChange={(e) => set({ doc: e.target.value || undefined })} />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => navigate({ search: {}, replace: true })}>
            <X /> Clear
          </Button>
        )}
      </div>

      {invalidRange && <p role="alert" className="mb-3 text-sm text-destructive">The From date must be on or before the To date.</p>}
      {q.isLoading && <LoadingRows rows={10} />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {view && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Opening" value={hasBalance ? formatQty(view.opening) : "—"} />
            <Stat label="Shown movement in" value={hasBalance ? `+${formatQty(view.totalIn)}` : "—"} tone="text-success" />
            <Stat label="Shown movement out" value={hasBalance ? `−${formatQty(view.totalOut)}` : "—"} tone="text-ember" />
            <Stat label="Actual closing" value={hasBalance ? formatQty(view.closing) : "—"} />
            <Stat label="Est. closing value" value={item ? formatINR(view.closing * avgCost, 0) : "Pick an item"} />
          </div>
          {!item && <p className="mb-2 text-xs text-muted-foreground">Quantities across different items mix units — pick an item for a meaningful running balance.</p>}
          {(search.type || search.doc) && <p className="mb-2 text-xs text-muted-foreground">In/out totals include displayed movements; running and closing balances include all stock movements, even those hidden by type or document filters.</p>}
          {view.rows.length === 0 ? (
            <EmptyState title="No movements match these filters" hint="Widen the date range or clear a filter." />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="eyebrow border-b text-left">
                    <th className="px-3 py-2">Date</th>
                    <th>Document</th>
                    <th>Item</th>
                    <th>Batch</th>
                    <th>Type</th>
                    <th className="text-right">In</th>
                    <th className="text-right">Out</th>
                    <th className="text-right">Balance</th>
                    <th className="text-right">Unit cost</th>
                    <th className="text-right">Value</th>
                    <th className="px-3">User</th>
                  </tr>
                </thead>
                <tbody>
                  {search.from && hasBalance && (
                    <tr className="border-b bg-muted/50">
                      <td className="px-3 py-2 text-xs">{formatDate(search.from)}</td>
                      <td colSpan={6} className="text-xs font-medium">Opening balance</td>
                      <td className="num text-right font-medium">{formatQty(view.opening)}</td>
                      <td colSpan={3} />
                    </tr>
                  )}
                  {visible.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-3 py-2">
                        <div>{formatDate(r.at.slice(0, 10))}</div>
                        <div className="num text-xs text-muted-foreground">{r.at.slice(11, 16)}</div>
                      </td>
                      <td className="num whitespace-nowrap text-xs">
                        {r.soId ? <Link to="/sales-orders/$id" params={{ id: r.soId }} className="text-primary hover:underline">{r.docNo}</Link> : r.docNo}
                        {r.reason && <div className="text-muted-foreground">{r.reason}</div>}
                      </td>
                      <td className="max-w-48">
                        <div className="truncate">{r.itemName}</div>
                        <div className="text-xs text-muted-foreground">{r.godownName}</div>
                      </td>
                      <td className="num text-xs">{r.batchNo ?? "—"}</td>
                      <td className="whitespace-nowrap text-xs">{typeLabel(r.type)}</td>
                      <td className="num text-right text-success">{r.qty > 0 ? formatQty(r.qty) : ""}</td>
                      <td className="num text-right text-ember">{r.qty < 0 ? formatQty(-r.qty) : ""}</td>
                      <td className={cn("num text-right font-medium", r.running < 0 && "text-destructive")}>{hasBalance ? formatQty(r.running) : "—"}</td>
                      <td className="num text-right">{formatINR(r.unitCost)}</td>
                      <td className="num text-right">{formatINR(Math.abs(r.qty) * r.unitCost, 0)}</td>
                      <td className="whitespace-nowrap px-3 text-xs text-muted-foreground">{r.user}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-sm text-muted-foreground">
                <span>Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, view.rows.length)} of {view.rows.length} movements</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setRequestedPage(page - 1)}>Previous</Button>
                  <span className="num">{page} / {pages}</span>
                  <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setRequestedPage(page + 1)}>Next</Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="eyebrow">{label}</div>
      <div className={cn("num mt-1 text-lg font-semibold", tone)}>{value}</div>
    </div>
  );
}
