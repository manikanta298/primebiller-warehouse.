import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { api } from "@/api/client";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { filterReceipts } from "@/lib/receipt-rules";
import { formatDate, formatINR } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { Chips } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/receipts/")({
  head: () => ({ meta: [
    { title: "Receipts & advances — Girder" },
    { name: "description", content: "Record customer payments against invoices and track unused advances." },
  ] }),
  component: Receipts,
});

const MODE: Record<string, string> = { cash: "Cash", upi: "UPI", neft: "NEFT / RTGS", cheque: "Cheque" };
const PAGE_SIZE = 25;
const th = "px-4 py-2.5 text-left font-semibold";

function Receipts() {
  const session = useSession();
  const orgId = session?.orgId ?? "";
  const [tab, setTab] = useState<"receipts" | "advances">("receipts");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const rq = useQuery({ queryKey: ["receipts", orgId], queryFn: api.listReceipts, enabled: !!orgId });
  const aq = useQuery({ queryKey: ["advances", "all", orgId], queryFn: api.listAllAdvances, enabled: !!orgId });
  const openAdv = (aq.data ?? []).filter((a) => a.remaining > 0);
  const receipts = useMemo(() => filterReceipts(rq.data ?? [], search), [rq.data, search]);
  const filteredAdv = openAdv.filter((a) => `${a.receiptNo} ${a.date} ${a.customerName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const rows = tab === "receipts" ? receipts : filteredAdv;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * PAGE_SIZE;
  useEffect(() => { setTab("receipts"); setSearch(""); setPage(1); }, [orgId]);
  const selectTab = (v: "receipts" | "advances") => { setTab(v); setPage(1); };
  const query = tab === "receipts" ? rq : aq;

  return (
    <div>
      <PageHeader title="Receipts & advances" eyebrow="Sales" actions={can(session?.user.role, "recordReceipt") ? <Button asChild><Link to="/receipts/new"><Plus /> Record receipt</Link></Button> : undefined} />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Chips value={tab} onChange={selectTab} options={[{ value: "receipts", label: "Receipts" }, { value: "advances", label: `Unused advances (${openAdv.length})` }]} />
        {tab === "advances" && <span className="num text-sm text-muted-foreground">Total {formatINR(openAdv.reduce((a, b) => a + b.remaining, 0), 0)}</span>}
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search receipts" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search receipt, customer, reference or invoice" className="pl-8" />
        </div>
        {!query.isLoading && !query.error && <span className="text-xs text-muted-foreground" aria-live="polite">{rows.length} {tab === "receipts" ? "receipts" : "unused advances"}</span>}
      </div>
      {query.isLoading ? <LoadingRows /> : query.error ? <ErrorState error={query.error} onRetry={() => { void query.refetch(); }} /> : !rows.length ? (
        <EmptyState title={tab === "receipts" ? "No receipts here" : "No unused advances"} hint={search ? "Try a different search." : tab === "advances" ? "Money not allocated to invoices appears here." : "Record a customer payment to get started."} />
      ) : tab === "receipts" ? (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60"><tr className="eyebrow">
              {["Receipt", "Date", "Customer", "Mode", "Reference", "Against"].map((h) => <th key={h} className={th}>{h}</th>)}
              <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
            </tr></thead>
            <tbody>{receipts.slice(offset, offset + PAGE_SIZE).map((r) => (
              <tr key={r.id} className="border-t align-top">
                <td className="num whitespace-nowrap px-4 py-2.5 font-medium">{r.number}</td>
                <td className="num whitespace-nowrap px-4 py-2.5">{formatDate(r.date)}</td>
                <td className="px-4 py-2.5">{r.customerName}</td>
                <td className="px-4 py-2.5">{MODE[r.mode] ?? r.mode}</td>
                <td className="num px-4 py-2.5 text-xs text-muted-foreground">{r.reference || "—"}</td>
                <td className="px-4 py-2.5 text-xs">
                  {r.allocations.map((a) => <div key={a.invoiceId}><Link to="/invoices/$id" params={{ id: a.invoiceId }} className="num hover:underline">{a.invoiceNo}</Link> <span className="num text-muted-foreground">{formatINR(a.amount, 0)}</span></div>)}
                  {r.advance > 0 && <div className="text-accent-foreground"><span className="rounded bg-accent/15 px-1.5 py-0.5">Advance</span> <span className="num">{formatINR(r.advance, 0)}</span></div>}
                </td>
                <td className="num px-4 py-2.5 text-right">{formatINR(r.amount, 0)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60"><tr className="eyebrow">
              {["Receipt", "Date", "Customer"].map((h) => <th key={h} className={th}>{h}</th>)}
              <th className="px-4 py-2.5 text-right font-semibold">Received</th><th className="px-4 py-2.5 text-right font-semibold">Unused</th>
            </tr></thead>
            <tbody>{filteredAdv.slice(offset, offset + PAGE_SIZE).map((a) => (
              <tr key={a.id} className="border-t">
                <td className="num px-4 py-2.5 font-medium">{a.receiptNo}</td>
                <td className="num px-4 py-2.5">{formatDate(a.date)}</td>
                <td className="px-4 py-2.5"><Link to="/parties/$id" params={{ id: a.customerId }} className="hover:underline">{a.customerName}</Link></td>
                <td className="num px-4 py-2.5 text-right">{formatINR(a.amount, 0)}</td>
                <td className="num px-4 py-2.5 text-right font-medium">{formatINR(a.remaining, 0)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {!query.isLoading && !query.error && totalPages > 1 && <div className="mt-4 flex items-center justify-end gap-3 text-sm">
        <Button size="sm" variant="outline" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</Button>
        <span className="num text-muted-foreground">Page {currentPage} of {totalPages}</span>
        <Button size="sm" variant="outline" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>Next</Button>
      </div>}
    </div>
  );
}
