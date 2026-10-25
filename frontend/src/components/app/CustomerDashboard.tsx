import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatINR } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
export function CustomerDashboard({ id }: { id: string }) {
  const session = useSession()!, qc = useQueryClient();
  const query = useQuery({ queryKey: ["customer-crm", session.orgId, id], queryFn: () => api.customerDashboard(id) });
  const [prefs, setPrefs] = useState({ enabled: false, phone: "", evidence: "" });
  useEffect(() => { if (query.data) setPrefs(query.data.preferences); }, [query.data]);
  const save = useMutation({ mutationFn: () => api.saveCommunicationPreferences(id, prefs), onSuccess: () => { qc.invalidateQueries({ queryKey: ["customer-crm"] }); toast.success("Communication preferences saved"); }, onError: (e: Error) => toast.error(e.message) });
  if (query.isLoading) return <p>Loading customer history…</p>;
  if (query.error || !query.data) return <p role="alert">Unable to load customer history. <button onClick={() => query.refetch()}>Retry</button></p>;
  const d = query.data, active = d.invoices.filter(i => i.status !== "cancelled");
  return <section aria-label="Customer dashboard" className="my-6 space-y-4 rounded-lg border bg-card p-4">
    <h2 className="text-xl font-semibold">Customer dashboard</h2>
    <p className="text-sm">Customer ID: {d.customer.id} · {d.customer.name} · {d.customer.phone} · {d.customer.email || "No email"}</p>
    <p className="text-sm">{d.customer.address} {d.customer.city} {d.customer.pin} · GSTIN {d.customer.gstin || "Unregistered"}</p>
    <div className="grid gap-3 sm:grid-cols-3"><p>Invoiced: <strong>{formatINR(active.reduce((n, i) => n + i.grandTotal, 0))}</strong></p><p>Applied payments/advances: <strong>{formatINR(active.reduce((n, i) => n + i.paid + i.advances.reduce((a, b) => a + b.amount, 0), 0))}</strong></p><p>Outstanding: <strong>{formatINR(active.reduce((n, i) => n + i.balance, 0))}</strong></p></div>
    <h3 className="font-semibold">Purchase history</h3>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">Invoice / date</th><th className="p-2 text-left">Items</th><th className="p-2 text-left">Status / total</th></tr></thead><tbody>{d.invoices.map(i => <tr className="border-t" key={i.id}><td className="p-2"><Link className="text-primary underline" to="/invoices/$id" params={{ id: i.id }}>{i.number}</Link><br />{i.date}</td><td className="p-2">{i.lines.map(l => `${l.itemName}: ${l.qty} ${l.uom}`).join("; ")}</td><td className="p-2">{i.status}<br />{formatINR(i.grandTotal)}</td></tr>)}</tbody></table>{!d.invoices.length && <p>No invoices yet.</p>}</div>
    <details><summary className="cursor-pointer font-semibold">Quotations, orders, deliveries and receipts</summary><div className="space-y-2 pt-2 text-sm">{d.quotations.map(q => <p key={q.id}>Quotation {q.number} · {q.status} · {formatINR(q.grandTotal)}</p>)}{d.orders.map(o => <p key={o.id}>Order {o.number || "Draft"} · {o.status} · {formatINR(o.grandTotal)}</p>)}{d.deliveries.map(c => <p key={c.id}>Delivery {c.number} · {c.status}</p>)}{d.receipts.map(r => <p key={r.id}>Receipt {r.number} · {formatINR(r.amount)}</p>)}</div></details>
    <h3 className="font-semibold">WhatsApp permission</h3>
    {can(session.user.role, "approveQuotationRevision") ? <div className="space-y-2"><label className="flex items-center gap-2"><input type="checkbox" checked={prefs.enabled} onChange={e => setPrefs(p => ({ ...p, enabled: e.target.checked }))} />Customer has agreed to purchase and quotation updates</label><Input aria-label="WhatsApp recipient" placeholder="+919876543210" value={prefs.phone} onChange={e => setPrefs(p => ({ ...p, phone: e.target.value }))} /><Input aria-label="Consent evidence" placeholder="Source and date of permission, or reason for revocation" maxLength={500} value={prefs.evidence} onChange={e => setPrefs(p => ({ ...p, evidence: e.target.value }))} /><Button disabled={save.isPending || prefs.evidence.trim().length < 3} onClick={() => save.mutate()}>Save communication preferences</Button></div> : <p>{prefs.enabled ? "Enabled" : "Not enabled"}</p>}
    <h3 className="font-semibold">Communication history (latest 200)</h3>
    {d.messages.map(m => <p className="text-sm" key={`${m.documentType}:${m.documentId}:${m.version}`}>{m.documentType} {m.documentId} · v{m.version} · {m.status.replaceAll("_", " ")}{m.error ? ` · ${m.error.replaceAll("_", " ")}` : ""}</p>)}
  </section>;
}
