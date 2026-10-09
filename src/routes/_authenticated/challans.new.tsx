import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, FileCheck2, Truck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/api/client";
import type { ChallanAllocation, Item, SalesOrder } from "@/api/types";
import { computeTotals, ewayBillRequired, supplyType } from "@/lib/gst";
import { dispatchPlanProblems, dispatchTransportProblems, ewbValidityDays, planFifoAllocations, isManualOverride } from "@/lib/challan-rules";
import { formatDate, formatINR, formatQty } from "@/lib/format";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { Field } from "@/components/app/form-bits";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/challans/new")({
  validateSearch: z.object({ soId: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "New delivery challan — Girder" },
      { name: "description", content: "Pick a sales order, choose lines and batches, add the vehicle and dispatch." },
      { property: "og:title", content: "New delivery challan — Girder" },
      { property: "og:description", content: "Pick a sales order, choose lines and batches, add the vehicle and dispatch." },
    ],
  }),
  component: ChallanWizard,
});

const STEPS = ["Sales order", "Lines", "Batches", "Vehicle & driver", "Dispatch"];

function ChallanWizard() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useSession();
  const org = session?.orgs.find((o) => o.id === session.orgId);
  const [step, setStep] = useState(search.soId ? 1 : 0);
  const [soId, setSoId] = useState(search.soId ?? "");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [alloc, setAlloc] = useState<Record<string, ChallanAllocation[]>>({});
  const [reason, setReason] = useState("");
  const [t, setT] = useState({ vehicleNo: "", driverName: "", driverPhone: "", transporter: "Own vehicle", distanceKm: 0 });

  const orders = useQuery({ queryKey: ["sales-orders", session?.orgId, "all"], queryFn: () => api.listSalesOrders(), enabled: !!session?.orgId });
  const items = useQuery({ queryKey: ["items", session?.orgId], queryFn: () => api.listItems(), enabled: !!session?.orgId });
  const godowns = useQuery({ queryKey: ["godowns", session?.orgId], queryFn: () => api.listGodowns(session?.orgId ?? "") });
  const open = (orders.data ?? []).filter((o) => o.status === "confirmed" || o.status === "partially_delivered");
  const so = open.find((o) => o.id === soId);
  const itemById = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);

  const batchesFor = (it: Item | undefined, godownId: string) => (it?.trackBatches ? it.batches.filter((b) => b.godownId === godownId && b.qty > 0) : []);
  const plan = (quantities: Record<string, number>): Record<string, ChallanAllocation[]> => so
    ? planFifoAllocations(so.lines.map((l) => ({ soLineId: l.id, qty: quantities[l.id] ?? 0, allocations: [] })), so.lines, items.data ?? [], so.godownId)
    : {};

  // Default lines to pending qty and FIFO batches whenever the order changes.
  useEffect(() => {
    if (!so || !items.data) return;
    const q: Record<string, number> = {};
    so.lines.forEach((l) => { q[l.id] = Math.max(0, l.qty - l.deliveredQty); });
    setQty(q);
    setAlloc(plan(q));
    setReason("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [so?.id, items.data]);

  const setLineQty = (id: string, v: number) => {
    const next = { ...qty, [id]: v };
    setQty(next);
    setAlloc(plan(next)); // recompute FIFO across repeated items/order lines
    setReason("");
  };

  const chosen = (so?.lines ?? []).filter((l) => (qty[l.id] ?? 0) > 0);
  const totals = computeTotals(chosen.map((l) => ({ ...l, qty: qty[l.id] ?? 0 })), supplyType(org?.stateCode ?? "36", so?.placeOfSupplyCode ?? "36"));
  const drafted = chosen.map((l) => ({ soLineId: l.id, qty: qty[l.id] ?? 0, allocations: alloc[l.id] ?? [] }));
  const suggested = plan(qty);
  const override = chosen.some((l) => isManualOverride(alloc[l.id] ?? [], suggested[l.id] ?? []));
  const needEwb = ewayBillRequired(totals.grandTotal);
  const planProblems = so ? dispatchPlanProblems(drafted, so.lines, items.data ?? [], so.godownId, override ? reason : undefined) : ["Pick a sales order"];
  const transportProblems = dispatchTransportProblems(t, totals.grandTotal);
  const problems = [...planProblems, ...transportProblems];

  const dispatch = useMutation({
    mutationFn: () => api.dispatchChallan({
      soId, vehicleNo: t.vehicleNo, driverName: t.driverName, driverPhone: t.driverPhone, transporter: t.transporter, distanceKm: t.distanceKm,
      overrideReason: override ? reason : undefined,
      lines: chosen.map((l) => ({ soLineId: l.id, qty: qty[l.id]!, allocations: alloc[l.id] ?? [] })),
    }),
    onSuccess: (c) => {
      qc.invalidateQueries();
      toast.success(`${c.number} dispatched${c.ewb ? ` · test EWB ${c.ewb.number}` : ""}`);
      navigate({ to: "/challans/$id", params: { id: c.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!can(session?.user.role, "dispatch")) return <EmptyState title="You cannot dispatch challans" hint="Ask an Owner or Manager for dispatch access." />;

  const stepOk = [!!so, chosen.length > 0 && chosen.every((l) => Number.isFinite(qty[l.id]) && (qty[l.id] ?? 0) <= l.qty - l.deliveredQty && (qty[l.id] ?? 0) > 0), planProblems.length === 0, transportProblems.length === 0, problems.length === 0];
  const godownName = (id: string) => godowns.data?.find((g) => g.id === id)?.name ?? id;

  return (
    <div>
      <Link to="/challans" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Delivery challans</Link>
      <div className="mb-5"><div className="eyebrow mb-1">New delivery challan</div><h1 className="text-2xl font-semibold tracking-tight">{so ? <>Dispatch <span className="num">{so.number}</span> · {so.customerName}</> : "Dispatch a sales order"}</h1></div>

      <ol className="mb-6 flex flex-wrap gap-2 text-sm">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" disabled={i > 0 && !stepOk.slice(0, i).every(Boolean)} onClick={() => setStep(i)}
              className={cn("flex items-center gap-2 rounded-full border px-3 py-1 disabled:opacity-50", i === step ? "border-primary bg-primary text-primary-foreground" : i < step ? "bg-muted" : "bg-card")}>
              {i < step ? <Check className="size-3.5" /> : <span className="num">{i + 1}</span>}{s}
            </button>
          </li>
        ))}
      </ol>

      {orders.isLoading || items.isLoading ? <LoadingRows /> : orders.error ? <ErrorState error={orders.error} onRetry={orders.refetch} /> : (
        <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <div className="min-w-0 rounded-lg border bg-card p-5">
            {step === 0 && (
              open.length === 0 ? <EmptyState title="No orders waiting for dispatch" hint="Confirm a sales order first." /> : (
                <div className="space-y-2">
                  {open.map((o) => (
                    <label key={o.id} className={cn("flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-muted/40", soId === o.id && "border-primary bg-primary/5")}>
                      <input type="radio" name="so" checked={soId === o.id} onChange={() => setSoId(o.id)} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2"><span className="num font-medium">{o.number}</span><StatusBadge status={o.status} /></div>
                        <div className="text-xs text-muted-foreground">{o.customerName} · {formatDate(o.date)} · {godownName(o.godownId)}</div>
                      </div>
                      <div className="num text-sm">{formatINR(o.grandTotal, 0)}</div>
                    </label>
                  ))}
                </div>
              )
            )}

            {step === 1 && so && (
              <table className="w-full text-sm">
                <thead><tr className="eyebrow text-left"><th className="py-2">Item</th><th className="py-2 text-right">Ordered</th><th className="py-2 text-right">Sent</th><th className="py-2 text-right">This challan</th><th className="py-2 text-right">Pending after</th></tr></thead>
                <tbody>
                  {so.lines.map((l) => {
                    const pending = l.qty - l.deliveredQty;
                    const q = qty[l.id] ?? 0;
                    return (
                      <tr key={l.id} className={cn("border-t", pending === 0 && "opacity-50")}>
                        <td className="py-2">{l.itemName}<div className="text-xs text-muted-foreground">{l.uom}</div></td>
                        <td className="num py-2 text-right">{formatQty(l.qty)}</td>
                        <td className="num py-2 text-right">{formatQty(l.deliveredQty)}</td>
                        <td className="py-2 text-right">
                          <Input type="number" min={0} max={pending} disabled={pending === 0} value={q} onChange={(e) => setLineQty(l.id, Math.max(0, Number(e.target.value)))}
                            className={cn("num ml-auto h-8 w-28 text-right", q > pending && "border-destructive")} aria-label={`Qty for ${l.itemName}`} />
                        </td>
                        <td className={cn("num py-2 text-right", pending - q < 0 && "text-destructive")}>{formatQty(pending - q)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {step === 2 && so && (
              <div className="space-y-5">
                {chosen.map((l) => {
                  const it = itemById.get(l.itemId);
                  const bs = batchesFor(it, so.godownId);
                  const a = alloc[l.id] ?? [];
                  const sum = a.reduce((x, y) => x + y.qty, 0);
                  const need = qty[l.id] ?? 0;
                  return (
                    <div key={l.id}>
                      <div className="mb-2 flex items-baseline justify-between">
                        <div className="font-medium">{l.itemName}</div>
                        <div className={cn("num text-xs", sum !== need ? "text-destructive" : "text-muted-foreground")}>{formatQty(sum)} / {formatQty(need)} {l.uom}</div>
                      </div>
                      {!it?.trackBatches ? <p className="text-xs text-muted-foreground">Not batch-tracked — issued from general stock.</p> : !bs.length ? <p className="text-xs text-destructive">No available batches at this godown. Dispatch is blocked.</p> : (
                        <div className="space-y-1.5">
                          {[...bs].sort((x, y) => x.receivedDate.localeCompare(y.receivedDate)).map((b) => {
                            const cur = a.find((x) => x.batchNo === b.batchNo)?.qty ?? 0;
                            return (
                              <div key={b.id} className="flex items-center gap-3 text-sm">
                                <span className="num w-32 font-medium">{b.batchNo}</span>
                                <span className="flex-1 text-xs text-muted-foreground">Received {formatDate(b.receivedDate)}{b.expiryDate ? ` · expires ${formatDate(b.expiryDate)}` : ""} · <span className="num">{formatQty(b.qty)}</span> left</span>
                                <Input type="number" min={0} max={b.qty} value={cur} aria-label={`Qty from ${b.batchNo}`}
                                  onChange={(e) => {
                                    const v = Math.min(b.qty, Math.max(0, Number(e.target.value)));
                                    setAlloc((x) => ({ ...x, [l.id]: [...(x[l.id] ?? []).filter((y) => y.batchNo !== b.batchNo), { batchNo: b.batchNo, qty: v }].filter((y) => y.qty > 0) }));
                                  }}
                                  className="num h-8 w-24 text-right" />
                              </div>
                            );
                          })}
                          <Button size="sm" variant="ghost" onClick={() => { setAlloc(suggested); setReason(""); }}>Reset all to FIFO</Button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {override && (
                  <Field label="Reason for changing FIFO batches" hint="Saved on the challan and stock ledger">
                    <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer asked for the newer heat number" />
                  </Field>
                )}
                {planProblems.length > 0 && <ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-destructive">{planProblems.map((p, i) => <li key={`${i}-${p}`}>{p}</li>)}</ul>}
              </div>
            )}

            {step === 3 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Vehicle number"><Input autoFocus value={t.vehicleNo} onChange={(e) => setT({ ...t, vehicleNo: e.target.value.toUpperCase() })} placeholder="TS09EA1234" className="num" /></Field>
                <Field label="Transporter"><Input value={t.transporter} onChange={(e) => setT({ ...t, transporter: e.target.value })} /></Field>
                <Field label="Driver name"><Input value={t.driverName} onChange={(e) => setT({ ...t, driverName: e.target.value })} /></Field>
                <Field label="Driver phone"><Input value={t.driverPhone} onChange={(e) => setT({ ...t, driverPhone: e.target.value.replace(/\D/g, "").slice(0, 10) })} className="num" /></Field>
                <Field label="Distance (km)" hint={needEwb ? `Estimated test EWB window: ${ewbValidityDays(t.distanceKm)} day(s)` : "Needed only for e-way bills"}>
                  <Input type="number" min={0} value={t.distanceKm || ""} onChange={(e) => setT({ ...t, distanceKm: Number(e.target.value) })} className="num" />
                </Field>
                {transportProblems.length > 0 && <ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-destructive sm:col-span-2">{transportProblems.map((p, i) => <li key={`${i}-${p}`}>{p}</li>)}</ul>}
              </div>
            )}

            {step === 4 && so && (
              <div className="space-y-4">
                <table className="w-full text-sm">
                  <thead><tr className="eyebrow text-left"><th className="py-2">Item</th><th className="py-2">Batches</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Taxable</th></tr></thead>
                  <tbody>
                    {chosen.map((l) => (
                      <tr key={l.id} className="border-t">
                        <td className="py-2">{l.itemName}</td>
                        <td className="num py-2 text-xs text-muted-foreground">{(alloc[l.id] ?? []).map((a) => a.batchNo ? `${a.batchNo} × ${formatQty(a.qty)}` : "General").join(", ")}</td>
                        <td className="num py-2 text-right">{formatQty(qty[l.id] ?? 0)} {l.uom}</td>
                        <td className="num py-2 text-right">{formatINR((qty[l.id] ?? 0) * l.rate * (1 - l.discountPct / 100))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className={cn("rounded-md border p-3 text-sm", needEwb ? "border-accent/50 bg-accent/10" : "bg-muted/40")}>
                  <div className="flex items-center gap-2 font-medium"><FileCheck2 className="size-4" /> E-way bill</div>
                  {needEwb
                    ? <p className="mt-1 text-muted-foreground">Above ₹50,000. This deployment creates a <strong>TEST-only e-way bill placeholder</strong> for vehicle <span className="num">{t.vehicleNo || "—"}</span> ({ewbValidityDays(t.distanceKm)} day(s) estimated for {t.distanceKm} km). No government bill is issued without a GSP integration.</p>
                    : <p className="mt-1 text-muted-foreground">Not required by this application's ₹50,000 threshold check. Confirm applicable statutory exemptions separately.</p>}
                </div>
                {problems.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-sm text-destructive">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
              </div>
            )}

            <div className="mt-6 flex justify-between">
              <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>
              {step < 4 ? (
                <Button disabled={!stepOk[step]} onClick={() => setStep(step + 1)}>Next</Button>
              ) : (
                <Button variant="ember" disabled={problems.length > 0 || dispatch.isPending} onClick={() => dispatch.mutate()}>
                  <Truck /> {dispatch.isPending ? "Dispatching…" : "Dispatch & post stock"}
                </Button>
              )}
            </div>
          </div>

          <aside className="h-fit space-y-2 rounded-lg border bg-card p-4 text-sm">
            <div className="eyebrow">Consignment</div>
            {so ? (
              <>
                <Row k="Customer" v={so.customerName} />
                <Row k="From" v={godownName(so.godownId)} />
                <Row k="Place of supply" v={so.placeOfSupplyName} />
                <Row k="Taxable" v={formatINR(totals.taxable)} num />
                {totals.igst ? <Row k="IGST" v={formatINR(totals.igst)} num /> : <><Row k="CGST" v={formatINR(totals.cgst)} num /><Row k="SGST" v={formatINR(totals.sgst)} num /></>}
                <div className="flex justify-between border-t pt-2 font-semibold"><span>Value</span><span className="num">{formatINR(totals.grandTotal)}</span></div>
                <p className={cn("text-xs", needEwb ? "text-accent-foreground" : "text-muted-foreground")}>{needEwb ? "E-way bill required" : "No e-way bill needed"}</p>
              </>
            ) : <p className="text-muted-foreground">Pick a sales order.</p>}
          </aside>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, num }: { k: string; v: string; num?: boolean }) {
  return <div className="flex justify-between gap-2"><span className="text-muted-foreground">{k}</span><span className={cn("text-right", num && "num")}>{v}</span></div>;
}

export type { SalesOrder };
