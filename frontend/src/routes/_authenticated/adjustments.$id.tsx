import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/api/client";
import { formatDate, formatINR } from "@/lib/format";
import { useSession } from "@/lib/session";
import { canApproveAdjustment, reasonLabel } from "@/lib/adjustment-rules";
import { PageHeader, ErrorState, LoadingRows } from "@/components/app/states";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/adjustments/$id")({
  head: () => ({
    meta: [
      { title: "Stock adjustment — Girder" },
      { name: "description", content: "Adjustment lines, approval and the stock ledger entries it posted." },
      { property: "og:title", content: "Stock adjustment — Girder" },
      { property: "og:description", content: "Adjustment lines, approval and the stock ledger entries it posted." },
    ],
  }),
  component: AdjustmentDetail,
});

function AdjustmentDetail() {
  const { id } = Route.useParams();
  const session = useSession();
  const role = session?.user.role ?? "";
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["adjustment", session?.orgId, id], queryFn: () => api.getAdjustment(id) });
  const decide = useMutation({
    mutationFn: (v: { approve: boolean; note?: string }) => api.decideAdjustment(id, v.approve, v.note),
    onSuccess: (a) => { qc.invalidateQueries(); toast.success(a.status === "posted" ? "Approved · stock updated" : "Adjustment rejected"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const a = q.data;
  const pending = a.status === "pending_approval";

  return (
    <div>
      <PageHeader title={a.number} eyebrow="Stock adjustment" actions={pending && canApproveAdjustment(role) && (
        <div className="flex gap-2">
          <Button variant="outline" disabled={decide.isPending} onClick={() => { const r = window.prompt("Reason for rejecting?"); if (r?.trim()) decide.mutate({ approve: false, note: r.trim() }); }}>Reject</Button>
          <Button disabled={decide.isPending} onClick={() => decide.mutate({ approve: true })}>Approve & post</Button>
        </div>
      )}>
        <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground"><StatusBadge status={a.status} /> {formatDate(a.date)} · {a.godownName} · {reasonLabel(a.reason)}</div>
      </PageHeader>
      {pending && !canApproveAdjustment(role) && <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">Waiting for an Owner or Manager to approve. Stock has not changed yet.</p>}
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/60"><tr className="eyebrow">
                <th className="px-4 py-2 text-left">Item</th><th className="px-4 py-2 text-left">Batch</th><th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Unit cost</th><th className="px-4 py-2 text-right">Value</th>
              </tr></thead>
              <tbody>
                {a.lines.map((l, n) => (
                  <tr key={n} className="border-t">
                    <td className="px-4 py-2.5">{l.itemName}</td>
                    <td className="num px-4 py-2.5">{l.batchNo ?? "—"}</td>
                    <td className={`num px-4 py-2.5 text-right ${l.direction === "up" ? "text-success" : "text-destructive"}`}>{l.direction === "up" ? "+" : "−"}{l.qty} {l.uom}</td>
                    <td className="num px-4 py-2.5 text-right">{formatINR(l.unitCost)}</td>
                    <td className="num px-4 py-2.5 text-right">{formatINR(l.qty * l.unitCost, 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/30 text-sm">
                <tr><td colSpan={4} className="px-4 py-2 text-right text-muted-foreground">Written up / down</td>
                  <td className="num px-4 py-2 text-right"><span className="text-success">+{formatINR(a.valueUp, 0)}</span> / <span className="text-destructive">−{formatINR(a.valueDown, 0)}</span></td></tr>
              </tfoot>
            </table>
          </div>
          {a.notes && <div className="rounded-lg border bg-card p-4 text-sm"><p className="eyebrow mb-1">Notes</p>{a.notes}</div>}
          {a.status === "posted" && (
            <Button variant="outline" size="sm" asChild><Link to="/stock-ledger" search={{ doc: a.number } as never}>View in stock ledger</Link></Button>
          )}
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="eyebrow mb-3">Activity</p>
          <ol className="space-y-3 text-sm">
            {a.events.map((e, n) => (
              <li key={n} className="border-l-2 border-primary/40 pl-3">
                <p className="font-medium">{e.label}</p>
                <p className="text-xs text-muted-foreground">{e.by} · {formatDate(e.at.slice(0, 10))}</p>
                {e.note && <p className="mt-0.5 text-xs">{e.note}</p>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
