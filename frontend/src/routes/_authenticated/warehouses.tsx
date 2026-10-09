import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Eye, Minus, Pencil, Plus, Search, Star, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Godown, GodownInput, GodownType, Item } from "@/api/types";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatCompactINR, formatINR, formatQty, formatDate } from "@/lib/format";
import { filterWarehouses, godownProblems, type WarehouseActivityFilter } from "@/lib/godown-rules";
import { warehouseCatalogue, type WarehouseStockFilter } from "@/lib/warehouse-dashboard-rules";
import { adjustmentDraftProblems } from "@/lib/adjustment-rules";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { ActiveDot, Field, NativeSelect } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/warehouses")({
  validateSearch: (search: Record<string, unknown>) => ({ warehouse: typeof search["warehouse"] === "string" ? search["warehouse"] : undefined }),
  head: () => ({
    meta: [
      { title: "Warehouses — Girder" },
      { name: "description", content: "Godowns, yards and shop counters with stock value, negative-stock rule and default for sales." },
      { property: "og:title", content: "Warehouses — Girder" },
      { property: "og:description", content: "Godowns, yards and shop counters with stock value, negative-stock rule and default for sales." },
    ],
  }),
  component: WarehousesPage,
});

const TYPES: Record<GodownType, string> = { godown: "Godown", yard: "Yard", shop_counter: "Shop counter", transit: "Transit" };

function WarehousesPage() {
  const session = useSession();
  const orgId = session?.orgId ?? "";
  const canEdit = can(session?.user.role, "editMasters");
  const [editing, setEditing] = useState<GodownInput | null>(null);
  const { warehouse: selectedId } = Route.useSearch();
  const [query, setQuery] = useState("");
  const [activity, setActivity] = useState<WarehouseActivityFilter>("all");
  useEffect(() => { setEditing(null); setQuery(""); setActivity("all"); }, [orgId]);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["godowns", orgId, "detail"], queryFn: () => api.listGodownsDetailed(orgId), enabled: !!orgId,
  });
  const filtered = useMemo(() => filterWarehouses(data ?? [], query, activity), [data, query, activity]);
  const org = session?.orgs.find((o) => o.id === orgId);
  const blank: GodownInput = { code: "", name: "", type: "godown", address: "", stateCode: org?.stateCode ?? "", gstin: "", manager: "", allowNegative: false, defaultForSales: false, active: true };
  const toInput = (g: Godown): GodownInput => ({ ...blank, ...g, gstin: g.gstin ?? "" });

  if (selectedId) {
    if (isLoading) return <LoadingRows rows={5} />;
    if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
    const selected = data?.find((g) => g.id === selectedId);
    if (!selected) return <div className="space-y-4"><Link to="/warehouses" search={{ warehouse: undefined }} className="text-sm text-primary">← Warehouses</Link><EmptyState title="Warehouse not found" hint="This warehouse is unavailable in the current organisation." /></div>;
    return <WarehouseDashboard key={`${orgId}:${selected.id}`} orgId={orgId} warehouse={selected} canAdjust={can(session?.user.role, "adjust")} />;
  }

  return (
    <div>
      <PageHeader title="Warehouses" eyebrow="Masters" actions={canEdit && <Button onClick={() => setEditing({ ...blank })}><Plus /> New warehouse</Button>} />
      {data && data.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1 sm:max-w-xs">
            <Search aria-hidden="true" className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input aria-label="Search warehouses" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search warehouses..." className="pl-9" />
          </div>
          <NativeSelect aria-label="Warehouse status" value={activity} onChange={(e) => setActivity(e.target.value as WarehouseActivityFilter)} className="w-40">
            <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
          </NativeSelect>
          <span className="text-xs text-muted-foreground">{filtered.length} of {data.length} warehouses</span>
        </div>
      )}
      {isLoading && <LoadingRows rows={3} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && data.length === 0 && <EmptyState title="No warehouses yet" hint="Add your first godown to start tracking stock." />}
      {data && data.length > 0 && filtered.length === 0 && <EmptyState title="No matching warehouses" hint="Try a different search or status." />}
      {filtered.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((g) => (
            <article key={g.id} className="rounded-lg border bg-card p-4 text-left">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary"><Warehouse className="size-4" /></div>
                  <div>
                    <div className="font-semibold">{g.name}</div>
                    <div className="text-xs text-muted-foreground"><span className="num">{g.code}</span> · {TYPES[g.type ?? "godown"]}</div>
                  </div>
                </div>
                <ActiveDot active={g.active} />
              </div>
              <p className="mt-3 line-clamp-2 min-h-10 text-sm text-muted-foreground">{g.address || "No address"}</p>
              <div className="mt-4 flex items-end justify-between border-t pt-3">
                <div>
                  <div className="eyebrow">Stock value</div>
                  <div className="num text-lg font-semibold">{formatCompactINR(g.stockValue ?? 0)}</div>
                  <div className="text-xs text-muted-foreground">{g.itemCount ?? 0} stocked items · quantities by item</div>
                </div>
                <div className="flex flex-col items-end gap-1 text-xs">
                  {g.defaultForSales && <span className="inline-flex items-center gap-1 text-ember"><Star className="size-3 fill-current" /> Default for sales</span>}
                  <span className="text-muted-foreground">{g.allowNegative ? "Negative stock allowed" : "No negative stock"}</span>
                  {g.manager && <span className="text-muted-foreground">Manager: {g.manager}</span>}
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2 border-t pt-3">
                <Button size="sm" variant="outline" asChild><Link to="/warehouses" search={{ warehouse: g.id }}><Eye className="size-4" /> Dashboard & stock</Link></Button>
                {canEdit && <Button size="sm" variant="outline" onClick={() => setEditing(toInput(g))}><Pencil className="size-4" /> Edit</Button>}
              </div>
            </article>
          ))}
        </div>
      )}
      {editing && <GodownDialog key={`${orgId}:${editing.id ?? "new"}`} orgId={orgId} initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** One bookmarkable dashboard per warehouse (?warehouse=id), showing the entire product catalogue,
 * including products with zero stock in that warehouse. The +/− actions post audited adjustments.
 */
function WarehouseDashboard({ orgId, warehouse, canAdjust }: { orgId: string; warehouse: Godown; canAdjust: boolean }) {
  const [tab, setTab] = useState<"overview" | "inventory">("overview");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WarehouseStockFilter>("all");
  const [editingStock, setEditingStock] = useState<{ item: Item; direction: "up" | "down" } | null>(null);
  const items = useQuery({ queryKey: ["warehouse-catalogue", orgId], queryFn: () => api.listItems(), enabled: !!orgId });
  const activity = useQuery({ queryKey: ["warehouse-activity", orgId, warehouse.id], queryFn: () => api.getWarehouseActivity(orgId, warehouse.id), enabled: !!orgId });
  const all = useMemo(() => warehouseCatalogue(items.data ?? [], warehouse.id), [items.data, warehouse.id]);
  const rows = useMemo(() => warehouseCatalogue(items.data ?? [], warehouse.id, query, filter), [items.data, warehouse.id, query, filter]);
  const value = all.reduce((sum, r) => sum + r.value, 0);
  const stocked = all.filter((r) => r.onHand !== 0 || r.held !== 0).length;
  const held = all.filter((r) => r.held > 0).length;
  const lastDays = activity.data?.daily.slice(-14) ?? [];
  const peak = Math.max(1, ...lastDays.flatMap((d) => [d.incomingValue, d.outgoingValue]));
  return (
    <div className="space-y-5">
      <Link to="/warehouses" search={{ warehouse: undefined }} className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="size-4" /> All warehouses</Link>
      <PageHeader title={`${warehouse.name} dashboard`} eyebrow={`${warehouse.code} · ${TYPES[warehouse.type ?? "godown"]}`} actions={<Button variant="outline" onClick={() => { items.refetch(); activity.refetch(); }}>Refresh</Button>} />
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <WarehouseKpi label="Current stock value" value={formatCompactINR(value)} hint={`${stocked} stocked / ${all.length} total products`} />
        <WarehouseKpi label="Incoming · 30 days" value={formatCompactINR(activity.data?.incomingValue ?? 0)} hint={`${activity.data?.incomingMovements ?? 0} recorded movements`} positive />
        <WarehouseKpi label="Outgoing · 30 days" value={formatCompactINR(activity.data?.outgoingValue ?? 0)} hint={`${activity.data?.outgoingMovements ?? 0} recorded movements`} />
        <WarehouseKpi label="SKUs with reservations" value={String(held)} hint="See reserved units for each product below" />
      </div>
      <p className="text-xs text-muted-foreground">Sales dispatches from this warehouse automatically reduce on-hand stock and appear as outgoing movements. Invoices linked to those dispatches do not deduct the same stock twice.</p>
      <div className="flex gap-2 border-b pb-2">
        <Button variant={tab === "overview" ? "default" : "outline"} size="sm" onClick={() => setTab("overview")}>Movements & dashboard</Button>
        <Button variant={tab === "inventory" ? "default" : "outline"} size="sm" onClick={() => setTab("inventory")}>All products ({all.length})</Button>
      </div>
      {items.isLoading || activity.isLoading ? <LoadingRows rows={5} /> : null}
      {items.error && <ErrorState error={items.error} onRetry={() => items.refetch()} />}
      {activity.error && <ErrorState error={activity.error} onRetry={() => activity.refetch()} />}
      {tab === "overview" && activity.data && <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border bg-card p-4">
          <h2 className="font-semibold">Incoming vs outgoing value</h2>
          <p className="mt-1 text-xs text-muted-foreground">Movement days in the last 30 days · INR cost value (not mixed KG/BAG/PCS quantities)</p>
          <div className="mt-4 space-y-3">
            {lastDays.length === 0 && <p className="text-sm text-muted-foreground">No movements in the last 30 days.</p>}
            {lastDays.map((d) => <div key={d.date} className="grid grid-cols-[5.5rem_1fr] gap-3 items-center text-xs">
              <span className="num">{d.date.slice(5)}</span>
              <div className="space-y-1"><div className="h-2 rounded bg-emerald-500/70" style={{ width: `${100 * d.incomingValue / peak}%` }} title={`In ${formatINR(d.incomingValue)}`} /><div className="h-2 rounded bg-orange-500/70" style={{ width: `${100 * d.outgoingValue / peak}%` }} title={`Out ${formatINR(d.outgoingValue)}`} /></div>
            </div>)}
            <p className="text-xs text-muted-foreground">Green: incoming · Orange: outgoing</p>
          </div>
        </section>
        <section className="rounded-lg border bg-card p-4">
          <div className="flex justify-between gap-2"><h2 className="font-semibold">Latest stock movements</h2><span className="text-xs text-muted-foreground">{formatDate(activity.data.fromDate)} – {formatDate(activity.data.toDate)}</span></div>
          {activity.data.recent.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No recent movements.</p> : <div className="mt-3 max-h-96 overflow-auto divide-y">
            {activity.data.recent.map((m) => <div key={m.id} className="py-2 flex justify-between gap-3 text-sm"><div><div className="font-medium">{m.itemName}</div><div className="text-xs text-muted-foreground">{m.docNo} · {m.type.replaceAll("_", " ")} · {m.at.slice(0, 10)}{m.batchNo ? ` · ${m.batchNo}` : ""}</div></div><div className={`num whitespace-nowrap ${m.qty > 0 ? "text-emerald-700" : "text-orange-700"}`}>{m.qty > 0 ? "+" : ""}{formatQty(m.qty, 3)}</div></div>)}
          </div>}
        </section>
      </div>}
      {tab === "inventory" && <section className="space-y-3">
        <p className="text-sm text-muted-foreground">Every active or inactive product in this organisation appears here, even when its warehouse balance is zero. Plus/minus creates an audited stock adjustment. Reserved stock cannot be reduced.</p>
        <div className="flex flex-wrap gap-2"><div className="relative flex-1 min-w-48"><Search aria-hidden className="absolute left-2.5 top-2.5 size-4 text-muted-foreground"/><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search product, SKU, brand…" className="pl-9" aria-label="Search warehouse products"/></div>
          <NativeSelect value={filter} onChange={(e) => setFilter(e.target.value as WarehouseStockFilter)} aria-label="Filter warehouse stock" className="w-44"><option value="all">All products</option><option value="available">Free stock &gt; 0</option><option value="zero">Out of free stock</option><option value="reserved">Has reservations</option></NativeSelect>
        </div>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead className="bg-muted/60 text-left"><tr><th className="p-3">Product / SKU</th><th className="p-3 text-right">On hand</th><th className="p-3 text-right">Reserved</th><th className="p-3 text-right">Free</th><th className="p-3 text-right">Value</th><th className="p-3 text-right">Adjust</th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.item.id} className="border-t"><td className="p-3"><p className="font-medium">{r.item.name}</p><p className="text-xs text-muted-foreground">{r.item.sku} · {r.item.baseUom}{r.item.active ? "" : " · Inactive"}</p></td><td className="num p-3 text-right">{formatQty(r.onHand, 3)}</td><td className="num p-3 text-right">{formatQty(r.held, 3)}</td><td className="num p-3 text-right">{formatQty(r.free, 3)}</td><td className="num p-3 text-right">{formatINR(r.value)}</td><td className="p-3"><div className="flex justify-end gap-1"><Button size="sm" variant="outline" aria-label={`Add stock for ${r.item.name}`} disabled={!canAdjust || !warehouse.active || !r.item.active} onClick={() => setEditingStock({ item: r.item, direction: "up" })}><Plus className="size-4" /></Button><Button size="sm" variant="outline" aria-label={`Remove stock for ${r.item.name}`} disabled={!canAdjust || !warehouse.active || !r.item.active || r.free <= 0} onClick={() => setEditingStock({ item: r.item, direction: "down" })}><Minus className="size-4" /></Button></div></td></tr>)}
          {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No matching products.</td></tr>}
        </tbody></table></div>
      </section>}
      {editingStock && <QuickStockAdjustment key={`${editingStock.item.id}:${editingStock.direction}`} orgId={orgId} warehouse={warehouse} item={editingStock.item} direction={editingStock.direction} onClose={() => setEditingStock(null)} />}
    </div>
  );
}

function WarehouseKpi({ label, value, hint, positive = false }: { label: string; value: string; hint: string; positive?: boolean }) {
  return <div className="rounded-lg border bg-card p-4"><div className="flex gap-2 items-center text-xs text-muted-foreground">{positive ? <ArrowDownRight className="size-4 text-emerald-600"/> : label.startsWith("Outgoing") ? <ArrowUpRight className="size-4 text-orange-600" /> : null}{label}</div><div className="num mt-2 text-xl font-semibold">{value}</div><div className="mt-1 text-xs text-muted-foreground">{hint}</div></div>;
}

function QuickStockAdjustment({ orgId, warehouse, item, direction, onClose }: { orgId: string; warehouse: Godown; item: Item; direction: "up" | "down"; onClose: () => void }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [unitCost, setUnitCost] = useState(String(item.costPrice || ""));
  const [notes, setNotes] = useState("");
  const [serverError, setServerError] = useState("");
  const date = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const s = item.stock.find((row) => row.godownId === warehouse.id);
  const availableBatches = item.batches.filter((b) => b.godownId === warehouse.id && b.qty > 0);
  const batch = availableBatches.find((b) => b.batchNo === batchNo);
  const cost = direction === "down" ? item.costPrice : Number(unitCost);
  const reason = direction === "up" ? "found" : "correction";
  const problems = adjustmentDraftProblems({ date, godownId: warehouse.id, reason, notes }, warehouse, date, [{
    itemId: item.id, itemName: item.name, active: item.active, direction, qty: Number(qty), onHand: s?.onHand ?? 0,
    held: s?.held ?? 0, unitCost: cost, trackBatches: item.trackBatches, batchNo: batchNo.trim() || undefined, batchQty: batch?.qty,
  }]);
  if (notes.trim().length < 3) problems.push("Enter at least 3 characters explaining this correction");
  const mutation = useMutation({
    mutationFn: () => api.createAdjustment({ date, godownId: warehouse.id, reason, notes: notes.trim(), lines: [{ itemId: item.id, direction, qty: Number(qty), unitCost: cost, ...(batchNo.trim() ? { batchNo: batchNo.trim() } : {}) }] }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ["warehouse-catalogue", orgId] });
      qc.invalidateQueries({ queryKey: ["warehouse-activity", orgId, warehouse.id] });
      qc.invalidateQueries({ queryKey: ["godowns", orgId] });
      qc.invalidateQueries({ queryKey: ["items", orgId] });
      qc.invalidateQueries({ queryKey: ["dashboard", orgId] });
      toast.success(a.status === "posted" ? `${a.number}: warehouse stock updated` : `${a.number}: submitted for approval; stock unchanged until approved`);
      onClose();
    },
    onError: (err: Error) => setServerError(err.message),
  });
  return <Dialog open onOpenChange={(open) => { if (!open && !mutation.isPending) onClose(); }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{direction === "up" ? "Add" : "Remove"} stock · {item.name}</DialogTitle></DialogHeader>
    <form id="quick-stock" onSubmit={(e) => { e.preventDefault(); if (!problems.length && !mutation.isPending) mutation.mutate(); }} className="space-y-3 text-sm">
      <p className="text-muted-foreground">{warehouse.name} · {item.sku} · {item.baseUom} · Free: {formatQty((s?.onHand ?? 0) - (s?.held ?? 0), 3)}</p>
      <Field label={`Quantity (${item.baseUom})`}><Input autoFocus type="number" min="0.001" max="999999999" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} required /></Field>
      {item.trackBatches && <Field label="Batch / heat number">
        {direction === "down" ? <NativeSelect value={batchNo} onChange={(e) => setBatchNo(e.target.value)}><option value="">Select batch…</option>{availableBatches.map((b) => <option value={b.batchNo} key={b.id}>{b.batchNo} · {formatQty(b.qty, 3)} available</option>)}</NativeSelect> : <Input value={batchNo} maxLength={60} onChange={(e) => setBatchNo(e.target.value)} placeholder="Existing or new batch number" required />}
      </Field>}
      {direction === "up" && <Field label="Unit cost (₹)"><Input type="number" min="0.01" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} required /></Field>}
      <Field label="Adjustment reason / audit note"><Input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Physical count correction" required /></Field>
      {problems.length > 0 && qty && <p role="alert" className="text-xs text-destructive">{problems[0]}</p>}
      {serverError && <p role="alert" className="text-xs text-destructive">{serverError}</p>}
      <p className="text-xs text-muted-foreground">This creates a numbered stock adjustment and ledger entry. Storekeeper adjustments above the approval threshold remain pending.</p>
    </form>
    <DialogFooter><Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button><Button form="quick-stock" type="submit" disabled={mutation.isPending || problems.length > 0}>{mutation.isPending ? "Posting…" : direction === "up" ? "Post + stock" : "Post − stock"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function GodownDialog({ orgId, initial, onClose }: { orgId: string; initial: GodownInput; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<GodownInput>(initial);
  const [serverError, setServerError] = useState("");
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const issues = godownProblems(d);
  const set = <K extends keyof GodownInput>(k: K, v: GodownInput[K]) => { setD((x) => ({ ...x, [k]: v })); setServerError(""); };
  const requestClose = () => {
    if (m.isPending) return;
    if (!dirty || window.confirm("Discard unsaved warehouse changes?")) onClose();
  };
  const m = useMutation({
    mutationFn: () => api.saveGodown(orgId, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["godowns", orgId] });
      qc.invalidateQueries({ queryKey: ["dashboard", orgId] });
      toast.success("Warehouse saved");
      onClose();
    },
    onError: (e: Error) => { setServerError(e.message); toast.error(e.message); },
  });
  return (
    <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{initial.id ? `Edit ${initial.name}` : "New warehouse"}</DialogTitle></DialogHeader>
        <form id="gd-form" className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); if (issues.length === 0 && !m.isPending) m.mutate(); }}>
          <Field label="Code"><Input autoFocus required value={d.code} maxLength={20} onChange={(e) => set("code", e.target.value.toUpperCase())} className="num" /></Field>
          <Field label="Name"><Input required value={d.name} maxLength={120} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Type"><NativeSelect value={d.type} onChange={(e) => set("type", e.target.value as GodownType)}>{Object.entries(TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect></Field>
          <Field label="Manager"><Input value={d.manager} maxLength={120} onChange={(e) => set("manager", e.target.value)} /></Field>
          <Field label="Address" className="col-span-2"><Input value={d.address} maxLength={400} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="State code"><Input required value={d.stateCode} maxLength={2} onChange={(e) => set("stateCode", e.target.value.replace(/\D/g, ""))} className="num" /></Field>
          <Field label="Separate GSTIN (optional)"><Input value={d.gstin ?? ""} maxLength={15} onChange={(e) => set("gstin", e.target.value.toUpperCase())} className="num" /></Field>
          <div className="col-span-2 space-y-2 rounded-md bg-muted/50 p-3 text-sm">
            <label className="flex items-center justify-between">Allow negative stock <Switch checked={d.allowNegative} onCheckedChange={(v) => set("allowNegative", v)} /></label>
            <label className="flex items-center justify-between">Default for sales <Switch checked={d.defaultForSales} onCheckedChange={(v) => set("defaultForSales", v)} /></label>
            <label className="flex items-center justify-between">Active <Switch checked={d.active} onCheckedChange={(v) => set("active", v)} /></label>
            {initial.id && <p className="text-xs text-muted-foreground">A warehouse with stock or held reservations can't be deactivated. Use stock documents to clear balances.</p>}
          </div>
          {issues.length > 0 && <div role="alert" className="col-span-2 space-y-1 text-xs text-destructive">{issues.map((issue) => <p key={issue}>{issue}</p>)}</div>}
          {serverError && <p role="alert" className="col-span-2 text-xs text-destructive">{serverError}</p>}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={requestClose} disabled={m.isPending}>Cancel</Button>
          <Button type="submit" form="gd-form" disabled={m.isPending || issues.length > 0 || (!!initial.id && !dirty)}>{m.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
