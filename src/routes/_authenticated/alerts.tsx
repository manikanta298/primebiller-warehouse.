import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { AlertKind, StockAlert } from "@/api/types";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { NEAR_EXPIRY_DAYS, OVER_AGED_DAYS } from "@/lib/stock-rules";
import { formatCompactINR, formatDate, formatINR, formatQty } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const TABS: { v: AlertKind | "all"; label: string }[] = [
  { v: "all", label: "All" },
  { v: "out_of_stock", label: "Out of stock" },
  { v: "below_reorder", label: "Below reorder" },
  { v: "near_expiry", label: "Near expiry" },
  { v: "over_aged", label: "Over-aged" },
];
type Tab = (typeof TABS)[number]["v"];

export const Route = createFileRoute("/_authenticated/alerts")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab; godown?: string } => ({
    ...(TABS.some((t) => t.v === s["tab"]) && s["tab"] !== "all" ? { tab: s["tab"] as Tab } : {}),
    ...(typeof s["godown"] === "string" && s["godown"] ? { godown: s["godown"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Alerts — Girder" },
      { name: "description", content: "Out of stock, below reorder, near-expiry and over-aged stock grouped by godown." },
      { property: "og:title", content: "Alerts — Girder" },
      { property: "og:description", content: "Out of stock, below reorder, near-expiry and over-aged stock grouped by godown." },
    ],
  }),
  component: AlertsPage,
});

function AlertsPage() {
  const { tab = "all", godown } = Route.useSearch();
  const navigate = useNavigate({ from: "/alerts" });
  const session = useSession();
  const godownId = godown ?? session?.godownId ?? "all";
  const [showAck, setShowAck] = useState(false);
  const [search, setSearch] = useState("");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["alerts", session?.orgId, godownId], queryFn: () => api.getAlerts(godownId), enabled: !!session?.orgId });
  const warehouses = useQuery({ queryKey: ["godowns", session?.orgId], queryFn: () => api.listGodowns(session!.orgId!), enabled: !!session?.orgId });
  const ack = useMutation({
    mutationFn: api.acknowledgeAlerts,
    onSuccess: (_d, ids) => {
      toast.success(ids.length === 1 ? "Alert acknowledged" : `${ids.length} alerts acknowledged`);
      void qc.invalidateQueries({ queryKey: ["alerts"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const all = (q.data ?? []).filter((a) => {
    const needle = search.trim().toLocaleLowerCase();
    return !needle || [a.itemName, a.sku, a.batchNo ?? "", a.godownName].some((v) => v.toLocaleLowerCase().includes(needle));
  });
  const open = all.filter((a) => !a.acknowledged);
  const count = (t: Tab) => open.filter((a) => t === "all" || a.kind === t).length;
  const rows = all.filter((a) => (tab === "all" || a.kind === tab) && (showAck || !a.acknowledged));
  const openInTab = rows.filter((a) => !a.acknowledged);
  const groups = [...new Set(rows.map((r) => r.godownId))].map((id) => ({ id, name: rows.find((r) => r.godownId === id)?.godownName ?? id, rows: rows.filter((r) => r.godownId === id) }));

  return (
    <div>
      <PageHeader
        title="Alerts"
        eyebrow="Inventory"
        actions={
          <Button variant="outline" disabled={!openInTab.length || ack.isPending} onClick={() => ack.mutate(openInTab.map((a) => a.id))}>
            <CheckCheck /> Acknowledge all
          </Button>
        }
      >
        <p className="mt-1 text-sm text-muted-foreground">
          Near expiry = within {NEAR_EXPIRY_DAYS} days · Over-aged = received more than {OVER_AGED_DAYS} days ago
        </p>
      </PageHeader>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input aria-label="Search alerts" placeholder="Search item, SKU, batch or godown" className="h-9 max-w-sm" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Alert godown" className="h-9 rounded-md border bg-card px-2 text-sm" value={godownId} onChange={(e) => navigate({ search: (prev) => ({ ...prev, godown: e.target.value }), replace: true })}>
          <option value="all">All godowns</option>
          {(warehouses.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.v}
              role="tab"
              aria-selected={tab === t.v}
              onClick={() => navigate({ search: { ...(godown ? { godown } : {}), ...(t.v !== "all" ? { tab: t.v } : {}) }, replace: true })}
              className={cn("rounded-md px-3 py-1.5 text-sm", tab === t.v ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {t.label} <span className="num ml-1 text-xs opacity-80">{count(t.v)}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={showAck} onCheckedChange={setShowAck} /> Show acknowledged
        </label>
      </div>

      {q.isLoading && <LoadingRows rows={8} />}
      {(q.error || warehouses.error) && <ErrorState error={q.error ?? warehouses.error} onRetry={() => { void q.refetch(); void warehouses.refetch(); }} />}
      {q.data && groups.length === 0 && <EmptyState title="Nothing needs attention here" hint="New alerts appear when stock drops below reorder or batches age." />}
      <div className="space-y-5">
        {groups.map((g) => {
          const risk = g.rows.filter((r) => !r.acknowledged).reduce((a, r) => a + r.valueAtRisk, 0);
          return (
            <section key={g.id} className="rounded-lg border bg-card">
              <header className="flex items-center justify-between border-b px-4 py-3">
                <div className="font-semibold">{g.name}</div>
                <div className="text-sm text-muted-foreground">
                  {g.rows.length} alert{g.rows.length === 1 ? "" : "s"} · value at risk{" "}
                  <span className="num font-semibold text-foreground" title={formatINR(risk, 0)}>{formatCompactINR(risk)}</span>
                </div>
              </header>
              <ul className="divide-y">
                {g.rows.map((a) => <AlertRow key={a.id} a={a} onAck={() => ack.mutate([a.id])} busy={ack.isPending} role={session?.user.role} />)}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const DOT: Record<AlertKind, string> = {
  out_of_stock: "bg-destructive",
  below_reorder: "bg-ember",
  near_expiry: "bg-warning",
  over_aged: "bg-warning",
};

function AlertRow({ a, onAck, busy, role }: { a: StockAlert; onAck: () => void; busy: boolean; role?: string }) {
  const isStock = a.kind === "out_of_stock" || a.kind === "below_reorder";
  let detail: string;
  if (isStock) detail = `Free ${formatQty(a.qty)} ${a.uom} · reorder at ${formatQty(a.reorderLevel ?? 0)} · short ${formatQty(a.shortfall ?? 0)}`;
  else if (a.kind === "near_expiry")
    detail = `Batch ${a.batchNo} · ${formatQty(a.qty)} ${a.uom} · ${(a.daysLeft ?? 0) < 0 ? `expired ${formatDate(a.expiryDate!)}` : `expires ${formatDate(a.expiryDate!)} (${a.daysLeft} days)`}`;
  else detail = `Batch ${a.batchNo} · ${formatQty(a.qty)} ${a.uom} · ${a.ageDays} days old`;
  const label = { out_of_stock: "Out of stock", below_reorder: "Below reorder", near_expiry: (a.daysLeft ?? 0) < 0 ? "Expired" : "Near expiry", over_aged: "Over-aged" }[a.kind];

  return (
    <li className={cn("flex flex-wrap items-center gap-3 px-4 py-3", a.acknowledged && "opacity-60")}>
      <span className={cn("size-2 shrink-0 rounded-full", DOT[a.kind])} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/items/$id" params={{ id: a.itemId }} className="font-medium hover:underline">{a.itemName}</Link>
          <span className="rounded-full border px-2 py-0.5 text-xs">{label}</span>
        </div>
        <div className="num text-xs text-muted-foreground">{detail}</div>
      </div>
      <div className="num w-28 text-right text-sm">{formatINR(a.valueAtRisk, 0)}</div>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/stock-ledger" search={{ item: a.itemId, godown: a.godownId }}>Ledger</Link>
        </Button>
        {isStock && can(role, "raisePO") && (
          <Button variant="outline" size="sm" asChild><Link to="/purchases/new">Create PO</Link></Button>
        )}
        {isStock && can(role, "transfer") && (
          <Button variant="outline" size="sm" asChild><Link to="/transfers/new">Transfer</Link></Button>
        )}
        {a.acknowledged ? (
          <span className="flex items-center gap-1 px-2 text-xs text-muted-foreground"><Check className="size-3" /> Acknowledged</span>
        ) : (
          <Button variant="outline" size="sm" onClick={onAck} disabled={busy}>
            <Check /> Acknowledge
          </Button>
        )}
      </div>
    </li>
  );
}
