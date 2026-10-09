import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { z } from "zod";
import { api } from "@/api/client";
import type { Gstr1 } from "@/api/types";
import { formatDate, formatINR } from "@/lib/format";
import { gstr1Csv, gstr1Json, toCsv, validReportMonth } from "@/lib/reports";
import { useSession } from "@/lib/session";
import { download } from "@/lib/download";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { Chips } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const TABS = [
  { value: "gstr1", label: "GSTR-1" },
  { value: "sales", label: "Sales register" },
  { value: "receivables", label: "Receivables ageing" },
  { value: "items", label: "Item-wise sales & margin" },
] as const;

export const Route = createFileRoute("/_authenticated/reports")({
  validateSearch: z.object({
    tab: z.enum(["gstr1", "sales", "receivables", "items"]).optional(),
    period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  }),
  head: () => ({
    meta: [
      { title: "Reports & GSTR-1 — Girder" },
      { name: "description", content: "GSTR-1 with JSON and CSV export, sales register, receivables ageing and item-wise margin." },
      { property: "og:title", content: "Reports & GSTR-1 — Girder" },
      { property: "og:description", content: "GSTR-1 with JSON and CSV export, sales register, receivables ageing and item-wise margin." },
    ],
  }),
  component: Reports,
});

const monthRange = (p: string) => {
  const [y, m] = p.split("-").map(Number) as [number, number];
  return { from: `${p}-01`, to: `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` };
};

function Reports() {
  const { tab = "gstr1", period: selectedMonth } = Route.useSearch();
  const period = selectedMonth ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
  const validMonth = validReportMonth(period);
  const navigate = useNavigate({ from: "/reports" });
  return (
    <div>
      <PageHeader title="Reports & GSTR-1" eyebrow="Operations" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Chips value={tab} onChange={(v) => navigate({ search: (p) => ({ ...p, tab: v }) })} options={[...TABS]} />
        {tab !== "receivables" && (
          <label className="ml-auto flex items-center gap-2 text-sm">Month <Input type="month" min="2000-01" max="2100-12" className="h-8 w-40" value={period} onChange={(e) => e.target.value && navigate({ search: (p) => ({ ...p, period: e.target.value }) })} /></label>
        )}
      </div>
      {tab !== "receivables" && !validMonth ? <p role="alert" className="text-sm text-destructive">Select a valid reporting month.</p> : tab === "gstr1" ? <Gstr1View period={period} /> : tab === "sales" ? <SalesView period={period} /> : tab === "receivables" ? <ReceivablesView /> : <ItemsView period={period} />}
    </div>
  );
}

function Table({ heads, rows, right = [] }: { heads: string[]; rows: (string | number)[][]; right?: number[] }) {
  const [requestedPage, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const page = Math.min(requestedPage, pages);
  if (!rows.length) return <EmptyState title="Nothing in this period" />;
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/60"><tr className="eyebrow">{heads.map((h, i) => <th key={h} className={`px-4 py-2.5 font-semibold ${right.includes(i) ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.slice((page - 1) * 25, page * 25).map((r, n) => <tr key={n} className="border-t">{r.map((c, i) => <td key={i} className={`num whitespace-nowrap px-4 py-2 ${right.includes(i) ? "text-right" : ""}`}>{c}</td>)}</tr>)}</tbody>
      </table>
      {rows.length > 25 && <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground"><span>{rows.length} rows · Page {page} of {pages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page === pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>}
    </div>
  );
}

const inr = (n: number) => formatINR(n, 2);

function Gstr1View({ period }: { period: string }) {
  const orgId = useSession()?.orgId;
  const q = useQuery({ queryKey: ["gstr1", orgId, period], queryFn: () => api.getGstr1(period), enabled: !!orgId });
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const g = q.data as Gstr1;
  const csv = () => download(`GSTR1_REVIEW_${g.gstin}_${period}.csv`, gstr1Csv(g));
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-5">
        {[["Invoices", String(g.totals.invoices)], ["Taxable", inr(g.totals.taxable)], ["IGST", inr(g.totals.igst)], ["CGST", inr(g.totals.cgst)], ["SGST", inr(g.totals.sgst)]].map(([l, v]) => (
          <div key={l} className="rounded-lg border bg-card p-3"><p className="eyebrow">{l}</p><p className="num text-lg font-semibold">{v}</p></div>
        ))}
      </div>
      <p role="note" className="text-sm text-muted-foreground">Review draft only — this export is not a GST Portal upload file. Reconcile figures, HSN details, credit/debit notes and other mandatory GST tables with your accountant before preparing the return in the official GST Offline Tool.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => download(`GSTR1_REVIEW_${g.gstin}_${period}.json`, JSON.stringify(gstr1Json(g), null, 2), "application/json")}><Download /> Download review JSON</Button>
        <Button variant="outline" onClick={csv}><Download /> Export CSV</Button>
      </div>
      <Section title="B2B — registered customers">
        <Table heads={["GSTIN", "Customer", "Invoice", "Date", "Place of supply", "Rate", "Taxable", "IGST", "CGST", "SGST"]} right={[5, 6, 7, 8, 9]}
          rows={g.b2b.map((r) => [r.gstin, r.name, r.invoiceNo, formatDate(r.date), r.pos, `${r.rate}%`, inr(r.taxable), inr(r.igst), inr(r.cgst), inr(r.sgst)])} />
      </Section>
      <Section title={`B2CL — unregistered interstate invoices above ${period >= "2024-08" ? "₹1,00,000" : "₹2,50,000"}`}>
        <Table heads={["Invoice", "Date", "Place of supply", "Rate", "Taxable", "IGST"]} right={[3, 4, 5]} rows={g.b2cl.map((r) => [r.invoiceNo, formatDate(r.date), r.pos, `${r.rate}%`, inr(r.taxable), inr(r.igst)])} />
      </Section>
      <Section title="B2CS — other unregistered sales">
        <Table heads={["Place of supply", "Type", "Rate", "Taxable", "IGST", "CGST", "SGST"]} right={[2, 3, 4, 5, 6]} rows={g.b2cs.map((r) => [r.pos, r.supply === "intra" ? "Intra-state" : "Inter-state", `${r.rate}%`, inr(r.taxable), inr(r.igst), inr(r.cgst), inr(r.sgst)])} />
      </Section>
      {(["b2b", "b2c"] as const).map((recipient) => (
        <Section key={recipient} title={`HSN summary — ${recipient.toUpperCase()}`}>
          <Table heads={["HSN", "Unit", "Qty", "Rate", "Taxable", "IGST", "CGST", "SGST"]} right={[2, 3, 4, 5, 6, 7]} rows={g.hsn.filter((r) => r.recipient === recipient).map((r) => [r.hsn, r.uom, r.qty, `${r.rate}%`, inr(r.taxable), inr(r.igst), inr(r.cgst), inr(r.sgst)])} />
        </Section>
      ))}
      <Section title="Documents issued">
        <Table heads={["Nature", "From", "To", "Total", "Cancelled"]} right={[3, 4]} rows={g.docs.map((d) => [d.nature, d.from, d.to, d.total, d.cancelled])} />
      </Section>
      <p className="text-xs text-muted-foreground">Credit notes (CDNR) appear here once sales returns are built.</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h2 className="mb-2 text-sm font-semibold">{title}</h2>{children}</section>;
}

function SalesView({ period }: { period: string }) {
  const { from, to } = monthRange(period);
  const orgId = useSession()?.orgId;
  const q = useQuery({ queryKey: ["sales-register", orgId, from, to], queryFn: () => api.getSalesRegister(from, to), enabled: !!orgId });
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const rows = q.data!;
  return (
    <div className="space-y-3">
      <Button variant="outline" disabled={!rows.length} onClick={() => download(`sales-register-${period}.csv`, toCsv(rows.map(({ id: _id, ...r }) => r)))}><Download /> Export CSV</Button>
      <Table heads={["Invoice", "Date", "Customer", "GSTIN", "Taxable", "CGST", "SGST", "IGST", "Total", "Status"]} right={[4, 5, 6, 7, 8]}
        rows={rows.map((r) => [r.number, formatDate(r.date), r.customer, r.gstin ?? "Unregistered", inr(r.taxable), inr(r.cgst), inr(r.sgst), inr(r.igst), inr(r.total), r.status.replace(/_/g, " ")])} />
    </div>
  );
}

function ReceivablesView() {
  const orgId = useSession()?.orgId;
  const q = useQuery({ queryKey: ["receivables", orgId], queryFn: api.getReceivables, enabled: !!orgId, staleTime: 0 });
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const rows = q.data!;
  return (
    <div className="space-y-3">
      <Button variant="outline" disabled={!rows.length} onClick={() => download("receivables.csv", toCsv(rows.map(({ customerId: _c, ...r }) => r)))}><Download /> Export CSV</Button>
      <Table heads={["Customer", "Invoices", "Not yet due", "1–30 days", "31–60", "61–90", "90+", "Total"]} right={[1, 2, 3, 4, 5, 6, 7]}
        rows={rows.map((r) => [r.customer, r.invoices, inr(r.current), inr(r.d30), inr(r.d60), inr(r.d90), inr(r.over90), inr(r.total)])} />
    </div>
  );
}

function ItemsView({ period }: { period: string }) {
  const { from, to } = monthRange(period);
  const orgId = useSession()?.orgId;
  const q = useQuery({ queryKey: ["item-sales", orgId, from, to], queryFn: () => api.getItemSales(from, to), enabled: !!orgId });
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const rows = q.data!;
  return (
    <div className="space-y-3">
      <Button variant="outline" disabled={!rows.length} onClick={() => download(`item-sales-${period}.csv`, toCsv(rows.map(({ itemId: _i, ...r }) => r)))}><Download /> Export CSV</Button>
      <Table heads={["Item", "HSN", "Qty", "Sales (taxable)", "Cost", "Margin", "Margin %"]} right={[2, 3, 4, 5, 6]}
        rows={rows.map((r) => [r.item, r.hsn, `${r.qty} ${r.uom}`, inr(r.taxable), inr(r.cost), inr(r.margin), r.taxable ? `${((r.margin / r.taxable) * 100).toFixed(1)}%` : "—"])} />
      <p className="text-xs text-muted-foreground">Cost uses each item's current average cost.</p>
    </div>
  );
}
