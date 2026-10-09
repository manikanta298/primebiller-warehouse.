import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PackageCheck, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { can } from "@/lib/permissions";
import { poWorkflowProblems } from "@/lib/purchase-rules";
import { useSession } from "@/lib/session";
import { formatDate, formatINR } from "@/lib/format";
import { PageHeader, ErrorState, LoadingRows } from "@/components/app/states";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/purchases/$id")({
  head: () => ({
    meta: [
      { title: "Purchase order — Girder" },
      { name: "description", content: "Purchase order lines, quantities received so far and linked goods receipts." },
      { property: "og:title", content: "Purchase order — Girder" },
      { property: "og:description", content: "Purchase order lines, quantities received so far and linked goods receipts." },
    ],
  }),
  component: PoDetail,
});

function PoDetail() {
  const { id } = Route.useParams();
  const session = useSession();
  const orgId = session?.orgId ?? "";
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const q = useQuery({ queryKey: ["po", orgId, id], queryFn: () => api.getPurchaseOrder(id), enabled: !!orgId });
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ["po", orgId, id] }); void qc.invalidateQueries({ queryKey: ["pos", orgId] }); };
  const approve = useMutation({ mutationFn: () => api.approvePurchaseOrder(id), onSuccess: () => { invalidate(); toast.success("Purchase order approved"); }, onError: (e: Error) => toast.error(e.message) });
  const cancel = useMutation({ mutationFn: () => api.cancelPurchaseOrder(id, reason), onSuccess: () => { invalidate(); setShowCancel(false); toast.success("Purchase order cancelled"); }, onError: (e: Error) => toast.error(e.message) });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const p = q.data;
  const canReceive = can(session?.user.role, "postGrn") && (p.status === "open" || p.status === "partially_received");
  const canManage = can(session?.user.role, "raisePO");
  const mayCancel = canManage && !poWorkflowProblems(p, "cancel", "Valid reason").length;
  return (
    <div>
      <PageHeader title={p.number} eyebrow="Purchase order" actions={
        <div className="flex flex-wrap gap-2">
          {canManage && p.status === "draft" && <Button disabled={approve.isPending} onClick={() => approve.mutate()}><CheckCircle2 /> {approve.isPending ? "Approving…" : "Approve PO"}</Button>}
          {mayCancel && <Button variant="outline" onClick={() => setShowCancel((v) => !v)}><XCircle /> Cancel PO</Button>}
          {canReceive && <Button asChild><Link to="/purchases/grn/new" search={{ poId: p.id }}><PackageCheck /> Receive goods</Link></Button>}
        </div>
      }>
        <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground"><StatusBadge status={p.status} /> {formatDate(p.date)} · {p.supplierName} → {p.godownName}</div>
      </PageHeader>
      {showCancel && mayCancel && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <Input aria-label="Cancellation reason" className="max-w-md" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for cancellation (5–500 characters)" />
        <Button variant="destructive" disabled={!!poWorkflowProblems(p, "cancel", reason).length || cancel.isPending} onClick={() => cancel.mutate()}>{cancel.isPending ? "Cancelling…" : "Confirm cancellation"}</Button>
        <Button variant="ghost" onClick={() => setShowCancel(false)}>Keep order</Button>
      </div>}
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60"><tr className="eyebrow">
              <th className="px-4 py-2 text-left">Item</th><th className="px-4 py-2 text-right">Ordered</th><th className="px-4 py-2 text-right">Received</th><th className="px-4 py-2 text-right">Pending</th><th className="px-4 py-2 text-right">Rate</th><th className="px-4 py-2 text-right">GST</th>
            </tr></thead>
            <tbody>
              {p.lines.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="px-4 py-2">{l.itemName}</td>
                  <td className="num px-4 py-2 text-right">{l.qty} {l.uom}</td>
                  <td className="num px-4 py-2 text-right">{l.receivedQty}</td>
                  <td className="num px-4 py-2 text-right font-medium">{Math.max(0, l.qty - l.receivedQty)}</td>
                  <td className="num px-4 py-2 text-right">{formatINR(l.rate)}</td>
                  <td className="num px-4 py-2 text-right">{l.gstRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end border-t px-4 py-3 text-sm font-semibold">Total incl. GST <span className="num ml-4">{formatINR(p.grandTotal, 0)}</span></div>
        </div>
        <aside className="h-fit rounded-lg border bg-card p-4 text-sm">
          <div className="eyebrow mb-2">Goods receipts</div>
          {!p.grns.length ? <p className="text-muted-foreground">Nothing received yet.</p> : (
            <ul className="space-y-1.5">{p.grns.map((g) => <li key={g.id}><Link to="/purchases/grn/$id" params={{ id: g.id }} className="num hover:underline">{g.number}</Link> <span className="text-muted-foreground">· {formatDate(g.date)}</span></li>)}</ul>
          )}
          {p.notes && <p className="mt-3 text-muted-foreground">{p.notes}</p>}
          <p className="mt-3 text-xs text-muted-foreground">Raised by {p.createdBy}</p>
          {p.approvedBy && <p className="mt-1 text-xs text-muted-foreground">Approved by {p.approvedBy}</p>}
          {p.cancellationReason && <p className="mt-3 text-destructive">Cancelled by {p.cancelledBy}: {p.cancellationReason}</p>}
        </aside>
      </div>
    </div>
  );
}
