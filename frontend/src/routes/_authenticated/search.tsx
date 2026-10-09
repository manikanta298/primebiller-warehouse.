import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { z } from "zod";
import { api } from "@/api/client";
import type { DocHit, SearchDocType } from "@/api/types";
import { formatDate, formatINR } from "@/lib/format";
import { toCsv } from "@/lib/reports";
import { download } from "@/lib/download";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Chips } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const search = z.object({
  q: z.string().optional(),
  types: z.string().optional(),
  status: z.string().optional(),
  period: z.enum(["today", "7d", "30d", "fy", "all"]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const Route = createFileRoute("/_authenticated/search")({
  validateSearch: search,
  head: () => ({
    meta: [
      { title: "Find a document — Girder" },
      { name: "description", content: "Search sales orders, challans, invoices and receipts by number or party, with filters kept in the link." },
      { property: "og:title", content: "Find a document — Girder" },
      { property: "og:description", content: "Search sales orders, challans, invoices and receipts by number or party, with filters kept in the link." },
    ],
  }),
  component: FindDocument,
});

const TYPES: { value: SearchDocType; label: string }[] = [
  { value: "SO", label: "Sales orders" },
  { value: "DC", label: "Challans" },
  { value: "INV", label: "Invoices" },
  { value: "RCT", label: "Receipts" },
];
const PERIODS = [
  { value: "all", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "fy", label: "This FY" },
] as const;

function FindDocument() {
  const s = Route.useSearch();
  const navigate = useNavigate({ from: "/search" });
  const types = (s.types?.split(",").filter(Boolean) ?? []) as SearchDocType[];
  const [text, setText] = useState(s.q ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((s.q ?? "") !== text) navigate({ search: (p) => ({ ...p, q: text || undefined }), replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [text, s.q, navigate]);

  const set = (patch: Partial<z.infer<typeof search>>) => navigate({ search: (p) => ({ ...p, ...patch }), replace: true });
  const q = useQuery({
    queryKey: ["search", s],
    queryFn: () => api.searchDocs({ q: s.q, types, status: s.status, period: s.period, min: s.min, max: s.max }),
  });
  const statuses = [...new Set((q.data ?? []).map((d) => d.status))];

  const open = (d: DocHit) => {
    if (d.type === "SO") navigate({ to: "/sales-orders/$id", params: { id: d.id } });
    else if (d.type === "DC") navigate({ to: "/challans/$id", params: { id: d.id } });
    else if (d.type === "INV") navigate({ to: "/invoices/$id", params: { id: d.id } });
    else navigate({ to: "/receipts" });
  };

  return (
    <div>
      <PageHeader
        title="Find a document"
        eyebrow="Overview"
        actions={
          <Button variant="outline" disabled={!q.data?.length} onClick={() => download("documents.csv", toCsv((q.data ?? []).map(({ id: _id, ...r }) => r)))}>
            <Download /> Export CSV
          </Button>
        }
      />
      <div className="mb-4 space-y-3 rounded-lg border bg-card p-4">
        <Input autoFocus placeholder="Number or party name, e.g. 0287 or Rajesh" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex flex-wrap items-center gap-1.5">
          {TYPES.map((t) => {
            const on = types.includes(t.value);
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => set({ types: (on ? types.filter((x) => x !== t.value) : [...types, t.value]).join(",") || undefined })}
                className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <Chips value={s.period ?? "all"} onChange={(v) => set({ period: v === "all" ? undefined : v })} options={[...PERIODS]} />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Amount ₹</span>
          <Input className="num h-8 w-32" inputMode="numeric" placeholder="min" defaultValue={s.min ?? ""} onBlur={(e) => set({ min: e.target.value ? Number(e.target.value) : undefined })} />
          <span>to</span>
          <Input className="num h-8 w-32" inputMode="numeric" placeholder="max" defaultValue={s.max ?? ""} onBlur={(e) => set({ max: e.target.value ? Number(e.target.value) : undefined })} />
          <select className="h-8 rounded-md border bg-card px-2 text-sm" value={s.status ?? ""} onChange={(e) => set({ status: e.target.value || undefined })}>
            <option value="">Any status</option>
            {[...new Set([...statuses, ...(s.status ? [s.status] : [])])].map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}
          </select>
        </div>
      </div>
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data?.length ? <EmptyState title="Nothing matches" hint="Try fewer filters or a shorter number." /> : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <p className="px-4 py-2 text-xs text-muted-foreground">{q.data.length} documents</p>
          <table className="w-full text-sm">
            <thead className="bg-muted/60"><tr className="eyebrow">
              {["Type", "Number", "Date", "Party"].map((h) => <th key={h} className="px-4 py-2.5 text-left font-semibold">{h}</th>)}
              <th className="px-4 py-2.5 text-right font-semibold">Amount</th><th className="px-4 py-2.5 text-left font-semibold">Status</th>
            </tr></thead>
            <tbody>
              {q.data.map((d) => (
                <tr key={d.type + d.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => open(d)}>
                  <td className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">{d.type}</td>
                  <td className="num whitespace-nowrap px-4 py-2.5 font-medium">{d.number}</td>
                  <td className="num whitespace-nowrap px-4 py-2.5">{formatDate(d.date)}</td>
                  <td className="px-4 py-2.5">{d.party}</td>
                  <td className="num px-4 py-2.5 text-right">{formatINR(d.amount, 0)}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
