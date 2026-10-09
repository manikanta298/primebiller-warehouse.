import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, Plus, Save, Trash2, Truck, X, FileText, Receipt, Wallet } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/api/client";
import type { SalesOrder, SalesOrderInput, SOLine } from "@/api/types";
import { useSession } from "@/lib/session";
import { canOverrideCredit, computeTotals, creditCheck, supplyType, lineTaxable, type CreditCheck } from "@/lib/gst";
import { formatDate, formatINR, formatQty } from "@/lib/format";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ItemPicker } from "@/components/app/ItemPicker";
import { CreditOverrideDialog } from "@/components/app/CreditOverrideDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { indiaItemDate } from "@/lib/item-detail-rules";
import { orderDraftProblems } from "@/lib/sales-order-rules";

export const Route = createFileRoute("/_authenticated/sales-orders/$id")({
  head: () => ({
    meta: [
      { title: "Sales order — Girder" },
      { name: "description", content: "Create and confirm a sales order with GST totals and stock holds." },
      { property: "og:title", content: "Sales order — Girder" },
      { property: "og:description", content: "Create and confirm a sales order with GST totals and stock holds." },
    ],
  }),
  component: SalesOrderPage,
});

type Line = Omit<SOLine, "id"> & { key: string };

const emptyLine = (): Line => ({
  key: Math.random().toString(36).slice(2),
  itemId: "", itemName: "", hsn: "", uom: "", qty: 1, deliveredQty: 0, rate: 0, discountPct: 0, gstRate: 0,
});

function SalesOrderPage() {
  const { id } = Route.useParams();
  const session = useSession();
  const isNew = id === "new";
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["sales-order", session?.orgId, id], queryFn: () => api.getSalesOrder(id), enabled: !isNew && !!session?.orgId });
  if (!isNew && isLoading) return <LoadingRows rows={8} />;
  if (!isNew && error) return <ErrorState error={error} onRetry={() => refetch()} />;
  return <Editor key={`${session?.orgId}:${id}`} order={isNew ? null : data!} />;
}

function Editor({ order }: { order: SalesOrder | null }) {
  const session = useSession()!;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const org = session.orgs.find((o) => o.id === session.orgId)!;
  const editable = !order || order.status === "draft";

  const { data: customers = [] } = useQuery({ queryKey: ["parties", session.orgId, "customer"], queryFn: () => api.listParties("customer"), enabled: !!session.orgId });
  const { data: godowns = [] } = useQuery({ queryKey: ["godowns", session.orgId], queryFn: () => api.listGodowns(session.orgId!) });

  const [customerId, setCustomerId] = useState(order?.customerId ?? "");
  const [godownId, setGodownId] = useState(order?.godownId ?? (session.godownId !== "all" ? session.godownId : ""));
  const [date, setDate] = useState(order?.date ?? indiaItemDate());
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(() => (order?.lines.length ? order.lines.map((l) => ({ ...l, key: l.id })) : [emptyLine()]));
  const [creditOpen, setCreditOpen] = useState(false);
  const [credit, setCredit] = useState<CreditCheck | null>(null);
  useEffect(() => {
    if (order || !godowns.length) return;
    if (!godowns.some((g) => g.id === godownId && g.active)) {
      setGodownId(godowns.find((g) => g.active && g.defaultForSales)?.id ?? godowns.find((g) => g.active)?.id ?? "");
    }
  }, [godowns, godownId, order]);

  const customer = customers.find((c) => c.id === customerId);
  const type = supplyType(org.stateCode, customer?.stateCode ?? order?.placeOfSupplyCode ?? org.stateCode);
  const filled = lines.filter((l) => l.itemId);
  const totals = useMemo(() => computeTotals(filled, type), [filled, type]);
  const cc = customer ? creditCheck(customer.creditLimit, customer.outstanding, totals.grandTotal) : null;

  const input = (): SalesOrderInput => ({
    id: order?.id,
    date,
    customerId,
    godownId,
    notes,
    lines: filled.map(({ key: _k, deliveredQty: _d, ...l }) => l),
  });
  const cleanSnapshot = useRef<string | null>(null);
  const currentSnapshot = JSON.stringify(input());
  if (cleanSnapshot.current === null) cleanSnapshot.current = currentSnapshot;
  const unsaved = editable && currentSnapshot !== cleanSnapshot.current;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
  const discardChanges = () => !unsaved || window.confirm("Discard unsaved sales order changes?");

  const afterSave = (o: SalesOrder) => {
    cleanSnapshot.current = JSON.stringify({ ...input(), id: o.id });
    qc.setQueryData(["sales-order", session.orgId, o.id], o);
    qc.invalidateQueries({ queryKey: ["sales-orders"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    if (!order) navigate({ to: "/sales-orders/$id", params: { id: o.id }, replace: true });
  };

  const validate = () => {
    const issues = orderDraftProblems({ date, customerId, godownId, notes, lines: filled });
    if (issues.length) return toast.error(issues[0]!), false;
    return true;
  };

  const save = useMutation({
    mutationFn: () => api.saveSalesOrder(input()),
    onSuccess: (o) => {
      toast.success("Draft saved");
      afterSave(o);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirm = useMutation({
    mutationFn: async (override?: { reason: string }) => {
      const saved = await api.saveSalesOrder(input());
      try {
        return await api.confirmSalesOrder(saved.id, override);
      } catch (e) {
        if (!order) afterSave(saved);
        throw e;
      }
    },
    onSuccess: (o) => {
      setCreditOpen(false);
      toast.success(`${o.number} confirmed · stock held at ${godowns.find((g) => g.id === o.godownId)?.name}`);
      qc.invalidateQueries({ queryKey: ["items"] });
      afterSave(o);
      qc.invalidateQueries({ queryKey: ["sales-order", session.orgId, o.id] });
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.code === "credit_limit") {
        setCredit(e.details as CreditCheck);
        setCreditOpen(true);
      } else if (e instanceof ApiError && e.code === "insufficient_stock") {
        toast.error("Not enough free stock", { description: (e.details as string[]).join(" · ") });
      } else toast.error(e.message);
    },
  });

  const cancel = useMutation({
    mutationFn: () => api.cancelSalesOrder(order!.id),
    onSuccess: (o) => {
      toast.success("Order cancelled · held stock released");
      afterSave(o);
      qc.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = save.isPending || confirm.isPending;
  const doSave = useCallback(() => editable && !busy && validate() && save.mutate(), [editable, busy, customerId, lines, date, notes, godownId]);
  const doConfirm = useCallback(() => editable && !busy && validate() && confirm.mutate(undefined), [editable, busy, customerId, lines, date, notes, godownId]);
  const keys = useRef({ doSave, doConfirm });
  keys.current = { doSave, doConfirm };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === "s") { e.preventDefault(); keys.current.doSave(); }
      if (e.key === "Enter") { e.preventDefault(); keys.current.doConfirm(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const canDeliver = order && (order.status === "confirmed" || order.status === "partially_delivered");
  const canCancel = order && (order.status === "draft" || order.status === "confirmed");

  return (
    <div>
      <Link to="/sales-orders" onClick={(event) => { if (!discardChanges()) event.preventDefault(); }} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Sales orders
      </Link>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1">Sales order</div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            <span className="num">{order?.number ?? (order ? "Draft" : "New order")}</span>
            <StatusBadge status={order?.status ?? "draft"} />
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCancel && (
            <Button variant="outline" onClick={() => { if (window.confirm("Cancel this order? Any held stock will be released.")) cancel.mutate(); }} disabled={cancel.isPending || busy}>
              <X /> Cancel order
            </Button>
          )}
          {canDeliver && (
            <Button variant="outline" asChild>
              <Link to="/challans/new" search={{ soId: order.id }}><Truck /> Create delivery challan</Link>
            </Button>
          )}
          <Button variant="outline" onClick={doSave} disabled={!editable || busy}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save draft <span className="kbd">Ctrl S</span>
          </Button>
          <Button variant="ember" onClick={doConfirm} disabled={!editable || busy}>
            {confirm.isPending ? <Loader2 className="animate-spin" /> : <Check />} Confirm & hold stock
            <span className="kbd border-ember-foreground/30 bg-transparent text-ember-foreground">Ctrl ↵</span>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <section className="grid gap-4 rounded-lg border bg-card p-5 md:grid-cols-4">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs text-muted-foreground">Customer</label>
              <select
                disabled={!editable}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id} disabled={!!c.blocked}>{c.name} · {c.city}{c.blocked ? " (blocked)" : ""}</option>
                ))}
              </select>
              {customer && <div className="num text-xs text-muted-foreground">{customer.gstin ?? "Unregistered"} · {customer.stateName} ({customer.stateCode})</div>}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Order date</label>
              <Input type="date" disabled={!editable} value={date} onChange={(e) => setDate(e.target.value)} className="num" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Dispatch from</label>
              <select disabled={!editable} value={godownId} onChange={(e) => setGodownId(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="">Select godown…</option>
                {godowns.filter((g) => g.active || g.id === godownId).map((g) => <option key={g.id} value={g.id} disabled={!g.active}>{g.name}{g.active ? "" : " (inactive)"}</option>)}
              </select>
            </div>
          </section>

          <section className="overflow-visible rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <h2 className="text-sm font-semibold">Lines</h2>
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", type === "intra" ? "bg-primary/10 text-primary" : "bg-ember/15 text-ember")}>
                {type === "intra" ? `Intra-state · CGST + SGST` : `Inter-state · IGST`} · Place of supply {customer?.stateName ?? org.stateName}
              </span>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-sm">
              <thead className="bg-muted/60">
                <tr className="eyebrow text-left">
                  <th className="w-8 px-3 py-2 font-semibold">#</th>
                  <th className="min-w-56 font-semibold">Item</th>
                  <th className="font-semibold">HSN</th>
                  <th className="w-28 text-right font-semibold">Qty</th>
                  <th className="w-32 text-right font-semibold">Rate ₹</th>
                  <th className="w-20 text-right font-semibold">Disc %</th>
                  <th className="w-14 text-right font-semibold">GST</th>
                  <th className="w-32 px-3 text-right font-semibold">Taxable</th>
                  {order && order.status !== "draft" && <th className="w-24 px-3 text-right font-semibold">Delivered</th>}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.key} className="border-t align-middle">
                    <td className="num px-3 text-xs text-muted-foreground">{i + 1}</td>
                    <td>
                      <ItemPicker
                        value={l.itemName}
                        godownId={godownId}
                        disabled={!editable}
                        onPick={(it) => setLine(l.key, { itemId: it.id, itemName: it.name, hsn: it.hsn, uom: it.baseUom, rate: it.salePrice, gstRate: it.gstRate })}
                        onClear={() => setLine(l.key, { itemId: "", itemName: "", hsn: "", uom: "", rate: 0, gstRate: 0 })}
                      />
                    </td>
                    <td className="num text-xs text-muted-foreground">{l.hsn}</td>
                    <td><NumCell value={l.qty} disabled={!editable} onChange={(v) => setLine(l.key, { qty: v })} suffix={l.uom} /></td>
                    <td><NumCell value={l.rate} disabled={!editable} onChange={(v) => setLine(l.key, { rate: v })} /></td>
                    <td><NumCell value={l.discountPct} disabled={!editable} onChange={(v) => setLine(l.key, { discountPct: v })} /></td>
                    <td className="num text-right text-xs">{l.itemId ? `${l.gstRate}%` : ""}</td>
                    <td className="num px-3 text-right">{l.itemId ? formatINR(lineTaxable(l)) : ""}</td>
                    {order && order.status !== "draft" && <td className="num px-3 text-right text-xs">{formatQty(l.deliveredQty)} / {formatQty(l.qty)}</td>}
                    <td>
                      {editable && (
                        <button aria-label="Remove line" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [emptyLine()]))} className="p-1 text-muted-foreground hover:text-destructive">
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {editable && (
              <div className="border-t px-3 py-2">
                <Button variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                  <Plus /> Add line
                </Button>
              </div>
            )}
          </section>

          <section className="rounded-lg border bg-card p-5">
            <label className="text-xs text-muted-foreground">Notes for delivery / invoice</label>
            <Textarea disabled={!editable} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" placeholder="Site address, unloading instructions…" />
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">Order totals</h2>
            <dl className="space-y-1.5 text-sm">
              <Row k="Taxable value" v={totals.taxable} />
              {type === "intra" ? (
                <>
                  <Row k="CGST" v={totals.cgst} />
                  <Row k="SGST" v={totals.sgst} />
                </>
              ) : (
                <Row k="IGST" v={totals.igst} />
              )}
              <Row k="Round off" v={totals.roundOff} muted />
              <div className="mt-2 flex items-baseline justify-between border-t pt-3">
                <dt className="font-semibold">Grand total</dt>
                <dd className="num text-xl font-semibold">{formatINR(totals.grandTotal)}</dd>
              </div>
            </dl>
            {totals.byRate.length > 0 && (
              <div className="mt-4 rounded-md bg-muted p-3">
                <div className="eyebrow mb-1.5">Tax by rate</div>
                {totals.byRate.map((r) => (
                  <div key={r.rate} className="num flex justify-between text-xs">
                    <span>{r.rate}% on {formatINR(r.taxable, 0)}</span>
                    <span>{formatINR(r.tax)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {cc && (
            <section className={cn("rounded-lg border p-5", cc.exceeds ? "border-destructive/40 bg-destructive/5" : "bg-card")}>
              <h2 className="mb-3 text-sm font-semibold">Credit check</h2>
              {cc.limit === 0 ? (
                <p className="text-sm text-muted-foreground">Cash customer · no credit limit set.</p>
              ) : (
                <dl className="space-y-1.5 text-sm">
                  <Row k="Limit" v={cc.limit} />
                  <Row k="Outstanding" v={cc.outstanding} />
                  <Row k="Available" v={cc.available} />
                  <div className="h-2 rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", cc.exceeds ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.min(100, ((cc.outstanding + cc.orderTotal) / cc.limit) * 100)}%` }} />
                  </div>
                  {cc.exceeds && <p className="pt-1 text-xs text-destructive">This order exceeds available credit. {canOverrideCredit(session.user.role) ? "You can override on confirm." : "Owner approval needed."}</p>}
                </dl>
              )}
            </section>
          )}

          {order?.creditOverride && (
            <section className="rounded-lg border border-ember/40 bg-ember/5 p-4 text-sm">
              <div className="font-medium">Credit override by {order.creditOverride.by}</div>
              <div className="text-muted-foreground">{order.creditOverride.reason}</div>
            </section>
          )}

          <section className="rounded-lg border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">Related documents</h2>
            {!order?.linked.length ? (
              <p className="text-sm text-muted-foreground">None yet. Challans, invoices and receipts will appear here.</p>
            ) : (
              <ul className="space-y-2">
                {order.linked.map((d) => {
                  const Icon = d.type === "delivery_challan" ? Truck : d.type === "tax_invoice" ? Receipt : d.type === "receipt" ? Wallet : FileText;
                  return (
                    <li key={d.number} className="flex items-start gap-2.5 rounded-md border p-2.5">
                      <Icon className="mt-0.5 size-4 text-primary" />
                      <div className="flex-1">
                        <div className="num text-xs font-medium">{d.number}</div>
                        <div className="text-xs text-muted-foreground">{formatDate(d.date)} · {d.status}</div>
                      </div>
                      <div className="num text-xs">{formatINR(d.amount, 0)}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <CreditOverrideDialog
        open={creditOpen}
        onOpenChange={setCreditOpen}
        check={credit}
        customer={customer?.name ?? ""}
        canOverride={canOverrideCredit(session.user.role)}
        pending={confirm.isPending}
        onOverride={(reason) => confirm.mutate({ reason })}
      />
    </div>
  );
}

function NumCell({ value, onChange, disabled, suffix }: { value: number; onChange: (v: number) => void; disabled?: boolean; suffix?: string }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <input
        type="number"
        step="any"
        disabled={disabled}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="num h-8 w-full rounded border-0 bg-transparent px-2 text-right text-sm outline-none focus:bg-card focus:ring-1 focus:ring-ring disabled:opacity-100"
      />
      {suffix && <span className="text-[10px] text-muted-foreground">{suffix}</span>}
    </div>
  );
}

function Row({ k, v, muted }: { k: string; v: number; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between", muted && "text-muted-foreground")}>
      <dt>{k}</dt>
      <dd className="num">{formatINR(v)}</dd>
    </div>
  );
}
