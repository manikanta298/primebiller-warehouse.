import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/api/client";
import { formatINR } from "@/lib/format";
import { computeTotals, supplyType } from "@/lib/gst";
import { grnDraftProblems } from "@/lib/grn-rules";
import { can } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { apportionFreight } from "@/lib/purchase-rules";
import { PageHeader, ErrorState, LoadingRows } from "@/components/app/states";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/purchases/grn/new")({
  validateSearch: z.object({ poId: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Receive goods — Girder" },
      { name: "description", content: "Post a goods receipt: accepted and rejected quantities, batch or heat numbers, freight and landed cost." },
      { property: "og:title", content: "Receive goods — Girder" },
      { property: "og:description", content: "Post a goods receipt: accepted and rejected quantities, batch or heat numbers, freight and landed cost." },
    ],
  }),
  component: NewGrn,
});

type Row = { poLineId?: string | undefined; itemId: string; pending?: number | undefined; received: string; rejected: string; rate: string; batchNo: string; mfgDate: string; expiryDate: string; rejectionReason: string };
const blank = (): Row => ({ itemId: "", received: "", rejected: "", rate: "", batchNo: "", mfgDate: "", expiryDate: "", rejectionReason: "" });
const num = (v: string) => v.replace(/[^\d.]/g, "");
const businessToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function NewGrn() {
  const { poId } = Route.useSearch();
  const session = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const today = businessToday();
  const orgId = session?.orgId ?? "";
  const sq = useQuery({ queryKey: ["parties", orgId, "supplier"], queryFn: () => api.listParties("supplier"), enabled: !!orgId });
  const gq = useQuery({ queryKey: ["godowns", orgId], queryFn: () => api.listGodowns(orgId), enabled: !!orgId });
  const iq = useQuery({ queryKey: ["items", orgId, "grn"], queryFn: () => api.listItems(), enabled: !!orgId });
  const poq = useQuery({ queryKey: ["po", orgId, poId], queryFn: () => api.getPurchaseOrder(poId!), enabled: !!poId && !!orgId });
  const eq = useQuery({ queryKey: ["grns", orgId], queryFn: api.listGrns, enabled: !!orgId });
  const po = poq.data;
  const [supplierId, setSupplierId] = useState("");
  const [godownId, setGodownId] = useState(session?.godownId && session.godownId !== "all" ? session.godownId : "");
  const [date, setDate] = useState(today);
  const [invNo, setInvNo] = useState("");
  const [invDate, setInvDate] = useState(today);
  const [vehicle, setVehicle] = useState("");
  const [freight, setFreight] = useState("");
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!po) return;
    setSupplierId(po.supplierId);
    setGodownId(po.godownId);
    setRows(po.lines.filter((l) => l.qty > l.receivedQty).map((l) => ({ ...blank(), poLineId: l.id, itemId: l.itemId, pending: l.qty - l.receivedQty, received: String(l.qty - l.receivedQty), rate: String(l.rate) })));
  }, [po]);

  const set = (i: number, p: Partial<Row>) => { setRows((r) => r.map((x, n) => (n === i ? { ...x, ...p } : x))); setDirty(true); };
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const item = (id: string) => iq.data?.find((x) => x.id === id);
  const supplier = sq.data?.find((p) => p.id === supplierId);
  const godown = gq.data?.find((g) => g.id === godownId);
  const lines = rows.filter((r) => r.itemId || r.poLineId || r.received || r.rejected || r.rate || r.batchNo)
    .map((r) => ({ poLineId: r.poLineId, itemId: r.itemId, received: Number(r.received), rejected: Number(r.rejected || 0), rate: Number(r.rate),
      batchNo: r.batchNo, mfgDate: r.mfgDate, expiryDate: r.expiryDate, rejectionReason: r.rejectionReason }));
  const draft = { date, supplierId, poId: po?.id ?? poId, supplierInvoiceNo: invNo, supplierInvoiceDate: invDate, godownId,
    vehicleNo: vehicle, freight: Number(freight || 0), lines };
  const problems = grnDraftProblems(draft, supplier, godown, iq.data ?? [], po, businessToday(), eq.data ?? []);
  const values = rows.map((r) => Math.max(0, Number(r.received) - Number(r.rejected || 0)) * (Number(r.rate) || 0));
  const shares = apportionFreight(values, Number(freight) || 0);
  const org = session?.orgs.find((o) => o.id === orgId);
  const gstType = supplyType(org?.stateCode ?? "", supplier?.stateCode ?? "");
  const totals = computeTotals(lines.filter((l) => l.received > l.rejected && l.rate > 0).map((l) => ({
    qty: l.received - l.rejected, rate: l.rate, discountPct: 0, gstRate: item(l.itemId)?.gstRate ?? 0,
  })), gstType);
  const loading = sq.isLoading || gq.isLoading || iq.isLoading || eq.isLoading || (!!poId && poq.isLoading);
  const error = sq.error ?? gq.error ?? iq.error ?? eq.error ?? (poId ? poq.error : null);
  const allowed = can(session?.user.role, "postGrn");

  const post = useMutation({
    mutationFn: () => api.postGrn(draft),
    onSuccess: (g) => { setDirty(false); void qc.invalidateQueries(); toast.success(`${g.number} posted · stock updated`); navigate({ to: "/purchases/grn/$id", params: { id: g.id } }); },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !problems.length && !post.isPending) { e.preventDefault(); post.mutate(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [problems.length, post]);

  if (!allowed) return <ErrorState error={new Error("Your role cannot post goods receipts")} />;
  if (loading) return <LoadingRows />;
  if (error) return <ErrorState error={error} onRetry={() => { void sq.refetch(); void gq.refetch(); void iq.refetch(); void eq.refetch(); if (poId) void poq.refetch(); }} />;
  return (
    <div>
      <PageHeader title="Receive goods" eyebrow={po ? `GRN against ${po.number}` : "GRN · direct receipt"} />
      <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3">
        <Field label="Supplier">
          <NativeSelect aria-label="Supplier" value={supplierId} disabled={!!po} onChange={(e) => { setSupplierId(e.target.value); setDirty(true); }}>
            <option value="">Choose supplier…</option>
            {sq.data?.filter((p) => ["supplier", "both"].includes(p.kind) && !p.blocked).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Godown">
          <NativeSelect value={godownId} disabled={!!poId} onChange={(e) => { setGodownId(e.target.value); setDirty(true); }}>
            <option value="">Choose godown…</option>
            {gq.data?.filter((g) => g.active).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Received on"><Input type="date" max={businessToday()} value={date} onChange={(e) => { setDate(e.target.value); setDirty(true); }} /></Field>
        <Field label="Supplier invoice no."><Input aria-label="Supplier invoice no." maxLength={100} value={invNo} onChange={(e) => { setInvNo(e.target.value); setDirty(true); }} /></Field>
        <Field label="Supplier invoice date"><Input type="date" max={date} value={invDate} onChange={(e) => { setInvDate(e.target.value); setDirty(true); }} /></Field>
        <Field label="Vehicle no."><Input className="num uppercase" maxLength={32} value={vehicle} onChange={(e) => { setVehicle(e.target.value); setDirty(true); }} placeholder="TS09EA4521" /></Field>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-muted/60"><tr className="eyebrow">
            <th className="px-3 py-2 text-left">Item</th><th className="w-24 px-2 py-2 text-left">Received</th><th className="w-24 px-2 py-2 text-left">Rejected</th>
            <th className="w-28 px-2 py-2 text-left">Rate</th><th className="w-36 px-2 py-2 text-left">Batch / heat</th><th className="w-36 px-2 py-2 text-left">Mfg</th><th className="w-36 px-2 py-2 text-left">Expiry</th>
            <th className="w-28 px-2 py-2 text-right">Landed</th><th className="w-10" />
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const it = item(r.itemId);
              const acc = (Number(r.received) || 0) - (Number(r.rejected) || 0);
              const landed = acc > 0 ? Number(r.rate) + shares[i]! / acc : 0;
              return (
                <tr key={i} className="border-t align-top">
                  <td className="px-3 py-2">
                    {r.poLineId ? <div><div className="font-medium">{it?.name}</div><div className="text-xs text-muted-foreground">Pending <span className="num">{r.pending} {it?.baseUom}</span></div></div> : (
                      <NativeSelect aria-label={`Item ${i + 1}`} value={r.itemId} onChange={(e) => { const x = item(e.target.value); set(i, { itemId: e.target.value, rate: x ? String(x.costPrice) : r.rate }); }}>
                        <option value="">Choose item…</option>
                        {iq.data?.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </NativeSelect>
                    )}
                    {Number(r.rejected) > 0 && <Input className="mt-1.5" placeholder="Rejection reason" aria-label={`Rejection reason ${i + 1}`} value={r.rejectionReason} maxLength={500} onChange={(e) => set(i, { rejectionReason: e.target.value })} />}
                  </td>
                  <td className="px-2 py-2"><Input aria-label={`Received ${i + 1}`} inputMode="decimal" className="num" value={r.received} onChange={(e) => set(i, { received: num(e.target.value) })} /></td>
                  <td className="px-2 py-2"><Input aria-label={`Rejected ${i + 1}`} inputMode="decimal" className="num" value={r.rejected} onChange={(e) => set(i, { rejected: num(e.target.value) })} /></td>
                  <td className="px-2 py-2"><Input aria-label={`Rate ${i + 1}`} inputMode="decimal" className="num" value={r.rate} onChange={(e) => set(i, { rate: num(e.target.value) })} /></td>
                  <td className="px-2 py-2"><Input aria-label={`Batch ${i + 1}`} className="num" maxLength={100} value={r.batchNo} placeholder={it?.trackBatches ? "Required" : "Optional"} onChange={(e) => set(i, { batchNo: e.target.value.toUpperCase() })} /></td>
                  <td className="px-2 py-2"><Input type="date" aria-label={`Manufactured ${i + 1}`} max={date} value={r.mfgDate} onChange={(e) => set(i, { mfgDate: e.target.value })} /></td>
                  <td className="px-2 py-2"><Input type="date" aria-label={`Expiry ${i + 1}`} min={r.mfgDate || date} value={r.expiryDate} onChange={(e) => set(i, { expiryDate: e.target.value })} /></td>
                  <td className="num px-2 py-2 pt-4 text-right">{landed ? formatINR(landed) : "—"}</td>
                  <td className="py-1">{!po && <Button size="icon" variant="ghost" aria-label="Remove line" disabled={rows.length === 1} onClick={() => { setRows((x) => x.filter((_, n) => n !== i)); setDirty(true); }}><Trash2 /></Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!po && <div className="border-t p-2"><Button size="sm" variant="ghost" disabled={rows.length >= 200} onClick={() => { setRows((r) => [...r, blank()]); setDirty(true); }}><Plus /> Add line</Button></div>}
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
        <div className="space-y-1" role="alert">{problems.slice(0, 4).map((p, n) => <p key={`${n}-${p}`} className="text-xs text-destructive">{p}</p>)}{problems.length > 4 && <p className="text-xs text-destructive">+{problems.length - 4} more issues</p>}</div>
        <div className="w-80 space-y-2 rounded-lg border bg-card p-4 text-sm">
          <div className="flex justify-between"><span>Taxable (accepted)</span><span className="num">{formatINR(totals.taxable)}</span></div>
          <div className="flex justify-between"><span>GST</span><span className="num">{formatINR(totals.cgst + totals.sgst + totals.igst)}</span></div>
          <div className="flex items-center justify-between gap-2"><span>Freight & other</span><Input aria-label="Freight" className="num h-8 w-28 text-right" value={freight} onChange={(e) => { setFreight(num(e.target.value)); setDirty(true); }} placeholder="0" /></div>
          <div className="flex justify-between border-t pt-2 font-semibold"><span>Total</span><span className="num">{formatINR(Math.round(totals.taxable + totals.cgst + totals.sgst + totals.igst + Number(freight || 0)), 0)}</span></div>
          <Button className="w-full" disabled={loading || !!error || problems.length > 0 || post.isPending} onClick={() => post.mutate()}>{post.isPending ? "Posting…" : "Post GRN"} <kbd className="ml-1 text-[10px] opacity-70">Ctrl+↵</kbd></Button>
          <Button className="w-full" variant="outline" onClick={() => { if (!dirty || window.confirm("Discard unsaved goods receipt?")) navigate({ to: "/purchases", search: { tab: "grn" } }); }}>Cancel</Button>
          <p className="text-xs text-muted-foreground">Only accepted quantities enter stock. Rejections remain on the GRN audit record.</p>
        </div>
      </div>
    </div>
  );
}
