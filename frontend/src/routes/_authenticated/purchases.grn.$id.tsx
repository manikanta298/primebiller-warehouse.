import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { formatDate, formatINR } from "@/lib/format";
import { PageHeader, ErrorState, LoadingRows } from "@/components/app/states";

export const Route = createFileRoute("/_authenticated/purchases/grn/$id")({
  head: () => ({
    meta: [
      { title: "Goods receipt — Girder" },
      { name: "description", content: "Goods received note with accepted and rejected quantities, batches and landed cost." },
      { property: "og:title", content: "Goods receipt — Girder" },
      { property: "og:description", content: "Goods received note with accepted and rejected quantities, batches and landed cost." },
    ],
  }),
  component: GrnDetail,
});

function GrnDetail() {
  const { id } = Route.useParams();
  const q = useQuery({ queryKey: ["grn", id], queryFn: () => api.getGrn(id) });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const g = q.data;
  return (
    <div>
      <PageHeader title={g.number} eyebrow="Goods receipt">
        <div className="mt-1 text-sm text-muted-foreground">{formatDate(g.date)} · {g.supplierName} → {g.godownName} · stock posted</div>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60"><tr className="eyebrow">
              {["Item", "Batch / heat", "Expiry"].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
              {["Received", "Accepted", "Rejected", "Rate", "Landed cost"].map((h) => <th key={h} className="px-3 py-2 text-right">{h}</th>)}
            </tr></thead>
            <tbody>
              {g.lines.map((l, n) => (
                <tr key={n} className="border-t align-top">
                  <td className="min-w-48 px-3 py-2">{l.itemName}{l.rejectionReason && <div className="text-xs text-destructive">Rejected: {l.rejectionReason}</div>}</td>
                  <td className="num whitespace-nowrap px-3 py-2">{l.batchNo ?? "—"}{l.mfgDate && <div className="text-xs text-muted-foreground">Mfg {formatDate(l.mfgDate)}</div>}</td>
                  <td className="num px-3 py-2">{l.expiryDate ? formatDate(l.expiryDate) : "—"}</td>
                  <td className="num px-3 py-2 text-right">{l.received} {l.uom}</td>
                  <td className="num px-3 py-2 text-right">{l.accepted}</td>
                  <td className="num px-3 py-2 text-right">{l.rejected || "—"}</td>
                  <td className="num px-3 py-2 text-right">{formatINR(l.rate)}</td>
                  <td className="num px-3 py-2 text-right">{formatINR(l.landedCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="space-y-4">
          <div className="space-y-2 rounded-lg border bg-card p-4 text-sm">
            <R k="Taxable (accepted)" v={g.taxable} /><R k="GST" v={g.tax} /><R k="Freight & other" v={g.freight} />
            <div className="flex justify-between border-t pt-2 font-semibold"><span>Total</span><span className="num">{formatINR(g.grandTotal, 0)}</span></div>
            {g.freight > 0 && <p className="text-xs text-muted-foreground">Freight is allocated to accepted stock by value and included in landed cost.</p>}
          </div>
          <div className="space-y-1.5 rounded-lg border bg-card p-4 text-sm">
            <div className="eyebrow mb-1">Details</div>
            <div>Supplier invoice <span className="num">{g.supplierInvoiceNo}</span> · {formatDate(g.supplierInvoiceDate)}</div>
            {g.vehicleNo && <div>Vehicle <span className="num">{g.vehicleNo}</span></div>}
            {g.poId && <div>Against <Link to="/purchases/$id" params={{ id: g.poId }} className="num hover:underline">{g.poNumber}</Link></div>}
            <div><Link to="/stock-ledger" search={{ doc: g.number }} className="hover:underline">View in stock ledger</Link></div>
            <p className="text-xs text-muted-foreground">Posted by {g.createdBy}. Rejected units are recorded but not added to stock.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function R({ k, v }: { k: string; v: number }) {
  return <div className="flex justify-between"><span>{k}</span><span className="num">{formatINR(v)}</span></div>;
}
