import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export function DocumentDistribution({ type, id }: { type: "quotation" | "invoice"; id: string }) {
  const session = useSession()!, qc = useQueryClient();
  const [reason, setReason] = useState("");
  const query = useQuery({ queryKey: ["distribution", session.orgId, type, id], queryFn: () => api.documentDistribution(type, id), refetchInterval: 5000 });
  const decision = useMutation({ mutationFn: ({ version, approve }: { version: number; approve: boolean }) => api.decideQuotationRevision(id, version, approve, reason), onSuccess: () => { setReason(""); qc.invalidateQueries({ queryKey: ["distribution"] }); toast.success("Revision decision recorded"); }, onError: (e: Error) => toast.error(e.message) });
  const retry = useMutation({ mutationFn: (version: number) => api.retryDocumentDelivery(type, id, version), onSuccess: () => qc.invalidateQueries({ queryKey: ["distribution"] }), onError: (e: Error) => toast.error(e.message) });
  return <section aria-label="WhatsApp distribution" className="space-y-3 rounded-lg border bg-card p-4">
    <h2 className="font-semibold">WhatsApp delivery</h2>
    <p className="text-sm text-muted-foreground">The first saved quotation and issued invoices are queued automatically. Changed quotations require approval from a different Owner or Manager. Customer permission and a configured sender are required.</p>
    {query.isLoading && <p>Loading delivery history…</p>}
    {query.error && <p role="alert">Unable to load delivery history. <button onClick={() => query.refetch()}>Retry</button></p>}
    {!query.isLoading && !query.error && !query.data?.length && <p className="text-sm">No delivery event recorded for this document.</p>}
    {query.data?.map((v, index) => <div key={v.version} className="space-y-2 border-t pt-3 text-sm">
      <p><strong>Version {v.version}</strong> · {v.status.replaceAll("_", " ")} · saved by {v.authoredByName}</p>
      {v.reason && <p>Decision: {v.reason}</p>}{v.error && <p>{v.error.replaceAll("_", " ")}</p>}
      {index === 0 && v.status === "pending_approval" && can(session.user.role, "approveQuotationRevision") && (v.authoredBy === session.user.id ? <p>A different approver must review your revision.</p> : <div className="flex flex-wrap gap-2"><Input aria-label="Revision decision reason" placeholder="Approval or rejection reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /><Button disabled={reason.trim().length < 3 || decision.isPending} onClick={() => decision.mutate({ version: v.version, approve: true })}>Approve &amp; queue</Button><Button variant="outline" disabled={reason.trim().length < 3 || decision.isPending} onClick={() => decision.mutate({ version: v.version, approve: false })}>Reject</Button></div>)}
      {index === 0 && ["blocked", "failed"].includes(v.status) && can(session.user.role, "approveQuotationRevision") && <Button variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(v.version)}>Retry after resolving issue</Button>}
      {["uncertain", "processing"].includes(v.status) && <p>Delivery outcome needs reconciliation before any resend.</p>}
    </div>)}
  </section>;
}
