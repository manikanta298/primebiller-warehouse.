import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useSession } from "@/lib/session";
import { formatDate, formatINR } from "@/lib/format";
import { computeTotals, supplyType } from "@/lib/gst";
import { applyAdvancesOldestFirst, invoiceIssueProblems } from "@/lib/invoice-rules";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/invoices/new")({
  validateSearch: z.object({ challanId: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "New tax invoice — Girder" },
      { name: "description", content: "Pick delivered challans, apply advances and issue a gapless GST tax invoice." },
      { property: "og:title", content: "New tax invoice — Girder" },
      { property: "og:description", content: "Pick delivered challans, apply advances and issue a gapless GST tax invoice." },
    ],
  }),
  component: NewInvoice,
});

const todayIndia = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function NewInvoice() {
  const { challanId } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useSession();
  const orgState = session?.orgs.find((o) => o.id === session.orgId)?.stateCode ?? "";
  const dq = useQuery({ queryKey: ["challans", session?.orgId, "delivered"], queryFn: () => api.listChallans("delivered"), enabled: !!session?.orgId });
  const open = useMemo(() => (dq.data ?? []).filter((c) => !c.invoiceNo), [dq.data]);
  const [customerId, setCustomerId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [date, setDate] = useState(todayIndia);
  const [useAdv, setUseAdv] = useState(true);

  useEffect(() => {
    const c = open.find((x) => x.id === challanId);
    if (c && !customerId) { setCustomerId(c.customerId); setPicked([c.id]); }
  }, [open, challanId, customerId]);

  useEffect(() => { setCustomerId(""); setPicked([]); }, [session?.orgId]);

  const customers = [...new Map(open.map((c) => [c.customerId, c.customerName])).entries()];
  const forCust = open.filter((c) => c.customerId === customerId);
  const sel = forCust.filter((c) => picked.includes(c.id));
  const advQ = useQuery({ queryKey: ["advances", session?.orgId, customerId], queryFn: () => api.listAdvances(customerId), enabled: !!session?.orgId && !!customerId });
  const totals = sel.length && orgState && new Set(sel.map((c) => c.placeOfSupplyCode)).size === 1
    ? computeTotals(sel.flatMap((c) => c.lines), supplyType(orgState, sel[0]!.placeOfSupplyCode)) : null;
  const allocs = totals && useAdv ? applyAdvancesOldestFirst(advQ.data ?? [], totals.grandTotal) : [];
  const advTotal = allocs.reduce((a, b) => a + b.amount, 0);
  const problems = invoiceIssueProblems(sel, picked, date, todayIndia());
  const canIssue = sel.length > 0 && !!orgState && !problems.length && !issuePendingAdvance(useAdv, advQ.isFetching);

  const issue = useMutation({
    mutationFn: () => api.issueInvoice({ challanIds: picked, date, applyAdvances: useAdv }),
    onSuccess: (inv) => {
      qc.invalidateQueries();
      toast.success(`Invoice ${inv.number} issued`);
      navigate({ to: "/invoices/$id", params: { id: inv.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canIssue && !issue.isPending) { e.preventDefault(); issue.mutate(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [canIssue, issue]);

  if (dq.isLoading) return <LoadingRows />;
  if (dq.error) return <ErrorState error={dq.error} onRetry={dq.refetch} />;

  return (
    <div>
      <PageHeader title="New tax invoice" eyebrow="Sales" />
      {!open.length ? <EmptyState title="Nothing to invoice" hint="Only delivered challans that are not yet invoiced can be converted." /> : (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
              <Field label="Customer">
                <NativeSelect value={customerId} onChange={(e) => { setCustomerId(e.target.value); setPicked([]); }}>
                  <option value="">Choose customer…</option>
                  {customers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Invoice date"><Input type="date" value={date} max={todayIndia()} onChange={(e) => setDate(e.target.value)} /></Field>
            </div>
            {customerId && (
              <div className="rounded-lg border bg-card">
                <div className="eyebrow border-b px-4 py-2.5">Delivered challans</div>
                {forCust.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-3 border-b px-4 py-3 last:border-0 hover:bg-muted/40">
                    <Checkbox checked={picked.includes(c.id)} onCheckedChange={(v) => setPicked((p) => (v ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
                    <span className="num font-medium">{c.number}</span>
                    <span className="text-sm text-muted-foreground">{formatDate(c.date)} · {c.soNumber} · {c.lines.length} line(s)</span>
                    <span className="num ml-auto">{formatINR(c.value, 0)}</span>
                  </label>
                ))}
              </div>
            )}
            {sel.length > 0 && (
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60"><tr className="eyebrow">{["Item", "HSN", "Qty", "Rate", "GST"].map((h) => <th key={h} className="px-4 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
                  <tbody>
                    {sel.flatMap((c) => c.lines.map((l, i) => (
                      <tr key={`${c.id}-${i}`} className="border-t">
                        <td className="px-4 py-2">{l.itemName}</td><td className="num px-4 py-2">{l.hsn}</td>
                        <td className="num px-4 py-2">{l.qty} {l.uom}</td><td className="num px-4 py-2">{formatINR(l.rate)}</td><td className="num px-4 py-2">{l.gstRate}%</td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <aside className="h-fit space-y-3 rounded-lg border bg-card p-4 text-sm">
            <div className="eyebrow">Summary</div>
            {totals ? (
              <>
                <Row k="Taxable value" v={totals.taxable} />
                {totals.igst ? <Row k="IGST" v={totals.igst} /> : <><Row k="CGST" v={totals.cgst} /><Row k="SGST" v={totals.sgst} /></>}
                <Row k="Round off" v={totals.roundOff} />
                <Row k="Invoice total" v={totals.grandTotal} bold />
                <label className="flex items-center gap-2 border-t pt-3"><Checkbox checked={useAdv} onCheckedChange={(v) => setUseAdv(!!v)} /> Apply advances (oldest first)</label>
                {allocs.map((a) => {
                  const adv = advQ.data?.find((x) => x.id === a.advanceId);
                  return <Row key={a.advanceId} k={`${adv?.receiptNo} · ${adv ? formatDate(adv.date) : ""}`} v={-a.amount} />;
                })}
                {useAdv && !advQ.data?.length && <p className="text-xs text-muted-foreground">No open advances for this customer.</p>}
                <Row k="Balance due" v={totals.grandTotal - advTotal} bold />
              </>
            ) : <p className="text-muted-foreground">Pick challans to see totals.</p>}
            {picked.length > 0 && problems.map((p) => <p key={p} className="text-xs text-destructive">{p}</p>)}
            {useAdv && advQ.isFetching && <p className="text-xs text-muted-foreground">Checking available advances…</p>}
            <Button className="w-full" disabled={!canIssue || issue.isPending} onClick={() => issue.mutate()}>
              {issue.isPending ? "Issuing…" : "Issue invoice"} <kbd className="ml-1 text-[10px] opacity-70">Ctrl+↵</kbd>
            </Button>
            <p className="text-xs text-muted-foreground">The number is assigned when issued, with no gaps.</p>
          </aside>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: number; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? "border-t pt-2 font-semibold" : ""}`}><span>{k}</span><span className="num">{formatINR(v)}</span></div>;
}

function issuePendingAdvance(apply: boolean, loading: boolean): boolean { return apply && loading; }
