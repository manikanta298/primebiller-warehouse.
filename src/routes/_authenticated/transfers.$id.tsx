import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { formatDate, formatINR } from "@/lib/format";
import { useSession } from "@/lib/session";
import { receiveProblems } from "@/lib/transfer-rules";
import { can } from "@/lib/permissions";
import { PageHeader, ErrorState, LoadingRows } from "@/components/app/states";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/transfers/$id")({
  head: () => ({
    meta: [
      { title: "Stock transfer — Girder" },
      { name: "description", content: "Transfer lines, receiving at the destination godown and transit-loss write-offs." },
      { property: "og:title", content: "Stock transfer — Girder" },
      { property: "og:description", content: "Transfer lines, receiving at the destination godown and transit-loss write-offs." },
    ],
  }),
  component: TransferDetail,
});

function TransferDetail() {
  const { id } = Route.useParams();
  const session = useSession();
  const role = session?.user.role;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["transfer", session?.orgId, id], queryFn: () => api.getTransfer(id) });
  const [recv, setRecv] = useState<{ received: string; reason: string }[]>([]);
  useEffect(() => { if (q.data) setRecv(q.data.lines.map((l) => ({ received: String(l.qty), reason: "" }))); }, [q.data]);
  const done = (msg: string) => () => { qc.invalidateQueries(); toast.success(msg); };
  const receive = useMutation({
    mutationFn: () => api.receiveTransfer(id, { lines: recv.map((r) => ({ received: r.received.trim() ? Number(r.received) : Number.NaN, reason: r.reason })) }),
    onSuccess: done("Transfer received · stock added to destination"), onError: (e: Error) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => api.cancelTransfer(id, reason),
    onSuccess: done("Transfer cancelled · stock returned"), onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const t = q.data;
  const totalSent = t.lines.reduce((sum, l) => sum + l.qty, 0);
  const totalReceived = t.lines.reduce((sum, l) => sum + (l.receivedQty ?? 0), 0);
  const open = t.status === "in_transit";
  const canReceive = open && can(role, "transfer");
  const problems = canReceive ? receiveProblems(t.lines.map((l, n) => ({ itemName: l.itemName, sent: l.qty,
    received: recv[n]?.received?.trim() ? Number(recv[n].received) : Number.NaN, reason: recv[n]?.reason })), t.lines.length) : [];
  const setR = (n: number, p: Partial<{ received: string; reason: string }>) => setRecv((r) => r.map((x, i) => (i === n ? { ...x, ...p } : x)));

  return (
    <div>
      <PageHeader title={t.number} eyebrow="Stock transfer" actions={open && can(role, "cancelTransfer") && (
        <Button variant="outline" disabled={cancel.isPending} onClick={() => { const r = window.prompt("Reason for cancelling?"); if (r?.trim()) cancel.mutate(r.trim()); }}>Cancel transfer</Button>
      )}>
        <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground"><StatusBadge status={t.status} /> {formatDate(t.date)} · {t.fromName} → {t.toName}</div>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/60"><tr className="eyebrow">
                <th className="px-4 py-2 text-left">Item</th><th className="px-4 py-2 text-left">Batch</th><th className="px-4 py-2 text-right">Sent</th>
                <th className="px-4 py-2 text-right">{canReceive ? "Received now" : "Received"}</th>{canReceive && <th className="px-4 py-2 text-left">Shortage reason</th>}
              </tr></thead>
              <tbody>
                {t.lines.map((l, n) => {
                  const short = canReceive && Number(recv[n]?.received) < l.qty;
                  return (
                    <tr key={n} className="border-t align-top">
                      <td className="px-4 py-2">{l.itemName}{!open && l.shortReason && <div className="text-xs text-destructive">Short {l.qty - (l.receivedQty ?? l.qty)}: {l.shortReason}</div>}</td>
                      <td className="num px-4 py-2">{l.batchNo ?? "—"}</td>
                      <td className="num px-4 py-2 text-right">{l.qty} {l.uom}</td>
                      <td className="num px-4 py-2 text-right">
                        {canReceive ? <Input aria-label={`Received ${n + 1}`} className="num ml-auto h-8 w-24 text-right" value={recv[n]?.received ?? ""} onChange={(e) => setR(n, { received: e.target.value.replace(/[^\d.]/g, "") })} /> : t.status === "cancelled" ? "—" : l.receivedQty}
                      </td>
                      {canReceive && <td className="px-4 py-2">{short && <Input aria-label={`Shortage reason ${n + 1}`} className="h-8" placeholder="e.g. Torn bags" value={recv[n]?.reason ?? ""} onChange={(e) => setR(n, { reason: e.target.value })} />}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canReceive && (
            <div className="flex flex-wrap items-center justify-end gap-4">
              {problems.map((p) => <span key={p} className="text-xs text-destructive">{p}</span>)}
              <span className="text-xs text-muted-foreground">Any shortage is written off as transit loss at {t.toName}.</span>
              <Button disabled={problems.length > 0 || receive.isPending} onClick={() => receive.mutate()}>{receive.isPending ? "Receiving…" : `Receive at ${t.toName}`}</Button>
            </div>
          )}
        </div>
        <aside className="space-y-4">
          <div className="space-y-1.5 rounded-lg border bg-card p-4 text-sm">
            <div className="eyebrow mb-1">Details</div>
            <div>Value at cost <span className="num">{formatINR(t.value, 0)}</span></div>
            <div>Quantity sent <span className="num">{totalSent}</span></div>
            {!open && t.status !== "cancelled" && <><div>Quantity received <span className="num">{totalReceived}</span></div>
              <div>Transit shortage <span className="num">{totalSent - totalReceived}</span></div></>}
            {t.vehicleNo && <div>Vehicle <span className="num">{t.vehicleNo}</span></div>}
            {t.reason && <div className="text-muted-foreground">{t.reason}</div>}
            <Link to="/stock-ledger" search={{ doc: t.number }} className="block hover:underline">View in stock ledger</Link>
          </div>
          <div className="rounded-lg border bg-card p-4 text-sm">
            <div className="eyebrow mb-2">Activity</div>
            <ul className="space-y-2">
              {t.events.map((e, n) => (
                <li key={n}><div className="font-medium">{e.label}</div><div className="text-xs text-muted-foreground">{new Date(e.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {e.by}</div>{e.note && <div className="text-xs">{e.note}</div>}</li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
