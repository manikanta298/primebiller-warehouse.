import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Clock, PackageX, TrendingDown, Boxes, Activity, Plus } from "lucide-react";
import { api } from "@/api/client";
import { canAccess, useSession } from "@/lib/session";
import { formatCompactINR, formatDate, formatINR, formatQty } from "@/lib/format";
import { PageHeader, ErrorState, LoadingRows } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Girder" },
      { name: "description", content: "Stock value, movements, alerts and sales pipeline across godowns." },
      { property: "og:title", content: "Dashboard — Girder" },
      { property: "og:description", content: "Stock value, movements, alerts and sales pipeline across godowns." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const session = useSession();
  const godownId = session?.godownId ?? "all";
  const orgId = session?.orgId;
  const role = session?.user.role;
  const canCreateOrder = !!role && canAccess(role, "/sales-orders");
  const canViewAlerts = !!role && canAccess(role, "/alerts");
  const canViewLedger = !!role && canAccess(role, "/stock-ledger");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", orgId, godownId],
    queryFn: () => api.getDashboard(godownId),
    enabled: !!orgId,
    refetchOnWindowFocus: true,
  });

  return (
    <div>
      <PageHeader
        title="Dashboard"
        eyebrow={data ? formatDate(data.asOfDate) : undefined}
        actions={canCreateOrder ? (
          <Button variant="ember" asChild>
            <Link to="/sales-orders/$id" params={{ id: "new" }}>
              <Plus /> New sales order <span className="kbd ml-1 border-ember-foreground/30 bg-transparent text-ember-foreground">Ctrl N</span>
            </Link>
          </Button>
        ) : undefined}
      />
      {isLoading && <LoadingRows rows={8} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi icon={Boxes} label="Stock value" value={formatCompactINR(data.stockValue)} hint={formatINR(data.stockValue, 0)} tone="primary" />
            <Kpi icon={Activity} label="Movements today" value={String(data.movementsToday)} ledgerDate={canViewLedger ? data.asOfDate : undefined} />
            <Kpi icon={Clock} label="Near expiry" value={String(data.nearExpiry)} tone="warn" tab={canViewAlerts ? "near_expiry" : undefined} />
            <Kpi icon={TrendingDown} label="Over-aged" value={String(data.overAged)} tone="warn" tab={canViewAlerts ? "over_aged" : undefined} />
            <Kpi icon={AlertTriangle} label="Low stock" value={String(data.lowStock)} tone="ember" tab={canViewAlerts ? "below_reorder" : undefined} />
            <Kpi icon={PackageX} label="Out of stock" value={String(data.outOfStock)} tone="danger" tab={canViewAlerts ? "out_of_stock" : undefined} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <Panel title="Stock value by godown">
              <div className="space-y-4">
                {data.valueByGodown.length === 0 && <p className="text-sm text-muted-foreground">No godowns set up for this organisation.</p>}
                {data.valueByGodown.map((g) => {
                  const max = Math.max(0, ...data.valueByGodown.map((x) => x.value));
                  const pct = max > 0 ? Math.max(0, Math.min(100, (g.value / max) * 100)) : 0;
                  return (
                    <div key={g.godownId}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>{g.name}</span>
                        <span className="num">{formatCompactINR(g.value)}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" role="progressbar" aria-label={`${g.name} stock value`} aria-valuemin={0} aria-valuemax={max || 1} aria-valuenow={Math.max(0, g.value)} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
            <Panel title="Sales pipeline">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {data.pipeline.map((p, i) => (
                  canCreateOrder ? (
                    <Link key={p.stage} to="/sales-orders" className={cn("rounded-md border p-3 transition-colors hover:border-primary", i === 1 && "bg-primary/5")}>
                      <div className="eyebrow">{p.stage}</div>
                      <div className="num mt-1 text-2xl font-semibold">{p.count}</div>
                      <div className="num text-xs text-muted-foreground">{formatCompactINR(p.value)}</div>
                    </Link>
                  ) : (
                    <div key={p.stage} className={cn("rounded-md border p-3", i === 1 && "bg-primary/5")}>
                      <div className="eyebrow">{p.stage}</div>
                      <div className="num mt-1 text-2xl font-semibold">{p.count}</div>
                      <div className="num text-xs text-muted-foreground">{formatCompactINR(p.value)}</div>
                    </div>
                  )
                ))}
              </div>
            </Panel>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <Panel title="High-value movements">
              {data.highValueMovements.length === 0 ? <p className="text-sm text-muted-foreground">No stock movements in the past 7 days.</p> : <div className="overflow-x-auto">
              <table className="min-w-[34rem] w-full text-sm">
                <thead>
                  <tr className="eyebrow border-b text-left">
                    <th className="py-2 font-semibold">Doc</th>
                    <th className="font-semibold">Item</th>
                    <th className="font-semibold">Godown</th>
                    <th className="text-right font-semibold">Qty</th>
                    <th className="text-right font-semibold">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.highValueMovements.map((m) => (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="py-2.5">
                        <div className="num text-xs">{m.docNo}</div>
                        <div className="text-xs text-muted-foreground">{m.type} · {formatDate(m.date)}</div>
                      </td>
                      <td className="max-w-44 truncate">{m.itemName}</td>
                      <td className="text-muted-foreground">{m.godownName}</td>
                      <td className={cn("num text-right", m.qty < 0 ? "text-ember" : "text-success")}>
                        {m.qty < 0 ? <ArrowDownRight className="mr-0.5 inline size-3" /> : <ArrowUpRight className="mr-0.5 inline size-3" />}
                        {formatQty(Math.abs(m.qty))}
                      </td>
                      <td className="num text-right">{formatINR(m.value, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>}
            </Panel>
            <Panel title="Needs attention">
              {data.attention.length === 0 && <p className="text-sm text-muted-foreground">Nothing needs attention right now.</p>}
              <ul className="space-y-2">
                {data.attention.map((a) => (
                  <li key={a.id} className="flex gap-3 rounded-md border p-3">
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        a.kind === "out_of_stock" || a.kind === "overdue" ? "bg-destructive" : a.kind === "low_stock" ? "bg-ember" : "bg-warning",
                      )}
                    />
                    <div>
                      <div className="text-sm font-medium">{a.title}</div>
                      <div className="text-xs text-muted-foreground">{a.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint, tone, tab, ledgerDate }: { icon: typeof Boxes; label: string; value: string; hint?: string; tone?: "primary" | "warn" | "ember" | "danger"; tab?: "near_expiry" | "over_aged" | "below_reorder" | "out_of_stock" | undefined; ledgerDate?: string | undefined }) {
  const body = <KpiBody Icon={Icon} label={label} value={value} tone={tone} />;
  const cls = "block rounded-lg border bg-card p-4 transition-colors hover:border-primary";
  if (tab) return <Link to="/alerts" search={{ tab }} className={cls} title={hint}>{body}</Link>;
  if (ledgerDate) return <Link to="/stock-ledger" search={{ from: ledgerDate }} className={cls}>{body}</Link>;
  return <div className="rounded-lg border bg-card p-4" title={hint}>{body}</div>;
}

function KpiBody({ Icon, label, value, tone }: { Icon: typeof Boxes; label: string; value: string; tone?: "primary" | "warn" | "ember" | "danger" | undefined }) {
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        <Icon
          className={cn(
            "size-4",
            tone === "primary" && "text-primary",
            tone === "warn" && "text-warning",
            tone === "ember" && "text-ember",
            tone === "danger" && "text-destructive",
            !tone && "text-muted-foreground",
          )}
        />
      </div>
      <div className="num mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="mb-4 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
