import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { invoiceCancelProblems } from "@/lib/invoice-rules";
import { formatDate, formatINR } from "@/lib/format";
import { lineTaxable } from "@/lib/gst";
import { PageHeader, ErrorState, LoadingRows } from "@/components/app/states";
import { PrintDocument } from "@/components/app/PrintDocument";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/invoices/$id")({
  head: () => ({
    meta: [
      { title: "Tax invoice — Girder" },
      { name: "description", content: "GST tax invoice with tax summary, advances applied and linked challans." },
      { property: "og:title", content: "Tax invoice — Girder" },
      { property: "og:description", content: "GST tax invoice with tax summary, advances applied and linked challans." },
    ],
  }),
  component: InvoiceDetail,
});

function InvoiceDetail() {
  const { id } = Route.useParams();
  const session = useSession();
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const q = useQuery({ queryKey: ["invoice", session?.orgId, id], queryFn: () => api.getInvoice(id), enabled: !!session?.orgId });
  const profiles = useQuery({ queryKey: ["print-profiles", session?.orgId], queryFn: api.listPrintProfiles, enabled: !!session?.orgId });
  const settings = useQuery({ queryKey: ["settings", session?.orgId], queryFn: api.getSettings, enabled: !!session?.orgId });
  const cancel = useMutation({
    mutationFn: () => api.cancelInvoice(id, reason),
    onSuccess: (next) => {
      qc.setQueryData(["invoice", session?.orgId, id], next);
      qc.invalidateQueries();
      toast.success(`Invoice ${next.number} cancelled`);
      setCancelOpen(false);
      setReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const i = q.data;
  const advTotal = i.advances.reduce((a, b) => a + b.amount, 0);
  const todayIndia = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const mayCancel = can(session?.user.role, "issueInvoice") && !invoiceCancelProblems(i, "Valid cancellation reason", todayIndia).length;
  const cancellationProblems = invoiceCancelProblems(i, reason, todayIndia);
  const profile = profiles.data?.find((p) => p.id === "B");
  return (
    <div>
      {profile && settings.data && <PrintDocument kind="invoice" document={i} profile={profile} settings={settings.data} />}
      <div>
      <PageHeader
        title={i.number}
        eyebrow="Tax invoice"
        actions={<div className="flex gap-2">{i.status !== "cancelled" && i.balance > 0 && <Button asChild><Link to="/receipts/new" search={{ customerId: i.customerId }}><Wallet /> Record payment</Link></Button>}{mayCancel && <Button variant="outline" onClick={() => setCancelOpen(true)}><X /> Cancel invoice</Button>}<Button variant="outline" disabled={!profile || !settings.data} title={!profile || !settings.data ? "Load print profile and organisation settings first" : `Print ${profile.copies} A4 copy/copies`} onClick={() => window.print()}><Printer /> Print {profile ? `(${profile.copies})` : ""}</Button></div>}
      >
        <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground"><StatusBadge status={i.status} /> {formatDate(i.date)} · due {formatDate(i.dueDate)}</div>
      </PageHeader>
      </div>
      {i.status === "cancelled" && <div className="mb-4 border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">CANCELLED · {i.cancelled?.reason ?? "Invoice voided"} · This document is not valid for payment or tax filing.</div>}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="grid gap-4 rounded-lg border bg-card p-4 text-sm sm:grid-cols-3">
            <div><div className="eyebrow">Bill to</div><Link to="/parties/$id" params={{ id: i.customerId }} className="font-medium hover:underline">{i.customerName}</Link><div className="num text-muted-foreground">{i.gstin ?? "Unregistered"}</div></div>
            <div><div className="eyebrow">Place of supply</div>{i.placeOfSupplyName} ({i.placeOfSupplyCode})</div>
            <div><div className="eyebrow">Tax type</div>{i.supply === "intra" ? "CGST + SGST" : "IGST"}</div>
          </div>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/60"><tr className="eyebrow">
                {["Item", "HSN", "Qty", "Rate", "Disc", "GST"].map((h) => <th key={h} className="px-4 py-2 text-left font-semibold">{h}</th>)}
                <th className="px-4 py-2 text-right font-semibold">Taxable</th>
              </tr></thead>
              <tbody>
                {i.lines.map((l, n) => (
                  <tr key={n} className="border-t">
                    <td className="px-4 py-2">{l.itemName}</td><td className="num px-4 py-2">{l.hsn}</td><td className="num px-4 py-2">{l.qty} {l.uom}</td>
                    <td className="num px-4 py-2">{formatINR(l.rate)}</td><td className="num px-4 py-2">{l.discountPct || 0}%</td><td className="num px-4 py-2">{l.gstRate}%</td>
                    <td className="num px-4 py-2 text-right">{formatINR(lineTaxable(l))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-lg border bg-card">
            <div className="eyebrow border-b px-4 py-2.5">Tax summary by rate</div>
            <table className="w-full text-sm">
              <tbody>
                {i.byRate.map((r) => (
                  <tr key={r.rate} className="border-t first:border-0">
                    <td className="num px-4 py-2">{r.rate}%</td>
                    <td className="num px-4 py-2 text-right">Taxable {formatINR(r.taxable)}</td>
                    <td className="num px-4 py-2 text-right">{i.supply === "intra" ? `CGST ${formatINR(r.tax / 2)} · SGST ${formatINR(r.tax / 2)}` : `IGST ${formatINR(r.tax)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="space-y-4">
          <div className="space-y-2 rounded-lg border bg-card p-4 text-sm">
            <R k="Taxable value" v={i.taxable} />
            {i.supply === "inter" ? <R k="IGST" v={i.igst} /> : <><R k="CGST" v={i.cgst} /><R k="SGST" v={i.sgst} /></>}
            <R k="Round off" v={i.roundOff} />
            <R k="Invoice total" v={i.grandTotal} bold />
            {i.advances.map((a) => <R key={a.advanceId} k={`Advance ${a.receiptNo}`} v={-a.amount} />)}
            {i.paid > 0 && <R k="Payments received" v={-i.paid} />}
            <R k="Balance due" v={i.balance} bold />
            {advTotal > 0 && <p className="text-xs text-muted-foreground">Advances applied oldest first.</p>}
            {i.status === "cancelled" && <p className="text-xs text-muted-foreground">Applied advances were released back to the customer account.</p>}
          </div>
          <div className="rounded-lg border bg-card p-4 text-sm">
            <div className="eyebrow mb-2">Related documents</div>
            <ul className="space-y-1.5">
              {i.challans.map((c) => (
                <li key={c.id}>
                  <Link to="/challans/$id" params={{ id: c.id }} className="num hover:underline">{c.number}</Link> <span className="text-muted-foreground">· Challan</span>
                  <br /><Link to="/sales-orders/$id" params={{ id: c.soId }} className="num hover:underline">{c.soNumber}</Link> <span className="text-muted-foreground">· Sales order</span>
                </li>
              ))}
              {i.advances.map((a) => <li key={a.advanceId}><span className="num">{a.receiptNo}</span> <span className="text-muted-foreground">· Advance receipt</span></li>)}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Issued by {i.createdBy}.</p>
          </div>
        </aside>
      </div>
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="print:hidden">
          <DialogHeader><DialogTitle>Cancel invoice {i.number}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This action keeps the original invoice number as cancelled, restores any applied advances, and makes its delivered challans available for reinvoicing. It does not return stock. Once paid or outside the current GST month, use a credit note instead.</p>
          <label className="grid gap-2 text-sm font-medium">Cancellation reason
            <Textarea aria-label="Cancellation reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Give a clear audit reason (5–500 characters)" />
          </label>
          {reason && cancellationProblems.map((problem) => <p key={problem} className="text-xs text-destructive">{problem}</p>)}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep invoice</Button>
            <Button variant="destructive" disabled={!!cancellationProblems.length || cancel.isPending} onClick={() => cancel.mutate()}>{cancel.isPending ? "Cancelling…" : "Confirm cancellation"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function R({ k, v, bold }: { k: string; v: number; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? "border-t pt-2 font-semibold" : ""}`}><span>{k}</span><span className="num">{formatINR(v)}</span></div>;
}
