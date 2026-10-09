import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { formatINR } from "@/lib/format";
import { useSession } from "@/lib/session";
import { ADJ_REASONS, ADJ_APPROVAL_LIMIT, adjustmentDraftProblems, adjustmentValue, needsApproval, type AdjDirection } from "@/lib/adjustment-rules";
import { can } from "@/lib/permissions";
import { PageHeader, ErrorState } from "@/components/app/states";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/adjustments/new")({
  head: () => ({
    meta: [
      { title: "New stock adjustment — Girder" },
      { name: "description", content: "Increase or reduce stock in a godown with a mandatory reason." },
      { property: "og:title", content: "New stock adjustment — Girder" },
      { property: "og:description", content: "Increase or reduce stock in a godown with a mandatory reason." },
    ],
  }),
  component: NewAdjustment,
});

const businessToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
type Row = { itemId: string; batchNo: string; direction: AdjDirection; qty: string; unitCost: string };

function NewAdjustment() {
  const session = useSession();
  const role = session?.user.role ?? "";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const gq = useQuery({ queryKey: ["godowns", session?.orgId], queryFn: () => api.listGodowns(session?.orgId ?? "") });
  const iq = useQuery({ queryKey: ["items", session?.orgId], queryFn: () => api.listItems() });
  const settingsQ = useQuery({ queryKey: ["settings", session?.orgId], queryFn: api.getSettings });
  const [godownId, setGodownId] = useState(session?.godownId && session.godownId !== "all" ? session.godownId : "");
  const [date, setDate] = useState(businessToday);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const blank = (): Row => ({ itemId: "", batchNo: "", direction: ADJ_REASONS.find((r) => r.value === reason)?.directions[0] ?? "down", qty: "", unitCost: "" });
  const [rows, setRows] = useState<Row[]>([blank()]);
  const godowns = (gq.data ?? []).filter((g) => g.active !== false);
  useEffect(() => {
    if (gq.data && !godowns.some((g) => g.id === godownId)) {
      setGodownId(godowns[0]?.id ?? "");
      setRows((previous) => previous.map((line) => ({ ...line, batchNo: "" })));
    }
  }, [gq.data, godownId]);
  const dirty = !!reason || !!notes || !!rows.some((r) => r.itemId || r.qty || r.batchNo);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const set = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, n) => (n === i ? { ...x, ...p } : x)));
  const item = (id: string) => iq.data?.find((x) => x.id === id);
  const onHand = (id: string) => item(id)?.stock.find((s) => s.godownId === godownId)?.onHand ?? 0;
  const active = rows.filter((r) => r.itemId);
  const lines = active.map((r) => {
    const it = item(r.itemId)!;
    return { ...r, qtyN: Number(r.qty), cost: r.direction === "down" ? it.costPrice : Number(r.unitCost) };
  });
  const problems = adjustmentDraftProblems({ date, godownId, reason, notes }, godowns.find((g) => g.id === godownId), businessToday(), lines.map((l) => {
    const it = item(l.itemId)!;
    const b = it.batches.find((x) => x.batchNo === l.batchNo && x.godownId === godownId);
    const stock = it.stock.find((x) => x.godownId === godownId);
    return { itemId: it.id, itemName: it.name, active: it.active, direction: l.direction, qty: l.qty.trim() ? l.qtyN : 0,
      onHand: onHand(l.itemId), held: stock?.held ?? 0, unitCost: l.cost, trackBatches: it.trackBatches, batchNo: l.batchNo || undefined, batchQty: b?.qty };
  }));
  if (rows.some((r) => !r.itemId && (r.qty || r.batchNo))) problems.push("Choose an item for every filled-in row");
  const v = adjustmentValue(lines.map((l) => ({ direction: l.direction, qty: l.qtyN, unitCost: l.cost })));
  const approval = needsApproval(role, v.gross, settingsQ.data?.adjApprovalLimit);
  const allowed = ADJ_REASONS.find((r) => r.value === reason)?.directions ?? ["up", "down"];

  const go = useMutation({
    mutationFn: () => api.createAdjustment({ date, godownId, reason, notes, lines: lines.map((l) => ({ itemId: l.itemId, batchNo: l.batchNo || undefined, direction: l.direction, qty: l.qtyN, unitCost: l.cost })) }),
    onSuccess: (a) => {
      qc.invalidateQueries();
      toast.success(a.status === "posted" ? `${a.number} posted · stock updated` : `${a.number} sent for approval`);
      navigate({ to: "/adjustments/$id", params: { id: a.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (gq.error || iq.error || settingsQ.error) return <ErrorState error={gq.error ?? iq.error ?? settingsQ.error} onRetry={() => { gq.refetch(); iq.refetch(); settingsQ.refetch(); }} />;
  if (!can(role, "adjust")) return <p className="text-sm text-destructive">Your role cannot create stock adjustments.</p>;
  return (
    <div className="max-w-5xl">
      <PageHeader title="New stock adjustment" eyebrow="Inventory" />
      <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3">
        <Field label="Godown">
          <NativeSelect aria-label="Godown" value={godownId} onChange={(e) => { setGodownId(e.target.value); setRows((r) => r.map((x) => ({ ...x, batchNo: "" }))); }}>
            <option value="">Choose…</option>
            {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Date"><Input type="date" max={businessToday()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Reason">
          <NativeSelect aria-label="Reason" value={reason} onChange={(e) => {
            const r = ADJ_REASONS.find((x) => x.value === e.target.value);
            setReason(e.target.value);
            if (r && r.directions.length === 1) setRows((rs) => rs.map((x) => ({ ...x, direction: r.directions[0]! })));
          }}>
            <option value="">Choose…</option>
            {ADJ_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Notes" className="sm:col-span-3"><Input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="What happened? e.g. bags torn while unloading" /></Field>
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60"><tr className="eyebrow">
            <th className="px-4 py-2 text-left">Item</th><th className="w-28 px-2 py-2 text-left">Direction</th><th className="w-44 px-2 py-2 text-left">Batch</th>
            <th className="w-24 px-2 py-2 text-right">On hand</th><th className="w-28 px-2 py-2 text-left">Qty</th><th className="w-32 px-2 py-2 text-left">Unit cost</th><th className="w-10" />
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const it = item(r.itemId);
              const batches = it?.batches.filter((b) => b.godownId === godownId && b.qty > 0) ?? [];
              return (
                <tr key={i} className="border-t">
                  <td className="px-4 py-2">
                    <NativeSelect aria-label={`Item ${i + 1}`} value={r.itemId} onChange={(e) => set(i, { itemId: e.target.value, batchNo: "", unitCost: String(item(e.target.value)?.costPrice ?? "") })}>
                      <option value="">Choose item…</option>
                      {iq.data?.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </NativeSelect>
                  </td>
                  <td className="px-2 py-2">
                    <NativeSelect aria-label={`Direction ${i + 1}`} value={r.direction} disabled={allowed.length === 1} onChange={(e) => set(i, { direction: e.target.value as AdjDirection, batchNo: "" })}>
                      {allowed.includes("down") && <option value="down">Down</option>}{allowed.includes("up") && <option value="up">Up</option>}
                    </NativeSelect>
                  </td>
                  <td className="px-2 py-2">
                    {r.direction === "up" ? (
                      <Input aria-label={`Batch ${i + 1}`} className="num" list={`b${i}`} value={r.batchNo} onChange={(e) => set(i, { batchNo: e.target.value })} placeholder={it?.trackBatches ? "Batch / heat no." : "Optional"} />
                    ) : (
                      <NativeSelect aria-label={`Batch ${i + 1}`} value={r.batchNo} disabled={!batches.length} onChange={(e) => set(i, { batchNo: e.target.value })}>
                        <option value="">{batches.length ? (it?.trackBatches ? "Choose batch…" : "Any") : "No batches"}</option>
                        {batches.map((b) => <option key={b.id} value={b.batchNo}>{b.batchNo} · {b.qty}</option>)}
                      </NativeSelect>
                    )}
                    <datalist id={`b${i}`}>{batches.map((b) => <option key={b.id} value={b.batchNo} />)}</datalist>
                  </td>
                  <td className="num px-2 py-2 text-right text-muted-foreground">{it ? `${onHand(r.itemId)} ${it.baseUom}` : "—"}{it && <span className="block text-xs">Free: {onHand(r.itemId) - (it.stock.find((x) => x.godownId === godownId)?.held ?? 0)}</span>}</td>
                  <td className="px-2 py-2"><Input aria-label={`Qty ${i + 1}`} className="num" value={r.qty} onChange={(e) => set(i, { qty: e.target.value.replace(/[^\d.]/g, "") })} /></td>
                  <td className="px-2 py-2">
                    {r.direction === "up"
                      ? <Input aria-label={`Unit cost ${i + 1}`} className="num" value={r.unitCost} onChange={(e) => set(i, { unitCost: e.target.value.replace(/[^\d.]/g, "") })} />
                      : <span className="num text-muted-foreground" title="Reductions are valued at current average cost">{it ? formatINR(it.costPrice) : "—"}</span>}
                  </td>
                  <td><Button size="icon" variant="ghost" aria-label="Remove line" disabled={rows.length === 1} onClick={() => setRows((x) => x.filter((_, n) => n !== i))}><Trash2 /></Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="border-t p-2"><Button size="sm" variant="ghost" onClick={() => setRows((r) => [...r, blank()])}><Plus /> Add line</Button></div>
      </div>
      <div className="mt-4 flex flex-wrap items-start justify-end gap-6 text-sm">
        <div className="space-y-1">{problems.slice(0, 3).map((p) => <p key={p} className="text-xs text-destructive">{p}</p>)}</div>
        <span>Up <span className="num font-medium text-success">{formatINR(v.up, 0)}</span></span>
        <span>Down <span className="num font-medium text-destructive">{formatINR(v.down, 0)}</span></span>
        <Button variant="outline" onClick={() => { if (!dirty || window.confirm("Discard the unsaved adjustment?")) navigate({ to: "/adjustments" }); }}>Cancel</Button>
        <Button disabled={problems.length > 0 || go.isPending || gq.isLoading || iq.isLoading || settingsQ.isLoading} onClick={() => go.mutate()}>{go.isPending ? "Saving…" : approval ? "Submit for approval" : "Post adjustment"}</Button>
      </div>
      {approval && <p className="mt-2 text-right text-xs text-muted-foreground">Above {formatINR(settingsQ.data?.adjApprovalLimit ?? ADJ_APPROVAL_LIMIT, 0)}, so an Owner or Manager must approve before stock changes.</p>}
    </div>
  );
}
