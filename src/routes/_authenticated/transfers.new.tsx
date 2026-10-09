import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Plus, Trash2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { formatINR } from "@/lib/format";
import { useSession } from "@/lib/session";
import { transferDraftProblems } from "@/lib/transfer-rules";
import { can } from "@/lib/permissions";
import { PageHeader, ErrorState } from "@/components/app/states";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/transfers/new")({
  head: () => ({
    meta: [
      { title: "New stock transfer — Girder" },
      { name: "description", content: "Dispatch stock from one godown to another, by item and batch." },
      { property: "og:title", content: "New stock transfer — Girder" },
      { property: "og:description", content: "Dispatch stock from one godown to another, by item and batch." },
    ],
  }),
  component: NewTransfer,
});

const businessToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
type Row = { itemId: string; batchNo: string; qty: string };

function NewTransfer() {
  const session = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const gq = useQuery({ queryKey: ["godowns", session?.orgId], queryFn: () => api.listGodowns(session?.orgId ?? "") });
  const iq = useQuery({ queryKey: ["items", session?.orgId], queryFn: () => api.listItems() });
  const [fromId, setFromId] = useState(session?.godownId && session.godownId !== "all" ? session.godownId : "");
  const [toId, setToId] = useState("");
  const [date, setDate] = useState(businessToday);
  const [vehicle, setVehicle] = useState("");
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<Row[]>([{ itemId: "", batchNo: "", qty: "" }]);
  const godowns = (gq.data ?? []).filter((g) => g.active !== false);
  useEffect(() => {
    if (gq.data && !godowns.some((g) => g.id === fromId)) {
      setFromId(godowns[0]?.id ?? "");
      setToId("");
      setRows((r) => r.map((x) => ({ ...x, batchNo: "" })));
    }
  }, [gq.data, fromId]);
  const set = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, n) => (n === i ? { ...x, ...p } : x)));
  const item = (id: string) => iq.data?.find((x) => x.id === id);
  const free = (id: string) => { const st = item(id)?.stock.find((s) => s.godownId === fromId); return st ? st.onHand - st.held : 0; };
  const active = rows.filter((r) => r.itemId);
  const problems = transferDraftProblems({ fromId, toId, date, vehicleNo: vehicle, reason },
    godowns.find((g) => g.id === fromId), godowns.find((g) => g.id === toId), businessToday(),
    active.map((r) => {
      const it = item(r.itemId);
      const b = it?.batches.find((x) => x.batchNo === r.batchNo && x.godownId === fromId);
      return { itemId: r.itemId, itemName: it?.name ?? "Unknown item", qty: r.qty.trim() ? Number(r.qty) : 0,
        free: free(r.itemId), active: !!it?.active, trackBatches: it?.trackBatches ?? false,
        batchNo: r.batchNo || undefined, batchQty: b?.qty };
    }));
  const value = active.reduce((a, r) => a + (Number(r.qty) || 0) * (item(r.itemId)?.costPrice ?? 0), 0);

  const go = useMutation({
    mutationFn: () => api.dispatchTransfer({ date, fromId, toId, vehicleNo: vehicle, reason, lines: active.map((r) => ({ itemId: r.itemId, batchNo: r.batchNo || undefined, qty: Number(r.qty) })) }),
    onSuccess: (t) => { qc.invalidateQueries(); toast.success(`${t.number} dispatched · stock moved to in transit`); navigate({ to: "/transfers/$id", params: { id: t.id } }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (gq.error || iq.error) return <ErrorState error={gq.error ?? iq.error} onRetry={() => { gq.refetch(); iq.refetch(); }} />;
  return (
    <div className="max-w-4xl">
      <PageHeader title="New stock transfer" eyebrow="Inventory" />
      <div className="grid items-end gap-4 rounded-lg border bg-card p-4 sm:grid-cols-[1fr_auto_1fr_1fr]">
        <Field label="From godown">
          <NativeSelect aria-label="From godown" value={fromId} onChange={(e) => { setFromId(e.target.value); setRows((r) => r.map((x) => ({ ...x, batchNo: "" }))); }}>
            <option value="">Choose…</option>
            {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </NativeSelect>
        </Field>
        <ArrowRight className="mb-2.5 hidden size-4 text-muted-foreground sm:block" />
        <Field label="To godown">
          <NativeSelect aria-label="To godown" value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">Choose…</option>
            {godowns.filter((g) => g.id !== fromId).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Date"><Input type="date" max={businessToday()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Vehicle no." className="sm:col-span-1"><Input className="num uppercase placeholder:normal-case" value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="Optional" /></Field>
        <span className="hidden sm:block" />
        <Field label="Reason" className="sm:col-span-2"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Restock for weekend orders" /></Field>
      </div>
      <div className="mt-4 rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60"><tr className="eyebrow"><th className="px-4 py-2 text-left">Item</th><th className="w-44 px-2 py-2 text-left">Batch</th><th className="w-28 px-2 py-2 text-right">Free here</th><th className="w-32 px-2 py-2 text-left">Qty</th><th className="w-10" /></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const it = item(r.itemId);
              const batches = it?.batches.filter((b) => b.godownId === fromId && b.qty > 0).sort((a, b) => a.receivedDate.localeCompare(b.receivedDate)) ?? [];
              return (
                <tr key={i} className="border-t">
                  <td className="px-4 py-2">
                    <NativeSelect aria-label={`Item ${i + 1}`} value={r.itemId} onChange={(e) => set(i, { itemId: e.target.value, batchNo: "" })}>
                      <option value="">Choose item…</option>
                      {iq.data?.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </NativeSelect>
                  </td>
                  <td className="px-2 py-2">
                    <NativeSelect aria-label={`Batch ${i + 1}`} value={r.batchNo} disabled={!batches.length} onChange={(e) => set(i, { batchNo: e.target.value })}>
                      <option value="">{batches.length ? (it?.trackBatches ? "Choose batch…" : "Any") : "No batches"}</option>
                      {batches.map((b) => <option key={b.id} value={b.batchNo}>{b.batchNo} · {b.qty}</option>)}
                    </NativeSelect>
                  </td>
                  <td className="num px-2 py-2 text-right text-muted-foreground">{it ? `${free(r.itemId)} ${it.baseUom}` : "—"}</td>
                  <td className="px-2 py-2"><Input aria-label={`Qty ${i + 1}`} className="num" value={r.qty} onChange={(e) => set(i, { qty: e.target.value.replace(/[^\d.]/g, "") })} /></td>
                  <td><Button size="icon" variant="ghost" aria-label="Remove line" disabled={rows.length === 1} onClick={() => setRows((x) => x.filter((_, n) => n !== i))}><Trash2 /></Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="border-t p-2"><Button size="sm" variant="ghost" onClick={() => setRows((r) => [...r, { itemId: "", batchNo: "", qty: "" }])}><Plus /> Add line</Button></div>
      </div>
      <div className="mt-4 flex flex-wrap items-start justify-end gap-6 text-sm">
        <div className="space-y-1">{problems.slice(0, 3).map((p) => <p key={p} className="text-xs text-destructive">{p}</p>)}</div>
        <span>Value at cost <span className="num font-medium">{formatINR(value, 0)}</span></span>
        <Button disabled={gq.isLoading || iq.isLoading || problems.length > 0 || go.isPending || !can(session?.user.role, "transfer")} onClick={() => go.mutate()}>{go.isPending ? "Dispatching…" : "Dispatch transfer"}</Button>
      </div>
      <p className="mt-2 text-right text-xs text-muted-foreground">This screen records internal stock movements only; it does not generate statutory transport documents.</p>
    </div>
  );
}
