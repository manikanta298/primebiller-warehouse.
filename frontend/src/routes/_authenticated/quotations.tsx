import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Printer, Save, ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Quotation, QuotationInput, PaymentMode } from "@/api/types";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { computeTotals, supplyType } from "@/lib/gst";
import { quotationProblems } from "@/lib/quotation-rules";
import { indiaItemDate } from "@/lib/item-detail-rules";
import { formatINR, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, LoadingRows } from "@/components/app/states";

export const Route = createFileRoute("/_authenticated/quotations")({
  head: () => ({ meta: [{ title: "Quotations — Girder" }] }),
  component: QuotationsPage,
});
export function QuotationsPage() {
  const session = useSession()!;
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const quotes = useQuery({ queryKey: ["quotations", session.orgId], queryFn: api.listQuotations });
  useEffect(() => { setSelected(null); }, [session.orgId]);
  if (selected) return <QuotationEditor key={`${session.orgId}:${selected}`} id={selected} onBack={() => setSelected(null)} onSaved={setSelected} />;
  if (quotes.isLoading) return <LoadingRows rows={6} />;
  if (quotes.error) return <ErrorState error={quotes.error} onRetry={() => quotes.refetch()} />;
  const rows = (quotes.data ?? []).filter(q => `${q.number} ${q.customerName} ${q.status}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="eyebrow">Sales</div><h1 className="text-2xl font-semibold">Quotations</h1><p className="text-sm text-muted-foreground">Offer prices, record customer acceptance, then create a Sales Order.</p></div>{can(session.user.role, "salesOrders") && <Button onClick={() => setSelected("new")}><Plus /> New quotation</Button>}</div>
    <Input aria-label="Search quotations" placeholder="Search number, customer or status" value={search} onChange={e => setSearch(e.target.value)} className="max-w-md" />
    {!rows.length ? <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground"><FileText className="mx-auto mb-3 size-8" />No quotations yet.</div> : <div className="overflow-x-auto rounded-lg border bg-card"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">Quotation</th><th className="p-3">Customer</th><th className="p-3">Valid until</th><th className="p-3">Status</th><th className="p-3 text-right">Total</th></tr></thead><tbody>{rows.map(q => <tr key={q.id} className="border-b last:border-0"><td className="p-3"><button className="min-h-11 text-primary underline" onClick={() => setSelected(q.id)}>{q.number}</button></td><td className="p-3">{q.customerName}</td><td className="whitespace-nowrap p-3">{formatDate(q.validUntil)}</td><td className="p-3 capitalize">{q.status}{q.validUntil < indiaItemDate() && ["draft", "issued", "accepted"].includes(q.status) ? " · expired" : ""}</td><td className="whitespace-nowrap p-3 text-right num">{formatINR(q.grandTotal)}</td></tr>)}</tbody></table></div>}
  </div>;
}
function QuotationEditor({ id, onBack, onSaved }: { id: string; onBack: () => void; onSaved: (id: string) => void }) {
  const session = useSession()!;
  const query = useQuery({ queryKey: ["quotation", session.orgId, id], queryFn: () => api.getQuotation(id), enabled: id !== "new" });
  if (id !== "new" && query.isLoading) return <LoadingRows rows={8} />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (id !== "new" && !query.data) return null;
  return <QuoteForm key={query.data ? `${query.data.id}:${query.data.status}:${query.data.payments.length}` : "new"} quote={query.data} onBack={onBack} onSaved={onSaved} />;
}
const blankLine = () => ({ itemId: "", itemName: "", hsn: "", uom: "", qty: 1, rate: 0, discountPct: 0, gstRate: 0 });
function QuoteForm({ quote, onBack, onSaved }: { quote: Quotation | undefined; onBack: () => void; onSaved: (id: string) => void }) {
  const session = useSession()!;
  const org = session.orgs.find(o => o.id === session.orgId)!;
  const qc = useQueryClient(), navigate = useNavigate();
  const customers = useQuery({ queryKey: ["parties", session.orgId, "customer"], queryFn: () => api.listParties("customer") });
  const warehouses = useQuery({ queryKey: ["godowns", session.orgId], queryFn: () => api.listGodowns(session.orgId!) });
  const items = useQuery({ queryKey: ["items", session.orgId, "quotation"], queryFn: () => api.listItems() });
  const [input, setInput] = useState<QuotationInput>(() => ({ ...(quote ? { id: quote.id } : {}), customerId: quote?.customerId ?? "", godownId: quote?.godownId ?? (session.godownId !== "all" ? session.godownId : ""), date: quote?.date ?? indiaItemDate(), validUntil: quote?.validUntil ?? indiaItemDate(), terms: quote?.terms ?? "Prices valid until the date above. Delivery subject to availability.", notes: quote?.notes ?? "", lines: quote?.lines.map(({ id: _id, deliveredQty: _delivered, ...l }) => l) ?? [blankLine()] }));
  const clean = useRef(JSON.stringify(input));
  const editable = can(session.user.role, "salesOrders") && (!quote || quote.status === "draft");
  const dirty = editable && clean.current !== JSON.stringify(input);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const customer = customers.data?.find(c => c.id === input.customerId);
  const totals = computeTotals(input.lines.filter(l => l.itemId), quote?.status !== "draft" && quote ? quote.supply : supplyType(org.stateCode, customer?.stateCode ?? org.stateCode));
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(indiaItemDate());
  const paymentKey = useRef<string | null>(null);
  const paymentBody = useRef<string | null>(null);
  const changed = (q: Quotation) => {
    qc.setQueryData(["quotation", session.orgId, q.id], q);
    qc.invalidateQueries({ queryKey: ["quotations"] });
    onSaved(q.id);
  };
  const save = useMutation({ mutationFn: () => api.saveQuotation(input), onSuccess: q => { clean.current = JSON.stringify(input); toast.success("Quotation draft saved"); changed(q); }, onError: (e: Error) => toast.error(e.message) });
  const action = useMutation({ mutationFn: (a: "issue" | "accept" | "cancel") => api.quotationAction(quote!.id, a), onSuccess: q => { toast.success(`Quotation ${q.status}`); changed(q); }, onError: (e: Error) => toast.error(e.message) });
  const convert = useMutation({ mutationFn: () => api.convertQuotation(quote!.id), onSuccess: o => { qc.invalidateQueries({ queryKey: ["quotations"] }); qc.invalidateQueries({ queryKey: ["sales-orders"] }); toast.success("Draft Sales Order created; confirm it to reserve stock"); navigate({ to: "/sales-orders/$id", params: { id: o.id } }); }, onError: (e: Error) => toast.error(e.message) });
  const payment = useMutation({ mutationFn: () => {
    const body = { quotationId: quote!.id, customerId: quote!.customerId, date: paymentDate, amount: Number(amount), mode, reference, allocations: [] };
    const fingerprint = JSON.stringify(body);
    if (paymentBody.current && paymentBody.current !== fingerprint) throw new Error("Retry the same payment details first. Its previous result may still need reconciliation.");
    paymentBody.current = fingerprint; paymentKey.current ??= crypto.randomUUID();
    return api.recordReceipt({ ...body, requestKey: paymentKey.current });
  }, onSuccess: rc => { toast.success(`Advance recorded: ${rc.number}`); paymentKey.current = null; paymentBody.current = null; setAmount(""); setReference(""); qc.invalidateQueries({ queryKey: ["quotation", session.orgId, quote!.id] }); qc.invalidateQueries({ queryKey: ["quotations"] }); qc.invalidateQueries({ queryKey: ["receipts"] }); qc.invalidateQueries({ queryKey: ["advances"] }); }, onError: (e: Error) => { if ('status' in e && Number(e.status) < 500) { paymentKey.current = null; paymentBody.current = null; } toast.error(e.message); } });
  const busy = save.isPending || action.isPending || convert.isPending || payment.isPending;
  const expired = !!quote && quote.validUntil < indiaItemDate();
  const set = (patch: Partial<QuotationInput>) => setInput(i => ({ ...i, ...patch }));
  const updateLine = (index: number, patch: Partial<QuotationInput["lines"][number]>) => setInput(i => ({ ...i, lines: i.lines.map((l, j) => j === index ? { ...l, ...patch } : l) }));
  const printTotals = quote ? computeTotals(quote.lines, quote.supply) : totals;
  const paid = quote?.payments.reduce((n, p) => n + p.amount, 0) ?? 0;
  return <div className="space-y-5">
    <Button variant="ghost" onClick={() => { if (!dirty || window.confirm("Discard unsaved quotation changes?")) onBack(); }}><ArrowLeft /> Quotations</Button>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">{quote?.number ?? "New quotation"}</h1><p className="text-sm capitalize text-muted-foreground">{quote?.status ?? "draft"}{expired ? " · expired" : ""}</p></div><div className="flex flex-wrap gap-2">
      {editable && <Button disabled={busy} onClick={() => { const p = quotationProblems(input, indiaItemDate()); if (p.length) toast.error(p[0]!); else save.mutate(); }}><Save /> Save draft</Button>}
      {can(session.user.role, "salesOrders") && quote?.status === "draft" && <Button disabled={busy || dirty || expired} onClick={() => action.mutate("issue")}>Issue quotation</Button>}
      {can(session.user.role, "salesOrders") && quote?.status === "issued" && <Button disabled={busy || expired} onClick={() => { if (window.confirm("Record that the customer has accepted this quotation?")) action.mutate("accept"); }}>Record acceptance</Button>}
      {can(session.user.role, "salesOrders") && quote?.status === "accepted" && <Button disabled={busy || expired} onClick={() => convert.mutate()}>Convert to Sales Order</Button>}
      {quote?.salesOrderId && can(session.user.role, "salesOrders") && <Button asChild variant="outline"><Link to="/sales-orders/$id" params={{ id: quote.salesOrderId }}>Open Sales Order</Link></Button>}
      {quote && <Button variant="outline" disabled={dirty || busy} onClick={() => window.print()}><Printer /> Print / Save PDF</Button>}
      {can(session.user.role, "salesOrders") && quote && ["draft", "issued", "accepted"].includes(quote.status) && !paid && <Button variant="outline" disabled={busy} onClick={() => { if (window.confirm("Cancel this quotation?")) action.mutate("cancel"); }}>Cancel</Button>}
    </div></div>
    <p className="rounded-lg border bg-muted/40 p-3 text-sm">Quotations do not reserve or reduce stock. Customer acceptance can be recorded with or without a payment. Confirmation of the resulting Sales Order reserves stock.</p>
    <fieldset disabled={!editable || busy} className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="space-y-1 text-sm">Customer<select aria-label="Quotation customer" className="h-10 w-full rounded border bg-background px-2" value={input.customerId} onChange={e => set({ customerId: e.target.value })}><option value="">Choose customer</option>{customers.data?.map(c => <option key={c.id} value={c.id} disabled={!!c.blocked}>{c.name}</option>)}</select></label>
      <label className="space-y-1 text-sm">Warehouse<select aria-label="Quotation warehouse" className="h-10 w-full rounded border bg-background px-2" value={input.godownId} onChange={e => set({ godownId: e.target.value })}><option value="">Choose warehouse</option>{warehouses.data?.filter(g => g.active).map(g => <option key={g.id} value={g.id}>{g.name} ({g.code})</option>)}</select></label>
      <label className="space-y-1 text-sm">Quotation date<Input type="date" value={input.date} onChange={e => set({ date: e.target.value })} /></label>
      <label className="space-y-1 text-sm">Valid until<Input type="date" min={input.date} value={input.validUntil} onChange={e => set({ validUntil: e.target.value })} /></label>
    </fieldset>
    {[customers.error, warehouses.error, items.error].filter(Boolean).map((e, index) => <ErrorState key={index} error={e} onRetry={() => { customers.refetch(); warehouses.refetch(); items.refetch(); }} />)}
    <fieldset disabled={!editable || busy} className="space-y-3">
      {input.lines.map((l, index) => <div key={index} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6"><label className="text-sm lg:col-span-2">Item<select aria-label={`Item ${index + 1}`} className="mt-1 h-10 w-full rounded border bg-background px-2" value={l.itemId} onChange={e => { const it = items.data?.find(it => it.id === e.target.value); updateLine(index, it ? { itemId: it.id, itemName: it.name, hsn: it.hsn, uom: it.baseUom, rate: it.salePrice, gstRate: it.gstRate } : blankLine()); }}><option value="">Choose item</option>{items.data?.filter(it => it.active).map(it => <option key={it.id} value={it.id}>{it.name} · {it.sku}</option>)}</select><span className="text-xs text-muted-foreground">HSN {l.hsn || "—"} · GST {l.gstRate}% · {l.uom}</span></label><label className="text-sm">Quantity<Input type="number" min="0.001" step="0.001" value={l.qty} onChange={e => updateLine(index, { qty: Number(e.target.value) })} /></label><label className="text-sm">Rate<Input type="number" min="0" step="0.01" value={l.rate} onChange={e => updateLine(index, { rate: Number(e.target.value) })} /></label><label className="text-sm">Discount %<Input type="number" min="0" max="100" step="0.01" value={l.discountPct} onChange={e => updateLine(index, { discountPct: Number(e.target.value) })} /></label><div className="flex items-center justify-between gap-2"><span className="text-sm">{formatINR(computeTotals([l], quote?.supply ?? supplyType(org.stateCode, customer?.stateCode ?? org.stateCode)).grandTotal)}</span>{editable && <Button aria-label={`Remove item ${index + 1}`} variant="ghost" size="icon" onClick={() => set({ lines: input.lines.filter((_, j) => j !== index) })}><Trash2 /></Button>}</div></div>)}
      {editable && <Button variant="outline" disabled={input.lines.length >= 200} onClick={() => set({ lines: [...input.lines, blankLine()] })}><Plus /> Add item</Button>}
      <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1 text-sm">Notes<Textarea value={input.notes} maxLength={2000} onChange={e => set({ notes: e.target.value })} /></label><label className="space-y-1 text-sm">Terms and conditions<Textarea value={input.terms} maxLength={2000} onChange={e => set({ terms: e.target.value })} /></label></div>
    </fieldset>
    <div className="ml-auto max-w-sm rounded-lg border bg-card p-4 text-sm"><div className="flex justify-between"><span>Taxable</span><span>{formatINR(totals.taxable)}</span></div><div className="flex justify-between"><span>GST</span><span>{formatINR(totals.cgst + totals.sgst + totals.igst)}</span></div><div className="flex justify-between"><span>Round off</span><span>{formatINR(totals.roundOff)}</span></div><div className="mt-2 flex justify-between border-t pt-2 text-lg font-semibold"><span>Total</span><span>{formatINR(totals.grandTotal)}</span></div><div className="mt-2 flex justify-between"><span>Advance received</span><span>{formatINR(paid)}</span></div></div>
    {quote && <section className="space-y-3 rounded-lg border bg-card p-4"><h2 className="font-semibold">Quotation advances</h2>{quote.payments.map(p => <p key={p.receiptId} className="text-sm">{p.receiptNo} · {formatDate(p.date)} · {formatINR(p.amount)}</p>)}{!paid && <p className="text-sm text-muted-foreground">No advance recorded. Payment is optional before conversion.</p>}
      {quote.status === "accepted" && can(session.user.role, "recordReceipt") && <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={e => { e.preventDefault(); payment.mutate(); }}><label className="text-sm">Date<Input required type="date" min={quote.date} max={indiaItemDate()} value={paymentDate} onChange={e => setPaymentDate(e.target.value)} /></label><label className="text-sm">Amount<Input required type="number" min="0.01" max={Math.max(0, quote.grandTotal - paid)} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label><label className="text-sm">Mode<select className="h-10 w-full rounded border bg-background px-2" value={mode} onChange={e => setMode(e.target.value as PaymentMode)}>{["cash", "upi", "neft", "cheque"].map(m => <option key={m}>{m}</option>)}</select></label><label className="text-sm">Payment reference<Input required={mode !== "cash"} maxLength={200} value={reference} onChange={e => setReference(e.target.value)} /></label><Button type="submit" className="self-end" disabled={busy || expired || paid >= quote.grandTotal}>Record advance</Button></form>}
      <p className="text-xs text-muted-foreground">Only Owner, Manager or Accountant can record payments. Quote advances automatically apply to invoices for the converted order. Record subsequent payments in Receipts.</p>
    </section>}
    {quote && typeof document !== "undefined" && createPortal(<div id="quotation-print" style={{ display: "none" }}><style>{`@media print { body > * { display: none !important; } body > #quotation-print { display: block !important; color: #111; background: white; font: 12pt Arial, sans-serif; padding: 12mm; } #quotation-print table { width: 100%; border-collapse: collapse; } #quotation-print th, #quotation-print td { padding: 6px; border: 1px solid #bbb; text-align: left; } #quotation-print p { white-space: pre-wrap; } @page { size: A4; margin: 10mm; } }`}</style><h1>{org.name}</h1><p>{org.gstin && org.gstin !== "NA" ? `GSTIN: ${org.gstin}` : ""}</p><h2>Quotation {quote.number} {quote.status === "draft" ? "— DRAFT" : quote.status === "cancelled" ? "— CANCELLED" : ""}</h2><p>Customer: {quote.customerName}<br />Date: {formatDate(quote.date)}<br />Valid until: {formatDate(quote.validUntil)}<br />Warehouse: {warehouses.data?.find(g => g.id === quote.godownId)?.name ?? quote.godownId}</p><table><thead><tr><th>Item / HSN</th><th>Qty / Unit</th><th>Rate</th><th>Discount</th><th>GST</th><th>Taxable</th></tr></thead><tbody>{quote.lines.map(l => <tr key={l.id}><td>{l.itemName}<br />{l.hsn}</td><td>{l.qty} {l.uom}</td><td>{formatINR(l.rate)}</td><td>{l.discountPct}%</td><td>{l.gstRate}%</td><td>{formatINR(l.qty * l.rate * (1 - l.discountPct / 100))}</td></tr>)}</tbody></table><p>Taxable: {formatINR(printTotals.taxable)}<br />CGST: {formatINR(printTotals.cgst)} · SGST: {formatINR(printTotals.sgst)} · IGST: {formatINR(printTotals.igst)}<br />Round off: {formatINR(printTotals.roundOff)}</p><h3>Total: {formatINR(quote.grandTotal)}</h3><p>{quote.notes}</p><h3>Terms</h3><p>{quote.terms}</p><p>This quotation is not a tax invoice.</p></div>, document.body)}
  </div>;
}
