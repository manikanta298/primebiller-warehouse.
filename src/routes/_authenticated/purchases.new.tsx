import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { formatINR } from "@/lib/format";
import { computeTotals, supplyType } from "@/lib/gst";
import { poDraftProblems } from "@/lib/purchase-rules";
import { can } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { PageHeader, ErrorState, LoadingRows } from "@/components/app/states";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/purchases/new")({
  head: () => ({ meta: [
    { title: "New purchase order — Girder" },
    { name: "description", content: "Prepare a supplier purchase order with GST totals and approval." },
  ] }),
  component: NewPo,
});

type Row = { itemId: string; qty: string; rate: string };
const blank = (): Row => ({ itemId: "", qty: "", rate: "" });
const businessToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function NewPo() {
  const session = useSession();
  const orgId = session?.orgId ?? "";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const sq = useQuery({ queryKey: ["parties", orgId, "supplier"], queryFn: () => api.listParties("supplier"), enabled: !!orgId });
  const gq = useQuery({ queryKey: ["godowns", orgId], queryFn: () => api.listGodowns(orgId), enabled: !!orgId });
  const iq = useQuery({ queryKey: ["items", orgId, "po"], queryFn: () => api.listItems(), enabled: !!orgId });
  const [supplierId, setSupplierId] = useState("");
  const [godownId, setGodownId] = useState(session?.godownId && session.godownId !== "all" ? session.godownId : "");
  const [date, setDate] = useState(businessToday);
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [dirty, setDirty] = useState(false);
  const [savingAsDraft, setSavingAsDraft] = useState(false);
  const markDirty = () => setDirty(true);
  const set = (i: number, p: Partial<Row>) => { setRows((r) => r.map((x, n) => (n === i ? { ...x, ...p } : x))); markDirty(); };
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const supplier = sq.data?.find((p) => p.id === supplierId);
  const godown = gq.data?.find((g) => g.id === godownId);
  const lines = rows.filter((r) => r.itemId !== "" || r.qty !== "" || r.rate !== "").map((r) => ({ itemId: r.itemId, qty: Number(r.qty), rate: Number(r.rate) }));
  const problems = poDraftProblems({ supplierId, godownId, date, notes, lines }, supplier, godown, iq.data ?? [], businessToday());
  const org = session?.orgs.find((o) => o.id === orgId);
  const gstType = supplyType(org?.stateCode ?? "", supplier?.stateCode ?? "");
  const totals = computeTotals(lines.filter((l) => l.itemId && l.qty > 0 && l.rate >= 0).map((l) => ({ qty: l.qty, rate: l.rate, discountPct: 0, gstRate: iq.data?.find((x) => x.id === l.itemId)?.gstRate ?? 0 })), gstType);
  const error = sq.error ?? gq.error ?? iq.error;
  const loading = sq.isLoading || gq.isLoading || iq.isLoading;
  const allowed = can(session?.user.role, "raisePO");
  const save = useMutation({
    mutationFn: (draft: boolean) => api.createPurchaseOrder({ supplierId, godownId, date, notes, draft, lines }),
    onSuccess: (po) => {
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ["pos", orgId] });
      toast.success(`${po.number} ${po.status === "draft" ? "saved as draft" : "raised"}`);
      navigate({ to: "/purchases/$id", params: { id: po.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!allowed) return <ErrorState error={new Error("Only Owner or Manager can raise purchase orders")} />;
  if (loading) return <LoadingRows />;
  if (error) return <ErrorState error={error} onRetry={() => { void sq.refetch(); void gq.refetch(); void iq.refetch(); }} />;
  const submit = (draft: boolean) => { if (problems.length || save.isPending) return; setSavingAsDraft(draft); save.mutate(draft); };
  return (
    <div className="max-w-4xl">
      <PageHeader title="New purchase order" eyebrow="Purchases" />
      <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3">
        <Field label="Supplier"><NativeSelect aria-label="Supplier" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); markDirty(); }}>
          <option value="">Choose supplier…</option>
          {sq.data?.filter((p) => ["supplier", "both"].includes(p.kind) && !p.blocked).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </NativeSelect></Field>
        <Field label="Deliver to godown"><NativeSelect aria-label="Delivery godown" value={godownId} onChange={(e) => { setGodownId(e.target.value); markDirty(); }}>
          <option value="">Choose godown…</option>{gq.data?.filter((g) => g.active).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </NativeSelect></Field>
        <Field label="Date"><Input type="date" aria-label="Purchase order date" max={businessToday()} value={date} onChange={(e) => { setDate(e.target.value); markDirty(); }} /></Field>
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm"><thead className="bg-muted/60"><tr className="eyebrow">
          <th className="px-4 py-2 text-left">Item</th><th className="w-32 px-2 py-2 text-left">Qty</th><th className="w-36 px-2 py-2 text-left">Rate (₹)</th><th className="w-36 px-2 py-2 text-right">Amount</th><th className="w-10" />
        </tr></thead><tbody>{rows.map((r, i) => {
          const it = iq.data?.find((x) => x.id === r.itemId);
          return <tr key={i} className="border-t">
            <td className="px-4 py-2"><NativeSelect aria-label={`Item ${i + 1}`} value={r.itemId} onChange={(e) => {
              const x = iq.data?.find((y) => y.id === e.target.value);
              set(i, { itemId: e.target.value, rate: x ? String(x.costPrice) : "" });
            }}><option value="">Choose item…</option>{iq.data?.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect></td>
            <td className="px-2 py-2"><div className="flex items-center gap-1"><Input aria-label={`Qty ${i + 1}`} className="num" inputMode="decimal" value={r.qty} onChange={(e) => set(i, { qty: e.target.value.replace(/[^\d.]/g, "") })} /><span className="text-xs text-muted-foreground">{it?.baseUom}</span></div></td>
            <td className="px-2 py-2"><Input aria-label={`Rate ${i + 1}`} className="num" inputMode="decimal" value={r.rate} onChange={(e) => set(i, { rate: e.target.value.replace(/[^\d.]/g, "") })} /></td>
            <td className="num px-2 py-2 text-right">{formatINR((Number(r.qty) || 0) * (Number(r.rate) || 0), 2)}</td>
            <td><Button size="icon" variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={rows.length === 1} onClick={() => { setRows((x) => x.filter((_, n) => n !== i)); markDirty(); }}><Trash2 /></Button></td>
          </tr>;
        })}</tbody></table>
        <div className="border-t p-2"><Button size="sm" variant="ghost" onClick={() => { setRows((r) => [...r, blank()]); markDirty(); }}><Plus /> Add line</Button></div>
      </div>
      <Field label="Notes" className="mt-4"><Input maxLength={2000} value={notes} onChange={(e) => { setNotes(e.target.value); markDirty(); }} /></Field>
      <div className="mt-4 ml-auto max-w-sm space-y-1 rounded-lg border bg-card p-4 text-sm" aria-live="polite">
        <div className="flex justify-between"><span>Taxable amount</span><span className="num">{formatINR(totals.taxable)}</span></div>
        {gstType === "intra" ? <><div className="flex justify-between"><span>CGST</span><span className="num">{formatINR(totals.cgst)}</span></div><div className="flex justify-between"><span>SGST</span><span className="num">{formatINR(totals.sgst)}</span></div></> :
          <div className="flex justify-between"><span>IGST</span><span className="num">{formatINR(totals.igst)}</span></div>}
        <div className="flex justify-between"><span>Round-off</span><span className="num">{formatINR(totals.roundOff)}</span></div>
        <div className="flex justify-between border-t pt-2 font-semibold"><span>Estimated total</span><span className="num">{formatINR(totals.grandTotal)}</span></div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3 text-sm">
        {problems.length > 0 && <span className="mr-auto max-w-md text-destructive" role="alert">{problems[0]}{problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}</span>}
        <Button variant="ghost" onClick={() => { if (!dirty || window.confirm("Discard unsaved purchase order?")) navigate({ to: "/purchases", search: {} }); }}>Cancel</Button>
        <Button variant="outline" disabled={!!problems.length || save.isPending} onClick={() => submit(true)}>{save.isPending && savingAsDraft ? "Saving…" : "Save draft"}</Button>
        <Button disabled={!!problems.length || save.isPending} onClick={() => submit(false)}>{save.isPending && !savingAsDraft ? "Raising…" : "Raise PO"}</Button>
      </div>
    </div>
  );
}
