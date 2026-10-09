import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { PaymentMode, ReceiptInput } from "@/api/types";
import { formatDate, formatINR } from "@/lib/format";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { indiaItemDate } from "@/lib/item-detail-rules";
import { receiptAllocation, receiptProblems } from "@/lib/receipt-rules";
import { PageHeader, ErrorState, LoadingRows } from "@/components/app/states";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/receipts/new")({
  validateSearch: z.object({ customerId: z.string().optional() }),
  head: () => ({ meta: [
    { title: "Record receipt — Girder" },
    { name: "description", content: "Record customer payments, settle selected invoices and track unused advances." },
  ] }),
  component: NewReceipt,
});

function NewReceipt() {
  const search = Route.useSearch();
  const session = useSession();
  const orgId = session?.orgId ?? "";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState(search.customerId ?? "");
  const [date, setDate] = useState(indiaItemDate);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("neft");
  const [reference, setReference] = useState("");
  const [split, setSplit] = useState<Record<string, string>>({});
  const [manual, setManual] = useState(false);

  const cq = useQuery({ queryKey: ["parties", orgId, "customer"], queryFn: () => api.listParties("customer"), enabled: !!orgId });
  const eligible = !!customerId && cq.data?.some((p) => p.id === customerId);
  const iq = useQuery({ queryKey: ["open-invoices", orgId, customerId], queryFn: () => api.listOpenInvoices(customerId), enabled: !!orgId && !!eligible });
  const open = iq.data ?? [];
  const amt = amount.trim() === "" ? 0 : Number(amount);
  const auto = useMemo(() => receiptAllocation(open, amt), [open, amt]);
  const allocation = manual ? open.map((i) => ({ invoiceId: i.id, amount: split[i.id] === "" ? 0 : Number(split[i.id] ?? 0) })) : auto.allocations;
  const used = Math.round(allocation.reduce((sum, a) => sum + (Number.isFinite(a.amount) ? a.amount : 0), 0) * 100) / 100;
  const input: ReceiptInput = { customerId, date, amount: amt, mode, reference: reference.trim(), allocations: allocation };
  const problems = receiptProblems(input, open, indiaItemDate());
  if (!!customerId && !cq.isLoading && cq.data && !eligible) problems.unshift("Choose a customer in this organisation");
  const dirty = !!customerId || !!amount || !!reference || manual;

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const previousOrg = useRef(orgId);
  useEffect(() => {
    if (previousOrg.current && previousOrg.current !== orgId) {
      setCustomerId(""); setSplit({}); setManual(false);
    }
    previousOrg.current = orgId;
  }, [orgId]);
  const save = useMutation({
    mutationFn: () => api.recordReceipt(input),
    onSuccess: (r) => {
      void qc.invalidateQueries();
      toast.success(`${r.number} recorded${r.advance > 0 ? ` · ${formatINR(r.advance, 0)} kept as advance` : ""}`);
      navigate({ to: "/receipts" });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const goBack = () => {
    if (!dirty || window.confirm("Discard unsaved receipt details?")) navigate({ to: "/receipts" });
  };
  const ready = !!orgId && can(session?.user.role, "recordReceipt") && !!eligible && !cq.isLoading && !iq.isLoading && !iq.isFetching && !cq.error && !iq.error && problems.length === 0;

  return (
    <div className="max-w-4xl">
      <PageHeader title="Record receipt" eyebrow="Sales" />
      <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <Field label="Customer">
          <NativeSelect value={customerId} onChange={(e) => { setCustomerId(e.target.value); setSplit({}); setManual(false); }} disabled={cq.isLoading || save.isPending}>
            <option value="">Choose customer…</option>
            {cq.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Date"><Input type="date" value={date} max={indiaItemDate()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Amount received (₹)"><Input aria-label="Amount received" className="num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" /></Field>
        <Field label="Mode">
          <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
            <option value="neft">NEFT / RTGS</option><option value="upi">UPI</option><option value="cheque">Cheque</option><option value="cash">Cash</option>
          </NativeSelect>
        </Field>
        <Field label="Reference" className="sm:col-span-2" hint={mode === "cash" ? "Optional for cash" : "UTR, cheque number or UPI ID"}>
          <Input aria-label="Reference" maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      {cq.error && <div className="mt-4"><ErrorState error={cq.error} onRetry={() => void cq.refetch()} /></div>}
      {customerId && eligible && (
        <div className="mt-4 overflow-x-auto rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="eyebrow">Settle invoices</span>
            {manual
              ? <Button size="sm" variant="ghost" onClick={() => { setManual(false); setSplit({}); }}>Reset to oldest first</Button>
              : <span className="text-xs text-muted-foreground">Oldest first · edit any amount to split manually</span>}
          </div>
          {iq.isLoading ? <LoadingRows /> : iq.error ? <ErrorState error={iq.error} onRetry={() => void iq.refetch()} /> : !open.length ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">No unpaid invoices — the whole amount will be kept as an advance.</p>
          ) : <table className="w-full text-sm"><tbody>{open.map((i) => (
            <tr key={i.id} className="border-t first:border-0">
              <td className="num px-4 py-2.5 font-medium">{i.number}</td>
              <td className="num px-4 py-2.5">{formatDate(i.date)}</td>
              <td className="px-4 py-2.5"><StatusBadge status={i.status} /></td>
              <td className="num px-4 py-2.5 text-right text-muted-foreground">Balance {formatINR(i.balance, 2)}</td>
              <td className="w-40 px-4 py-2"><Input className="num text-right" value={manual ? (split[i.id] ?? "") : String(auto.allocations.find((a) => a.invoiceId === i.id)?.amount ?? "")}
                aria-label={`Amount for ${i.number}`} inputMode="decimal" onChange={(e) => {
                  setManual(true);
                  setSplit((prev) => ({ ...(!manual ? Object.fromEntries(open.map((r) => [r.id, String(auto.allocations.find((a) => a.invoiceId === r.id)?.amount ?? "")])) : prev), [i.id]: e.target.value.replace(/[^\d.]/g, "") }));
                }} />
              </td>
            </tr>
          ))}</tbody></table>}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-6 text-sm">
        <span>Against invoices <span className="num font-medium">{formatINR(used, 2)}</span></span>
        <span>Kept as advance <span className="num font-medium">{formatINR(Math.max(0, Math.round((amt - used) * 100) / 100), 2)}</span></span>
        {problems.length > 0 && <span role="alert" className="text-destructive">{problems[0]}</span>}
        <Button variant="outline" onClick={goBack}>Cancel</Button>
        <Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Record receipt"}</Button>
      </div>
    </div>
  );
}
