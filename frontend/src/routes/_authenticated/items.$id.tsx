import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Item, ItemGodownStock } from "@/api/types";
import { can } from "@/lib/permissions";
import { canAccess, useSession } from "@/lib/session";
import { stockFor } from "@/lib/stock";
import {
  calendarDaysBetween, hasItemInventory, indiaItemDate, itemEditPatch,
  itemEditProblems, type ItemEditPatch,
} from "@/lib/item-detail-rules";
import { formatDate, formatINR, formatQty, formatCompactINR } from "@/lib/format";
import { ErrorState, LoadingRows, EmptyState } from "@/components/app/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/items/$id")({
  head: () => ({
    meta: [
      { title: "Item — Girder" },
      { name: "description", content: "Item details, tax, units, per-godown rules and batches." },
      { property: "og:title", content: "Item — Girder" },
      { property: "og:description", content: "Item details, tax, units, per-godown rules and batches." },
    ],
  }),
  component: ItemDetail,
});

// Show a cleared number input as empty, so users can replace digits normally.
const numInput = (n: number) => Number.isFinite(n) ? n : "";
const parseNumber = (value: string) => value.trim() === "" ? Number.NaN : Number(value);

function ItemDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const session = useSession();
  const orgId = session?.orgId;
  const canEdit = can(session?.user.role, "editItems");
  const canViewLedger = session ? canAccess(session.user.role, "/stock-ledger") : false;
  // The edit buffer is keyed to both org and item. It can never leak to another
  // organisation when a user changes organisation without leaving this route.
  const editKey = `${orgId ?? ""}/${id}`;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["item", orgId, id], queryFn: () => api.getItem(id), enabled: !!orgId,
    refetchOnWindowFocus: false,
  });
  const { data: godowns = [], error: godownError } = useQuery({
    queryKey: ["godowns", orgId], queryFn: () => api.listGodowns(orgId!), enabled: !!orgId,
  });
  const [edit, setEdit] = useState<{ key: string; value: Item } | null>(null);
  const draft = edit?.key === editKey ? edit.value : data;
  const patch = useMemo(() => data && draft ? itemEditPatch(data, draft) : {}, [data, draft]);
  const dirty = Object.keys(patch).length > 0;
  const issues = useMemo(() => data && draft ? itemEditProblems(draft, data, godowns.map((g) => g.id)) : [], [data, draft, godowns]);

  const save = useMutation({
    mutationFn: (changes: ItemEditPatch) => api.updateItem(id, changes),
    onSuccess: (saved) => {
      qc.setQueryData(["item", orgId, id], saved);
      qc.invalidateQueries({ queryKey: ["items", orgId] });
      qc.invalidateQueries({ queryKey: ["dashboard", orgId] });
      setEdit(null);
      toast.success("Item saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (isLoading || (!data && !error)) return <LoadingRows />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const d = draft!;
  const set = (change: (current: Item) => Item) => {
    if (!canEdit || !draft) return;
    setEdit({ key: editKey, value: change(draft) });
  };
  const field = (change: Partial<Item>) => set((current) => ({ ...current, ...change }));
  const reset = () => setEdit(null);
  const all = stockFor(d, "all");
  const margin = Number.isFinite(d.salePrice) && Number.isFinite(d.costPrice) && d.salePrice > 0 ? `${(((d.salePrice - d.costPrice) / d.salePrice) * 100).toFixed(1)}%` : "—";
  const gName = (gid: string) => godowns.find((g) => g.id === gid)?.name ?? gid;
  const hasInventory = hasItemInventory(data!);
  const today = indiaItemDate();

  // Show even godowns that have not received stock yet, so a zero-stock item can
  // acquire thresholds safely without creating or editing inventory quantities.
  const configured = new Map(d.stock.map((row) => [row.godownId, row]));
  const stockRows: ItemGodownStock[] = godowns.length
    ? [...godowns.map((g) => configured.get(g.id) ?? { godownId: g.id, onHand: 0, held: 0, reorderLevel: 0, maxLevel: 0 }),
        ...d.stock.filter((s) => !godowns.some((g) => g.id === s.godownId))]
    : d.stock;
  const setThreshold = (gid: string, kind: "reorderLevel" | "maxLevel", value: number) => {
    set((current) => {
      const exists = current.stock.some((s) => s.godownId === gid);
      return {
        ...current,
        stock: exists
          ? current.stock.map((s) => s.godownId === gid ? { ...s, [kind]: value } : s)
          : [...current.stock, { godownId: gid, onHand: 0, held: 0, reorderLevel: 0, maxLevel: 0, [kind]: value }],
      };
    });
  };

  return (
    <div>
      <Link to="/items" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Items
      </Link>
      {canViewLedger && (
        <Link to="/stock-ledger" search={{ item: d.id }} className="mb-3 ml-4 inline-flex text-sm text-primary hover:underline">
          View ledger
        </Link>
      )}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="num eyebrow mb-1">{d.sku}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{d.name}</h1>
          <div className="mt-1 text-sm text-muted-foreground">
            {d.brand} · {d.category} · HSN <span className="num">{d.hsn}</span> · GST <span className="num">{d.gstRate}%</span>
            {!d.active && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">Inactive</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && dirty && (
            <Button variant="outline" onClick={reset} disabled={save.isPending}><RotateCcw className="size-4" /> Discard changes</Button>
          )}
          {canEdit && (
            <Button
              onClick={() => { if (issues.length === 0 && dirty) save.mutate(patch); }}
              disabled={!dirty || issues.length > 0 || save.isPending || !!godownError}
            >
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save changes
            </Button>
          )}
        </div>
      </div>

      {!canEdit && <p className="mb-4 rounded-md border bg-muted/50 px-4 py-2 text-sm text-muted-foreground">Read-only view. Only an Owner or Manager can edit items.</p>}
      {godownError && <p role="alert" className="mb-4 rounded-md border border-destructive px-4 py-2 text-sm text-destructive">Godowns could not be loaded. Refresh before editing per-godown settings.</p>}
      {dirty && issues.length > 0 && (
        <div role="alert" className="mb-4 rounded-md border border-destructive/50 px-4 py-3 text-sm text-destructive">
          <div className="mb-1 font-semibold">Fix these fields before saving:</div>
          <ul className="list-disc space-y-1 pl-5">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </div>
      )}
      {dirty && issues.length === 0 && <p className="mb-4 text-xs text-muted-foreground" role="status">You have unsaved changes.</p>}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["On hand", `${formatQty(all.onHand)} ${d.baseUom}`],
          ["Held for orders", formatQty(all.held)],
          ["Free", formatQty(all.free)],
          ["Stock value", formatCompactINR(all.onHand * d.costPrice)],
          ["Margin", margin],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border bg-card px-4 py-3">
            <div className="eyebrow">{k}</div><div className="num mt-1 text-lg font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="general">
        <TabsList className="mb-2 flex h-auto w-fit max-w-full flex-wrap">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="tax">Tax</TabsTrigger>
          <TabsTrigger value="units">Units</TabsTrigger>
          <TabsTrigger value="godown">Per godown</TabsTrigger>
          <TabsTrigger value="batches">Batches</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="rounded-lg border bg-card p-5">
          <fieldset disabled={!canEdit} className="grid gap-4 md:grid-cols-2">
            <Field label="Name"><Input aria-label="Name" maxLength={200} value={d.name} onChange={(e) => field({ name: e.target.value })} /></Field>
            <Field label="SKU"><Input aria-label="SKU" maxLength={40} className="num" value={d.sku} onChange={(e) => field({ sku: e.target.value })} /></Field>
            <Field label="Brand"><Input aria-label="Brand" maxLength={80} value={d.brand} onChange={(e) => field({ brand: e.target.value })} /></Field>
            <Field label="Category"><Input aria-label="Category" maxLength={80} value={d.category} onChange={(e) => field({ category: e.target.value })} /></Field>
            <Field label="Sale price (₹ per base unit)"><Input aria-label="Sale price" className="num" type="number" min={0} step="0.01" value={numInput(d.salePrice)} onChange={(e) => field({ salePrice: parseNumber(e.target.value) })} /></Field>
            <Field label="Cost price (₹)"><Input aria-label="Cost price" className="num" type="number" min={0} step="0.01" value={numInput(d.costPrice)} onChange={(e) => field({ costPrice: parseNumber(e.target.value) })} /></Field>
          </fieldset>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Toggle label="Track batches / heat numbers" checked={d.trackBatches} disabled={!canEdit || hasInventory} hint={hasInventory ? "Locked because stock or batches exist" : undefined} onChange={(v) => field({ trackBatches: v })} />
            <Toggle label="Allow negative stock" hint="Lets orders confirm beyond free stock" checked={d.allowNegative} disabled={!canEdit} onChange={(v) => field({ allowNegative: v })} />
            <Toggle label="Active item" hint="Deactivation requires zero on-hand and held quantity" checked={d.active} disabled={!canEdit || (hasInventory && d.active)} onChange={(v) => field({ active: v })} />
          </div>
        </TabsContent>

        <TabsContent value="tax" className="rounded-lg border bg-card p-5">
          <fieldset disabled={!canEdit} className="grid gap-4 md:grid-cols-3">
            <Field label="HSN code"><Input aria-label="HSN code" maxLength={8} className="num" inputMode="numeric" value={d.hsn} onChange={(e) => field({ hsn: e.target.value })} /></Field>
            <Field label="GST rate">
              <select aria-label="GST rate" className="h-9 w-full rounded-md border bg-background px-2 text-sm num" value={d.gstRate} onChange={(e) => field({ gstRate: Number(e.target.value) })}>
                {[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
              </select>
            </Field>
            <div className="rounded-md bg-muted p-3 text-sm">
              <div className="eyebrow mb-1">Split</div>
              <div className="num">Intra-state: CGST {d.gstRate / 2}% + SGST {d.gstRate / 2}%</div>
              <div className="num">Inter-state: IGST {d.gstRate}%</div>
            </div>
          </fieldset>
        </TabsContent>

        <TabsContent value="units" className="rounded-lg border bg-card p-5">
          <div className="mb-4 flex max-w-xs items-end gap-3">
            <Field label="Base unit">
              <Input aria-label="Base unit" maxLength={12} className="num" disabled={!canEdit || hasInventory} value={d.baseUom}
                onChange={(e) => {
                  const base = e.target.value.toUpperCase();
                  set((prev) => ({ ...prev, baseUom: base, conversions: prev.conversions.map((c) => c.uom === prev.baseUom ? { ...c, uom: base } : c) }));
                }} />
            </Field>
            {hasInventory && <span className="pb-2 text-xs text-muted-foreground">Locked after stock movements</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full max-w-2xl min-w-[420px] text-sm">
              <thead><tr className="eyebrow border-b text-left"><th className="py-2 font-semibold">Unit</th><th className="font-semibold">= base units</th><th className="text-right font-semibold">Price per unit</th><th className="w-12" /></tr></thead>
              <tbody>
                {d.conversions.map((c, i) => {
                  const isBase = c.uom === d.baseUom;
                  return (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2">
                        <Input aria-label={`Unit ${i + 1}`} className="num h-8 w-28" maxLength={12} disabled={!canEdit || isBase}
                          value={c.uom} onChange={(e) => set((prev) => ({ ...prev, conversions: prev.conversions.map((x, j) => j === i ? { ...x, uom: e.target.value.toUpperCase() } : x) }))} />
                      </td>
                      <td>
                        <Input aria-label={`Conversion factor ${i + 1}`} className="num h-8 w-28" type="number" min={0.001} step="any" disabled={!canEdit || isBase}
                          value={numInput(c.factor)} onChange={(e) => set((prev) => ({ ...prev, conversions: prev.conversions.map((x, j) => j === i ? { ...x, factor: parseNumber(e.target.value) } : x) }))} />
                      </td>
                      <td className="num text-right">{Number.isFinite(c.factor) ? formatINR(d.salePrice * c.factor) : "—"}</td>
                      <td className="text-right">
                        {canEdit && !isBase && <Button aria-label={`Remove unit ${c.uom || i + 1}`} variant="ghost" size="icon" onClick={() => set((prev) => ({ ...prev, conversions: prev.conversions.filter((_, j) => j !== i) }))}><Trash2 className="size-4" /></Button>}
                        {canEdit && isBase && c.factor !== 1 && <Button variant="outline" size="sm" onClick={() => set((prev) => ({ ...prev, conversions: prev.conversions.map((x, j) => j === i ? { ...x, factor: 1 } : x) }))}>Set to 1</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canEdit && (
            <div className="mt-3 flex flex-wrap gap-2">
              {!d.conversions.some((c) => c.uom === d.baseUom) && (
                <Button variant="outline" size="sm" onClick={() => set((prev) => ({ ...prev, conversions: [{ uom: prev.baseUom, factor: 1 }, ...prev.conversions] }))}>Restore base unit</Button>
              )}
              <Button variant="outline" size="sm" onClick={() => set((prev) => ({ ...prev, conversions: [...prev.conversions, { uom: "", factor: 1 }] }))}><Plus className="size-4" /> Add alternate unit</Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="godown" className="overflow-x-auto rounded-lg border bg-card">
          <p className="px-4 py-3 text-xs text-muted-foreground">Only reorder and maximum levels are editable. Stock quantities and reservations are updated through stock documents.</p>
          <table className="w-full min-w-[750px] text-sm">
            <thead className="bg-muted/60"><tr className="eyebrow text-left"><th className="px-4 py-2.5 font-semibold">Godown</th><th className="text-right font-semibold">On hand</th><th className="text-right font-semibold">Held</th><th className="text-right font-semibold">Free</th><th className="px-2 font-semibold">Reorder at</th><th className="px-2 font-semibold">Max</th><th className="px-4 font-semibold">Status</th></tr></thead>
            <tbody>
              {stockRows.map((s) => {
                const free = s.onHand - s.held;
                const status = free <= 0 ? "Out of stock" : s.reorderLevel > 0 && free < s.reorderLevel ? "Below reorder" : s.maxLevel > 0 && s.onHand > s.maxLevel ? "Over max" : "OK";
                return (
                  <tr key={s.godownId} className="border-t">
                    <td className="px-4 py-2">{gName(s.godownId)}</td>
                    <td className="num text-right">{formatQty(s.onHand)}</td>
                    <td className="num text-right text-muted-foreground">{formatQty(s.held)}</td>
                    <td className="num text-right font-medium">{formatQty(free)}</td>
                    {(["reorderLevel", "maxLevel"] as const).map((key) => (
                      <td key={key} className="px-2">
                        <Input aria-label={`${key === "reorderLevel" ? "Reorder" : "Maximum"} level at ${gName(s.godownId)}`} className="num h-8 w-24" type="number" step="0.001" min={0} disabled={!canEdit}
                          value={numInput(s[key])} onChange={(e) => setThreshold(s.godownId, key, parseNumber(e.target.value))} />
                      </td>
                    ))}
                    <td className="px-4"><span className={cn("text-xs font-medium", status === "Out of stock" ? "text-destructive" : status === "Below reorder" ? "text-ember" : "text-muted-foreground")}>{status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {stockRows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">No godowns are configured for this organisation.</p>}
        </TabsContent>

        <TabsContent value="batches">
          {d.batches.length === 0 ? (
            <EmptyState title={d.trackBatches ? "No batches in stock" : "Batch tracking is off"} hint={d.trackBatches ? "Batches appear when goods are received on a GRN." : "Turn on batch tracking under General."} />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <p className="px-4 py-3 text-xs text-muted-foreground">Batch records are read-only. Receive or adjust goods through the inventory workflow.</p>
              <table className="w-full min-w-[650px] text-sm">
                <thead className="bg-muted/60"><tr className="eyebrow text-left"><th className="px-4 py-2.5 font-semibold">Batch / heat</th><th className="font-semibold">Godown</th><th className="text-right font-semibold">Qty</th><th className="font-semibold pl-6">Received</th><th className="font-semibold">Expiry</th><th className="px-4 text-right font-semibold">Age</th></tr></thead>
                <tbody>
                  {[...d.batches].sort((a, b) => a.receivedDate.localeCompare(b.receivedDate)).map((b) => {
                    const age = calendarDaysBetween(b.receivedDate, today);
                    const daysLeft = b.expiryDate ? calendarDaysBetween(today, b.expiryDate) : null;
                    return (
                      <tr key={b.id} className="border-t">
                        <td className="num px-4 py-2">{b.batchNo}{b.heatNo && <span className="ml-2 text-xs text-muted-foreground">heat {b.heatNo}</span>}</td>
                        <td>{gName(b.godownId)}</td><td className="num text-right">{formatQty(b.qty)}</td>
                        <td className="pl-6">{formatDate(b.receivedDate)}</td>
                        <td className={cn(daysLeft !== null && daysLeft < 0 ? "text-destructive" : daysLeft !== null && daysLeft < 30 && "text-ember")}>
                          {b.expiryDate ? formatDate(b.expiryDate) : "—"}
                          {daysLeft !== null && <span className="num ml-1 text-xs">({daysLeft < 0 ? `${-daysLeft}d ago` : `${daysLeft}d`})</span>}
                        </td>
                        <td className={cn("num px-4 text-right", age > 90 && "text-ember")}>{age}d</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2.5">
      <div><div className="text-sm">{label}</div>{hint && <div className="text-xs text-muted-foreground">{hint}</div>}</div>
      <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
