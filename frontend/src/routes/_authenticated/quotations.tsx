import { DocumentDistribution } from "@/components/app/DocumentDistribution";
import { SearchHighlight } from "@/components/app/SearchHighlight";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Printer, Save, ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Item, Party, Quotation, QuotationInput, QuotationDraft, PaymentMode } from "@/api/types";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { computeTotals, supplyType } from "@/lib/gst";
import { quotationProblems, quotationFreeStock } from "@/lib/quotation-rules";
import { useQuotationAutosave } from "@/lib/use-quotation-autosave";
import { indiaItemDate } from "@/lib/item-detail-rules";
import { formatINR, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuickCustomer, QuickItem } from "@/components/app/QuotationQuickCreate";
import { SearchableSelect } from "@/components/app/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, LoadingRows } from "@/components/app/states";

export const Route = createFileRoute("/_authenticated/quotations")({
  head: () => ({ meta: [{ title: "Quotations — Girder" }] }),
  component: QuotationsPage,
});
export function QuotationsPage() {
  const session = useSession()!;
  const [selected, setSelected] = useState<string | null>(null);
  const [printId, setPrintId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const quotes = useQuery({ queryKey: ["quotations", session.orgId], queryFn: api.listQuotations });
  useEffect(() => { setSelected(null); }, [session.orgId]);
  if (selected) return <QuotationEditor key={`${session.orgId}:${selected}`} id={selected} onBack={() => setSelected(null)} onSaved={(id, print = false) => { setPrintId(print ? id : null); setSelected(id); }} printRequested={printId === selected} onPrinted={() => setPrintId(null)} />;
  if (quotes.isLoading) return <LoadingRows rows={6} />;
  if (quotes.error) return <ErrorState error={quotes.error} onRetry={() => quotes.refetch()} />;
  const rows = (quotes.data ?? []).filter(q => `${q.number} ${q.customerName} ${q.status}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="eyebrow">Sales</div><h1 className="text-2xl font-semibold">Quotations</h1><p className="text-sm text-muted-foreground">Save and print prices, then convert directly to a Sales Order when the customer agrees. New quotation resumes your unfinished draft.</p></div>{can(session.user.role, "salesOrders") && <Button onClick={() => setSelected("new")}><Plus /> New quotation</Button>}</div>
    <Input aria-label="Search quotations" placeholder="Search number, customer or status" value={search} onChange={e => setSearch(e.target.value)} className="max-w-md" />
    {!rows.length ? <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground"><FileText className="mx-auto mb-3 size-8" />No quotations yet.</div> : <div className="overflow-x-auto rounded-lg border bg-card"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">Quotation</th><th className="p-3">Customer</th><th className="p-3">Valid until</th><th className="p-3">Status</th><th className="p-3 text-right">Total</th></tr></thead><tbody>{rows.map(q => <tr key={q.id} className="border-b last:border-0"><td className="p-3"><button className="min-h-11 text-primary underline" onClick={() => setSelected(q.id)}><SearchHighlight text={q.number ?? ""} query={search}/></button></td><td className="p-3"><SearchHighlight text={q.customerName ?? ""} query={search}/></td><td className="whitespace-nowrap p-3">{formatDate(q.validUntil)}</td><td className="p-3 capitalize">{q.status}{q.validUntil < indiaItemDate() && ["draft", "issued", "accepted"].includes(q.status) ? " · expired" : ""}</td><td className="whitespace-nowrap p-3 text-right num">{formatINR(q.grandTotal)}</td></tr>)}</tbody></table></div>}
  </div>;
}
function QuotationEditor({ id, onBack, onSaved, printRequested, onPrinted }: { id: string; onBack: () => void; onSaved: (id: string, print?: boolean) => void; printRequested: boolean; onPrinted: () => void }) {
  const session = useSession()!;
  const query = useQuery({ queryKey: ["quotation", session.orgId, id], queryFn: () => api.getQuotation(id), enabled: id !== "new" });
  const canEdit = can(session.user.role, "salesOrders");
  const draft = useQuery({ queryKey: ["quotation-draft", session.orgId, session.user.id, id], queryFn: () => api.getQuotationDraft(id), enabled: canEdit, staleTime: 0, refetchOnWindowFocus: false, refetchOnMount: "always" });
  if (canEdit && (draft.isLoading || draft.isFetching)) return <LoadingRows rows={8} />;
  if (draft.error && canEdit) return <ErrorState error={draft.error} onRetry={() => draft.refetch()} />;
  if (id !== "new" && query.isLoading) return <LoadingRows rows={8} />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (id !== "new" && !query.data) return null;
  return <QuoteForm key={query.data ? `${query.data.id}:${query.data.status}:${query.data.payments.length}` : "new"} quote={query.data} draft={draft.data ?? { version: 0, input: null }} printRequested={printRequested} onPrinted={onPrinted} onBack={onBack} onSaved={onSaved} />;
}
const blankLine = () => ({ itemId: "", itemName: "", hsn: "", uom: "", qty: 1, rate: 0, discountPct: 0, gstRate: 0 });
function QuoteForm({ quote, draft, printRequested, onPrinted, onBack, onSaved }: { quote: Quotation | undefined; draft: QuotationDraft; printRequested: boolean; onPrinted: () => void; onBack: () => void; onSaved: (id: string, print?: boolean) => void }) {
  const session = useSession()!;
  const org = session.orgs.find(o => o.id === session.orgId)!;
  const freeStock = (stock: Item["stock"] = []) => quotationFreeStock(stock.filter(s => s.godownId === session.godownId));
  const qc = useQueryClient(), navigate = useNavigate();
  const customers = useQuery({ queryKey: ["parties", session.orgId, "customer"], queryFn: () => api.listParties("customer") });
  const warehouses = useQuery({ queryKey: ["godowns", session.orgId], queryFn: () => api.listGodowns(session.orgId!), enabled: !!quote && ["draft", "issued", "accepted"].includes(quote.status) && can(session.user.role, "salesOrders") });
  const [createCustomer, setCreateCustomer] = useState(false);
  const [createItem, setCreateItem] = useState<number | null>(null);
  const defaults = useQuery({ queryKey: ["quotation-defaults", session.orgId], queryFn: api.getQuotationDefaults, enabled: !quote && !draft.input });
  const touched = useRef({ terms: false, notes: false, applied: false });
  const items = useQuery({ queryKey: ["items", session.orgId, "quotation"], queryFn: () => api.listItems() });
  const original = () => ({ ...(quote ? { id: quote.id } : {}), customerId: quote?.customerId ?? "", godownId: quote?.godownId ?? "", date: quote?.date ?? indiaItemDate(), validUntil: quote?.validUntil ?? indiaItemDate(), terms: quote?.terms ?? "", notes: quote?.notes ?? "", lines: quote?.lines.map(({ id: _id, deliveredQty: _delivered, ...l }) => l) ?? [blankLine()] });
  const [input, setInput] = useState<QuotationInput>(() => (!quote || quote.status === "draft") && draft.input ? draft.input : original());
  const clean = useRef(JSON.stringify(original()));
  useEffect(() => {
    if (quote || draft.input || !defaults.data || touched.current.applied) return;
    touched.current.applied = true;
    setInput(previous => {
      const next = { ...previous, ...(!touched.current.terms ? { terms: defaults.data!.terms } : {}), ...(!touched.current.notes ? { notes: defaults.data!.notes } : {}) };
      if (clean.current === JSON.stringify(previous)) clean.current = JSON.stringify(next);
      return next;
    });
  }, [defaults.data, quote, draft.input]);
  const editable = can(session.user.role, "salesOrders") && (!quote || quote.status === "draft");
  const dirty = editable && clean.current !== JSON.stringify(input);
  const customer = customers.data?.find(c => c.id === input.customerId);
  const taxSupply = quote && quote.status !== "draft" ? quote.supply : supplyType(org.stateCode, customer?.stateCode ?? org.stateCode);
  const totals = computeTotals(input.lines.filter(l => l.itemId), taxSupply);
  const [dispatchWarehouse, setDispatchWarehouse] = useState(quote?.godownId ?? (session.godownId !== "all" ? session.godownId : ""));
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(indiaItemDate());
  const paymentKey = useRef<string | null>(null);
  const paymentBody = useRef<string | null>(null);
  const changed = (q: Quotation, print = false) => {
    qc.setQueryData(["quotation", session.orgId, q.id], q);
    qc.invalidateQueries({ queryKey: ["quotations"] });
    qc.invalidateQueries({ queryKey: ["quotation-draft", session.orgId, session.user.id], refetchType: "none" });
    onSaved(q.id, print);
  };
  const [saving, setSaving] = useState(false);
  const save = useMutation({ mutationFn: async (print: boolean) => {
    setSaving(true);
    try {
      const snapshot = input;
      const version = await autosave.wait();
      const q = await api.saveQuotation(snapshot, version);
      autosave.markSaved(snapshot);
      return { q, snapshot, print };
    } finally { setSaving(false); }
  }, onSuccess: ({ q, snapshot, print }) => { clean.current = JSON.stringify(snapshot); toast.success("Quotation saved"); changed(q, print); }, onError: (e: Error) => toast.error(e.message) });
  const action = useMutation({ mutationFn: (a: "issue" | "accept" | "cancel") => api.quotationAction(quote!.id, a), onSuccess: q => { toast.success(`Quotation ${q.status}`); changed(q); }, onError: (e: Error) => toast.error(e.message) });
  const convert = useMutation({ mutationFn: () => api.convertQuotation(quote!.id, dispatchWarehouse), onSuccess: o => { qc.invalidateQueries({ queryKey: ["quotations"] }); qc.invalidateQueries({ queryKey: ["sales-orders"] }); toast.success("Draft Sales Order created; confirm it to reserve stock"); navigate({ to: "/sales-orders/$id", params: { id: o.id } }); }, onError: (e: Error) => toast.error(e.message) });
  const payment = useMutation({ mutationFn: () => {
    const body = { quotationId: quote!.id, customerId: quote!.customerId, date: paymentDate, amount: Number(amount), mode, reference, allocations: [] };
    const fingerprint = JSON.stringify(body);
    if (paymentBody.current && paymentBody.current !== fingerprint) throw new Error("Retry the same payment details first. Its previous result may still need reconciliation.");
    paymentBody.current = fingerprint; paymentKey.current ??= crypto.randomUUID();
    return api.recordReceipt({ ...body, requestKey: paymentKey.current });
  }, onSuccess: rc => { toast.success(`Advance recorded: ${rc.number}`); paymentKey.current = null; paymentBody.current = null; setAmount(""); setReference(""); qc.invalidateQueries({ queryKey: ["quotation", session.orgId, quote!.id] }); qc.invalidateQueries({ queryKey: ["quotations"] }); qc.invalidateQueries({ queryKey: ["receipts"] }); qc.invalidateQueries({ queryKey: ["advances"] }); }, onError: (e: Error) => { if ('status' in e && Number(e.status) < 500) { paymentKey.current = null; paymentBody.current = null; } toast.error(e.message); } });
  const busy = saving || save.isPending || action.isPending || convert.isPending || payment.isPending;
  const autosave = useQuotationAutosave(quote?.id ?? "new", input, draft, editable && !busy && !defaults.isFetching);
  const unsafeToLeave = editable && (autosave.pending || autosave.saving);
  useEffect(() => {
    if (!unsafeToLeave) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [unsafeToLeave]);
  useEffect(() => {
    if (!printRequested || !quote) return;
    const timer = window.setTimeout(() => { window.print(); onPrinted(); }, 0);
    return () => window.clearTimeout(timer);
  }, [printRequested, quote, onPrinted]);
  const expired = !!quote && quote.validUntil < indiaItemDate();
  const set = (patch: Partial<QuotationInput>) => setInput(i => ({ ...i, ...patch }));
  const updateLine = (index: number, patch: Partial<QuotationInput["lines"][number]>) => setInput(i => ({ ...i, lines: i.lines.map((l, j) => j === index ? { ...l, ...patch } : l) }));
  const printTotals = quote ? computeTotals(quote.lines, quote.supply) : totals;
  const paid = quote?.payments.reduce((n, p) => n + p.amount, 0) ?? 0;
  return <div className="space-y-5">
    <Button variant="ghost" onClick={() => { if (!unsafeToLeave || window.confirm("Recent changes have not autosaved yet. Leave without those changes?")) onBack(); }}><ArrowLeft /> Quotations</Button>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">{quote?.number ?? "New quotation"}</h1><p className="text-sm capitalize text-muted-foreground">{quote?.status ?? "draft"}{expired ? " · expired" : ""}</p></div><div className="flex flex-wrap gap-2">
      {editable && <Button disabled={busy || (!quote && defaults.isFetching)} onClick={() => { const p = quotationProblems(input, indiaItemDate()); if (p.length) toast.error(p[0]!); else save.mutate(false); }}><Save /> Save quotation</Button>}
      {editable && <Button variant="outline" disabled={busy || (!quote && defaults.isFetching)} onClick={() => { const p = quotationProblems(input, indiaItemDate()); if (p.length) toast.error(p[0]!); else save.mutate(true); }}><Printer /> Save &amp; print quotation</Button>}
      {can(session.user.role, "salesOrders") && quote && ["draft", "issued", "accepted"].includes(quote.status) && <Button disabled={busy || dirty || expired || !dispatchWarehouse || autosave.saving} onClick={() => { if (window.confirm("Customer accepted this quotation? Create a Sales Order now?")) convert.mutate(); }}>Convert to Sales Order</Button>}
      {quote?.salesOrderId && can(session.user.role, "salesOrders") && <Button asChild variant="outline"><Link to="/sales-orders/$id" params={{ id: quote.salesOrderId }}>Open Sales Order</Link></Button>}
      {quote && <Button variant="outline" disabled={dirty || busy} onClick={() => window.print()}><Printer /> Print / Save PDF</Button>}
      {can(session.user.role, "salesOrders") && quote && ["draft", "issued", "accepted"].includes(quote.status) && !paid && <Button variant="outline" disabled={busy} onClick={() => { if (window.confirm("Cancel this quotation?")) action.mutate("cancel"); }}>Cancel</Button>}
    </div></div>
    {quote && <DocumentDistribution type="quotation" id={quote.id} />}
    {quote && ["draft", "issued", "accepted"].includes(quote.status) && can(session.user.role, "salesOrders") && <section className="rounded-lg border bg-card p-4"><h2 className="font-semibold">Sales Order dispatch</h2><p className="text-sm text-muted-foreground">Choose the dispatch warehouse when converting this quotation.</p><select aria-label="Sales Order dispatch warehouse" className="mt-2 min-h-11 w-full rounded border bg-background px-2 sm:max-w-sm" value={dispatchWarehouse} disabled={busy} onChange={e => setDispatchWarehouse(e.target.value)}><option value="">Choose dispatch warehouse</option>{warehouses.data?.filter(g => g.active).map(g => <option key={g.id} value={g.id}>{g.name} ({g.code})</option>)}</select></section>}
    {editable && <div className="text-sm" aria-live="polite"><span>{autosave.error ? `Autosave failed: ${autosave.error.message}` : autosave.saving ? "Saving draft to database…" : autosave.pending ? "Unsaved changes · autosave shortly" : autosave.hasSaved ? "Draft autosaved to database · use Save draft to validate and enable printing/conversion" : "Changes autosave after 1.5 seconds"}</span>{autosave.error && <Button variant="outline" size="sm" onClick={autosave.retry}>Retry autosave</Button>}{draft.input && <p>Recovered your unfinished quotation.</p>}</div>}
    <p className="text-sm text-muted-foreground">GST is calculated from item master rates after discount. Place of supply: {customer?.stateName ?? quote?.placeOfSupplyName ?? customer?.stateCode ?? "Select customer"}. Stock shown is free stock in the warehouse selected in the top bar; availability does not reserve stock.</p>
    <p className="rounded-lg border bg-muted/40 p-3 text-sm">Quotations do not reserve or reduce stock. When the customer agrees, convert the saved quotation directly to a Sales Order. Confirmation of the resulting Sales Order reserves stock.</p>
    <fieldset disabled={!editable || busy} className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
      <div className="space-y-1 text-sm">Customer{editable && can(session.user.role, "editParties") && <Button type="button" variant="ghost" size="icon" aria-label="Create customer" disabled={busy} onClick={() => setCreateCustomer(true)}><Plus/></Button>}<SearchableSelect label="Quotation customer" searchLabel="Search customers" placeholder="Choose customer" value={input.customerId} disabled={!editable || busy} options={(customers.data ?? []).map(c => ({ value: c.id, label: c.name, search: `${c.name} ${c.phone ?? ""} ${c.gstin ?? ""}`, disabled: !!c.blocked }))} onChange={customerId => set({ customerId })} /></div>
      <label className="space-y-1 text-sm">Quotation date<Input type="date" value={input.date} onChange={e => set({ date: e.target.value })} /></label>
      <label className="space-y-1 text-sm">Valid until<Input type="date" min={input.date} value={input.validUntil} onChange={e => set({ validUntil: e.target.value })} /></label>
    </fieldset>
    {createCustomer && <QuickCustomer stateCode={org.stateCode} onClose={() => setCreateCustomer(false)} onCreated={(party: Party) => {
      qc.setQueryData(["parties", session.orgId, "customer"], (rows: Party[] = []) => [...rows.filter(p => p.id !== party.id), party]);
      qc.invalidateQueries({ queryKey: ["parties", session.orgId], predicate: q => q.queryKey[2] !== "customer" }); set({ customerId: party.id }); setCreateCustomer(false);
    }} />}
    {createItem !== null && <QuickItem onClose={() => setCreateItem(null)} onCreated={(item: Item) => {
      qc.setQueryData(["items", session.orgId, "quotation"], (rows: Item[] = []) => [...rows.filter(i => i.id !== item.id), item]);
      qc.invalidateQueries({ queryKey: ["items", session.orgId], predicate: q => q.queryKey[2] !== "quotation" });
      updateLine(createItem, { itemId: item.id, itemName: item.name, hsn: item.hsn, uom: item.baseUom, rate: item.salePrice, gstRate: item.gstRate }); setCreateItem(null);
    }} />}
    {[defaults.error, customers.error, warehouses.error, items.error].filter(Boolean).map((e, index) => <ErrorState key={index} error={e} onRetry={() => { customers.refetch(); warehouses.refetch(); items.refetch(); if (!quote) defaults.refetch(); }} />)}
    <fieldset disabled={!editable || busy} className="space-y-3">
      {input.lines.map((l, index) => <div key={index} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6"><div className="text-sm lg:col-span-2">Item{editable && can(session.user.role, "editMasters") && <Button type="button" variant="ghost" size="icon" aria-label={`Create item ${index + 1}`} disabled={busy} onClick={() => setCreateItem(index)}><Plus/></Button>}<SearchableSelect label={`Item ${index + 1}`} searchLabel={`Search items ${index + 1}`} placeholder="Choose item" value={l.itemId} disabled={!editable || busy} options={(items.data ?? []).filter(it => it.active).map(it => ({ value: it.id, label: `${it.name} · ${it.sku} · ${session.godownId === "all" ? "Select warehouse to view stock" : freeStock(it.stock) > 0 ? `Available ${freeStock(it.stock)} ${it.baseUom}` : "Out of stock"}`, search: `${it.name} ${it.sku} ${it.hsn}` }))} onChange={itemId => { const it = items.data?.find(it => it.id === itemId); updateLine(index, it ? { itemId: it.id, itemName: it.name, hsn: it.hsn, uom: it.baseUom, rate: it.salePrice, gstRate: it.gstRate } : blankLine()); }} /><span className="text-xs text-muted-foreground">HSN {l.hsn || "—"} · GST {l.gstRate}% · {l.uom}</span>{l.itemId && items.data && <p className={session.godownId === "all" || freeStock(items.data.find(it => it.id === l.itemId)?.stock) > 0 ? "text-xs text-muted-foreground" : "text-xs font-medium text-destructive"}>{session.godownId === "all" ? "Select warehouse in the top bar to view stock" : freeStock(items.data.find(it => it.id === l.itemId)?.stock) > 0 ? `Available: ${freeStock(items.data.find(it => it.id === l.itemId)?.stock)} ${l.uom}` : "Out of stock"}</p>}</div><label className="text-sm">Quantity<Input type="number" min="0.001" step="0.001" value={l.qty} onChange={e => updateLine(index, { qty: Number(e.target.value) })} /></label><label className="text-sm">Rate<Input type="number" min="0" step="0.01" value={l.rate} onChange={e => updateLine(index, { rate: Number(e.target.value) })} /></label><label className="text-sm">Discount %<Input type="number" min="0" max="100" step="0.01" value={l.discountPct} onChange={e => updateLine(index, { discountPct: Number(e.target.value) })} /></label><div className="flex items-center justify-between gap-2"><span className="text-sm">{formatINR(computeTotals([l], taxSupply).grandTotal)}</span>{editable && <Button aria-label={`Remove item ${index + 1}`} variant="ghost" size="icon" onClick={() => set({ lines: input.lines.filter((_, j) => j !== index) })}><Trash2 /></Button>}</div></div>)}
      {editable && <Button variant="outline" disabled={input.lines.length >= 200} onClick={() => set({ lines: [...input.lines, blankLine()] })}><Plus /> Add item</Button>}
      <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1 text-sm">Notes<Textarea value={input.notes} maxLength={2000} onChange={e => { touched.current.notes = true; set({ notes: e.target.value }); }} /></label><label className="space-y-1 text-sm">Terms and conditions<Textarea value={input.terms} maxLength={2000} onChange={e => { touched.current.terms = true; set({ terms: e.target.value }); }} /></label></div>
    </fieldset>
    <div className="ml-auto max-w-sm rounded-lg border bg-card p-4 text-sm"><div className="flex justify-between"><span>Taxable</span><span>{formatINR(totals.taxable)}</span></div><div className="flex justify-between"><span>CGST</span><span>{formatINR(totals.cgst)}</span></div><div className="flex justify-between"><span>SGST</span><span>{formatINR(totals.sgst)}</span></div><div className="flex justify-between"><span>IGST</span><span>{formatINR(totals.igst)}</span></div><div className="flex justify-between"><span>Round off</span><span>{formatINR(totals.roundOff)}</span></div><div className="mt-2 flex justify-between border-t pt-2 text-lg font-semibold"><span>Total</span><span>{formatINR(totals.grandTotal)}</span></div><div className="mt-2 flex justify-between"><span>Advance received</span><span>{formatINR(paid)}</span></div></div>
    {quote && <section className="space-y-3 rounded-lg border bg-card p-4"><h2 className="font-semibold">Quotation advances</h2>{quote.payments.map(p => <p key={p.receiptId} className="text-sm">{p.receiptNo} · {formatDate(p.date)} · {formatINR(p.amount)}</p>)}{!paid && <p className="text-sm text-muted-foreground">No advance recorded. Payment is optional before conversion.</p>}
      {quote.status === "accepted" && can(session.user.role, "recordReceipt") && <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={e => { e.preventDefault(); payment.mutate(); }}><label className="text-sm">Date<Input required type="date" min={quote.date} max={indiaItemDate()} value={paymentDate} onChange={e => setPaymentDate(e.target.value)} /></label><label className="text-sm">Amount<Input required type="number" min="0.01" max={Math.max(0, quote.grandTotal - paid)} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label><label className="text-sm">Mode<select className="h-10 w-full rounded border bg-background px-2" value={mode} onChange={e => setMode(e.target.value as PaymentMode)}>{["cash", "upi", "neft", "cheque"].map(m => <option key={m}>{m}</option>)}</select></label><label className="text-sm">Payment reference<Input required={mode !== "cash"} maxLength={200} value={reference} onChange={e => setReference(e.target.value)} /></label><Button type="submit" className="self-end" disabled={busy || expired || paid >= quote.grandTotal}>Record advance</Button></form>}
      <p className="text-xs text-muted-foreground">Only Owner, Manager or Accountant can record payments. Quote advances automatically apply to invoices for the converted order. Record subsequent payments in Receipts.</p>
    </section>}
    {quote && typeof document !== "undefined" && createPortal(<div id="quotation-print" style={{ display: "none" }}><style>{`@media print { body > * { display: none !important; } body > #quotation-print { display: block !important; color: #111; background: white; font: 12pt Arial, sans-serif; padding: 12mm; } #quotation-print table { width: 100%; border-collapse: collapse; } #quotation-print th, #quotation-print td { padding: 6px; border: 1px solid #bbb; text-align: left; } #quotation-print p { white-space: pre-wrap; } @page { size: A4; margin: 10mm; } }`}</style><h1>{org.name}</h1><p>{org.gstin && org.gstin !== "NA" ? `GSTIN: ${org.gstin}` : ""}</p><h2>Quotation {quote.number} {quote.status === "cancelled" ? "— CANCELLED" : ""}</h2><p>Customer: {quote.customerName}<br />Date: {formatDate(quote.date)}<br />Valid until: {formatDate(quote.validUntil)}</p><table><thead><tr><th>Item / HSN</th><th>Qty / Unit</th><th>Rate</th><th>Discount</th><th>GST</th><th>Taxable</th></tr></thead><tbody>{quote.lines.map(l => <tr key={l.id}><td>{l.itemName}<br />{l.hsn}</td><td>{l.qty} {l.uom}</td><td>{formatINR(l.rate)}</td><td>{l.discountPct}%</td><td>{l.gstRate}%</td><td>{formatINR(l.qty * l.rate * (1 - l.discountPct / 100))}</td></tr>)}</tbody></table><p>Taxable: {formatINR(printTotals.taxable)}<br />CGST: {formatINR(printTotals.cgst)} · SGST: {formatINR(printTotals.sgst)} · IGST: {formatINR(printTotals.igst)}<br />Round off: {formatINR(printTotals.roundOff)}</p><h3>Total: {formatINR(quote.grandTotal)}</h3><p>{quote.notes}</p><h3>Terms</h3><p>{quote.terms}</p><p>This quotation is not a tax invoice.</p></div>, document.body)}
  </div>;
}
