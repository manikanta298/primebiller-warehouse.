import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Circle, FileCheck2, PackageCheck, Printer, Receipt, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Challan, EwbAction } from "@/api/types";
import { canCancelTestEwb } from "@/lib/challan-rules";
import { can } from "@/lib/permissions";
import { formatDate, formatINR, formatQty } from "@/lib/format";
import { useSession } from "@/lib/session";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { Field } from "@/components/app/form-bits";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PrintDocument } from "@/components/app/PrintDocument";

export const Route = createFileRoute("/_authenticated/challans/$id")({
  head: () => ({
    meta: [
      { title: "Delivery challan — Girder" },
      { name: "description", content: "Challan status timeline, consignment, e-way bill and proof of delivery." },
      { property: "og:title", content: "Delivery challan — Girder" },
      { property: "og:description", content: "Challan status timeline, consignment, e-way bill and proof of delivery." },
    ],
  }),
  component: ChallanDetail,
});

const dt = (iso: string) => `${formatDate(iso)}, ${new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;

type DialogKind = "deliver" | "cancel" | "extend" | "part-b" | "ewb-cancel" | null;

function ChallanDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const session = useSession();
  const role = session?.user.role;
  const q = useQuery({ queryKey: ["challan", session?.orgId, id], queryFn: () => api.getChallan(id), enabled: !!session?.orgId });
  const [dlg, setDlg] = useState<DialogKind>(null);
  const profiles = useQuery({ queryKey: ["print-profiles", session?.orgId], queryFn: api.listPrintProfiles, enabled: !!session?.orgId });
  const settings = useQuery({ queryKey: ["settings", session?.orgId], queryFn: api.getSettings, enabled: !!session?.orgId });

  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const c = q.data;
  const profile = profiles.data?.find((p) => p.id === "A");
  const office = can(role, "dispatch");
  const inTransit = c.status === "in_transit";
  const canDeliver = inTransit && (office || (role === "Driver" && c.driverName.toLocaleLowerCase() === session?.user.name.toLocaleLowerCase()));
  const ewbActive = c.ewb?.status === "active" && inTransit;
  const done = (label: string) => c.events.find((e) => e.label === label);
  const timeline: { label: string; at?: string | undefined; skip?: boolean }[] = [
    { label: "Draft", at: c.events[0]?.at },
    { label: "Stock posted", at: done("Stock posted")?.at },
    { label: "E-way bill generated", at: done("E-way bill generated")?.at, skip: !c.ewb },
    { label: "Vehicle departed", at: done("Vehicle departed")?.at },
    { label: "POD received", at: c.pod?.at },
    { label: "Invoiced", at: c.invoiceNo ? c.pod?.at : undefined },
  ];
  const onSaved = (msg: string) => (next: Challan) => {
    qc.setQueryData(["challan", session?.orgId, id], next);
    qc.invalidateQueries({ predicate: (x) => x.queryKey[0] !== "challan" });
    toast.success(msg);
    setDlg(null);
  };

  return (
    <div>
      {profile && settings.data && <PrintDocument kind="challan" document={c} profile={profile} settings={settings.data} />}
      <Link to="/challans" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"><ArrowLeft className="size-4" /> Delivery challans</Link>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1">Delivery challan</div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight"><span className="num">{c.number}</span><StatusBadge status={c.status} /></h1>
          <p className="mt-1 text-sm text-muted-foreground">{c.customerName} · {formatDate(c.date)} · from {c.godownName}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {office && inTransit && (!c.ewb || c.ewb.status !== "active" || canCancelTestEwb(c.ewb.generatedAt, new Date().toISOString())) && <Button variant="outline" onClick={() => setDlg("cancel")}><X /> Cancel challan</Button>}
          <Button variant="outline" disabled={!profile || !settings.data} title={!profile || !settings.data ? "Load print profile and organisation settings first" : `Print ${profile.copies} gate pass copy/copies`} onClick={() => window.print()}><Printer /> Print gate pass {profile ? `(${profile.copies})` : ""}</Button>
          {can(role, "issueInvoice") && <Button variant="outline" disabled={c.status !== "delivered" || !!c.invoiceNo} title={c.invoiceNo ? "Already invoiced" : c.status !== "delivered" ? "Deliver first" : "Create tax invoice"} asChild={c.status === "delivered" && !c.invoiceNo}>
            {c.status === "delivered" && !c.invoiceNo ? <Link to="/invoices/new" search={{ challanId: c.id }}><Receipt /> Convert to invoice</Link> : <span><Receipt /> Convert to invoice</span>}
          </Button>}
          {canDeliver && <Button variant="ember" onClick={() => setDlg("deliver")}><PackageCheck /> Mark delivered</Button>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-4">
          <section className="rounded-lg border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold">Status</h2>
            <ol className="flex flex-wrap gap-x-6 gap-y-3">
              {timeline.filter((s) => !s.skip).map((s) => (
                <li key={s.label} className="flex items-start gap-2">
                  {s.at ? <CheckCircle2 className="mt-0.5 size-4 text-primary" /> : <Circle className="mt-0.5 size-4 text-muted-foreground" />}
                  <div><div className={cn("text-sm", !s.at && "text-muted-foreground")}>{s.label}</div>{s.at && <div className="num text-[11px] text-muted-foreground">{dt(s.at)}</div>}</div>
                </li>
              ))}
            </ol>
            {c.status === "cancelled" && <p className="mt-3 text-sm text-destructive">Cancelled — stock returned and reservation restored. {c.events.at(-1)?.note}</p>}
          </section>

          <section className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/60"><tr className="eyebrow text-left"><th className="px-4 py-2.5">Item</th><th className="px-4 py-2.5">HSN</th><th className="px-4 py-2.5">Batches</th><th className="px-4 py-2.5 text-right">Qty</th><th className="px-4 py-2.5 text-right">Rate</th><th className="px-4 py-2.5 text-right">Taxable</th></tr></thead>
              <tbody>
                {c.lines.map((l) => (
                  <tr key={l.soLineId} className="border-t">
                    <td className="px-4 py-2.5">{l.itemName}</td>
                    <td className="num px-4 py-2.5">{l.hsn}</td>
                    <td className="num px-4 py-2.5 text-xs text-muted-foreground">{l.allocations.map((a) => (a.batchNo ? `${a.batchNo} × ${formatQty(a.qty)}` : "General")).join(", ")}</td>
                    <td className="num px-4 py-2.5 text-right">{formatQty(l.qty)} {l.uom}</td>
                    <td className="num px-4 py-2.5 text-right">{formatINR(l.rate)}</td>
                    <td className="num px-4 py-2.5 text-right">{formatINR(l.qty * l.rate * (1 - l.discountPct / 100))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t text-sm">
                <tr><td colSpan={5} className="px-4 py-1.5 text-right text-muted-foreground">Taxable</td><td className="num px-4 py-1.5 text-right">{formatINR(c.taxable)}</td></tr>
                <tr><td colSpan={5} className="px-4 py-1.5 text-right text-muted-foreground">GST</td><td className="num px-4 py-1.5 text-right">{formatINR(c.tax)}</td></tr>
                <tr className="font-semibold"><td colSpan={5} className="px-4 py-2 text-right">Consignment value</td><td className="num px-4 py-2 text-right">{formatINR(c.value)}</td></tr>
              </tfoot>
            </table>
          </section>
          {c.overrideReason && <p className="text-xs text-muted-foreground">FIFO batches changed: {c.overrideReason}</p>}

          <section className="rounded-lg border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">Activity</h2>
            <ul className="space-y-2 text-sm">
              {[...c.events].reverse().map((e, i) => (
                <li key={i} className="flex justify-between gap-3"><span>{e.label}{e.note && <span className="text-muted-foreground"> · {e.note}</span>}</span><span className="num shrink-0 text-xs text-muted-foreground">{e.by} · {dt(e.at)}</span></li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border bg-card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><FileCheck2 className="size-4" /> E-way bill</h2>
            {!c.ewb ? <p className="text-sm text-muted-foreground">Not required — value is ₹50,000 or less.</p> : (
              <div className="space-y-1.5 text-sm">
                {c.ewb.number.startsWith("TEST") && <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">Test EWB placeholder only — not issued by the government. Configure and integrate a live GSP before using this as a statutory e-way bill.</p>}
                <KV k="EWB no." v={<span className={cn("num font-medium", c.ewb.status === "cancelled" && "text-destructive line-through")}>{c.ewb.number}</span>} />
                <KV k="Status" v={c.ewb.status === "active" ? "Active" : "Cancelled"} />
                <KV k="Valid until" v={<span className="num">{dt(c.ewb.validUntil)}</span>} />
                <KV k="Vehicle" v={<span className="num">{c.ewb.vehicleNo}</span>} />
                <KV k="Distance" v={<span className="num">{c.ewb.distanceKm} km</span>} />
                {office && ewbActive && (
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    <Button size="sm" variant="outline" onClick={() => setDlg("extend")}>Extend validity</Button>
                    <Button size="sm" variant="outline" onClick={() => setDlg("part-b")}>Update Part-B</Button>
                    <Button size="sm" variant="outline" className="text-destructive" disabled={!canCancelTestEwb(c.ewb.generatedAt, new Date().toISOString())} title="Allowed within 24 hours of generation" onClick={() => setDlg("ewb-cancel")}>Cancel EWB</Button>
                  </div>
                )}
                <ul className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
                  {c.ewb.history.map((h, i) => <li key={i}>{dt(h.at)} · {h.action} · {h.by}</li>)}
                </ul>
              </div>
            )}
          </section>

          <section className="rounded-lg border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">Proof of delivery</h2>
            {c.pod ? (
              <div className="space-y-1.5 text-sm">
                <KV k="Received by" v={c.pod.receivedBy} />
                <KV k="At" v={<span className="num">{dt(c.pod.at)}</span>} />
                <KV k="Recorded by" v={c.pod.by} />
                {c.pod.remarks && <p className="text-muted-foreground">{c.pod.remarks}</p>}
              </div>
            ) : <p className="text-sm text-muted-foreground">{inTransit ? "Waiting for the driver or office to confirm delivery." : "Not delivered."}</p>}
          </section>

          <section className="rounded-lg border bg-card p-5 text-sm">
            <h2 className="mb-3 font-semibold">Transport</h2>
            <KV k="Vehicle" v={<span className="num">{c.vehicleNo}</span>} />
            <KV k="Driver" v={`${c.driverName}${c.driverPhone ? ` · ${c.driverPhone}` : ""}`} />
            <KV k="Transporter" v={c.transporter} />
          </section>

          <section className="rounded-lg border bg-card p-5 text-sm">
            <h2 className="mb-3 font-semibold">Related documents</h2>
            <ul className="space-y-2">
              <li><Link to="/sales-orders/$id" params={{ id: c.soId }} className="num text-primary hover:underline">{c.soNumber}</Link> <span className="text-muted-foreground">· Sales order</span></li>
              {c.invoiceNo && <li><Link to="/invoices" className="num underline-offset-2 hover:underline">{c.invoiceNo}</Link> <span className="text-muted-foreground">· Tax invoice</span></li>}
            </ul>
          </section>
        </aside>
      </div>

      {dlg === "deliver" && <DeliverDialog c={c} onClose={() => setDlg(null)} onSaved={onSaved("Marked delivered")} />}
      {(dlg === "cancel" || dlg === "extend" || dlg === "part-b" || dlg === "ewb-cancel") && (
        <ReasonDialog kind={dlg} c={c} onClose={() => setDlg(null)} onSaved={onSaved(dlg === "cancel" ? "Challan cancelled, stock reversed" : dlg === "extend" ? "E-way bill extended" : dlg === "part-b" ? "Part-B updated" : "E-way bill cancelled")} />
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-2"><span className="text-muted-foreground">{k}</span><span className="text-right">{v}</span></div>;
}

function DeliverDialog({ c, onClose, onSaved }: { c: Challan; onClose: () => void; onSaved: (c: Challan) => void }) {
  const [receivedBy, setReceivedBy] = useState("");
  const [remarks, setRemarks] = useState("");
  const m = useMutation({ mutationFn: () => api.deliverChallan(c.id, { receivedBy, remarks }), onSuccess: onSaved, onError: (e: Error) => toast.error(e.message) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Mark {c.number} delivered</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Received by"><Input autoFocus value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Name of person at site" /></Field>
          <Field label="Remarks"><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. 2 bags torn, accepted" /></Field>
        </div>
        <DialogFooter><Button disabled={!receivedBy.trim() || m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Saving…" : "Confirm delivery"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({ kind, c, onClose, onSaved }: { kind: "cancel" | "extend" | "part-b" | "ewb-cancel"; c: Challan; onClose: () => void; onSaved: (c: Challan) => void }) {
  const [reason, setReason] = useState("");
  const [vehicleNo, setVehicleNo] = useState(c.vehicleNo);
  const [km, setKm] = useState(0);
  const title = { cancel: `Cancel ${c.number}`, extend: "Extend e-way bill validity", "part-b": "Update Part-B (vehicle change)", "ewb-cancel": "Cancel e-way bill" }[kind];
  const m = useMutation({
    mutationFn: () => {
      if (kind === "cancel") return api.cancelChallan(c.id, reason);
      const a: EwbAction = kind === "extend" ? { action: "extend", extraKm: km, reason } : kind === "part-b" ? { action: "part-b", vehicleNo, reason } : { action: "cancel", reason };
      return api.ewbAction(c.id, a);
    },
    onSuccess: onSaved,
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {kind === "cancel" && <p className="text-sm text-muted-foreground">Stock goes back to {c.godownName}, the order's reservation is restored{c.ewb?.status === "active" ? " and the e-way bill is cancelled" : ""}.</p>}
          {kind === "extend" && <Field label="Remaining distance (km)" hint="1 extra day per 200 km"><Input type="number" min={1} value={km || ""} onChange={(e) => setKm(Number(e.target.value))} className="num" /></Field>}
          {kind === "part-b" && <Field label="New vehicle number"><Input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value.toUpperCase())} className="num" /></Field>}
          <Field label="Reason"><Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "part-b" ? "e.g. Vehicle breakdown" : kind === "extend" ? "e.g. Delay due to rain" : "e.g. Customer refused"} /></Field>
        </div>
        <DialogFooter>
          <Button variant={kind === "cancel" || kind === "ewb-cancel" ? "destructive" : "default"} disabled={reason.trim().length < (kind === "cancel" ? 5 : 3) || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "Saving…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
