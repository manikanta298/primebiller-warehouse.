import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useSession } from "@/lib/session";
export function InvoiceSources({ id }: { id: string }) {
  const session = useSession();
  const q = useQuery({ queryKey: ["invoice-sources", session?.orgId, id], queryFn: () => api.invoiceSources(id) });
  return <section aria-label="Invoice warehouse sources" className="my-4 space-y-2 rounded-lg border bg-card p-4"><h2 className="font-semibold">Warehouse sourcing</h2><p className="text-sm text-muted-foreground">Dispatch locations captured from delivery allocations. Earlier transfer origin is not inferred from pooled stock.</p>{q.isLoading && <p>Loading sources…</p>}{q.error && <p role="alert">Unable to load sources. <button onClick={() => q.refetch()}>Retry</button></p>}<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Item", "Quantity", "Dispatch warehouse", "Challan", "Batch"].map(h => <th className="p-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{q.data?.map((s, n) => <tr className="border-t" key={n}><td className="p-2">{s.itemName}</td><td className="p-2">{s.qty} {s.uom}</td><td className="p-2">{s.warehouseName}</td><td className="p-2">{s.challanNumber}</td><td className="p-2">{s.batchNo || "General stock"}</td></tr>)}</tbody></table></div>{q.data?.length === 0 && <p>No historical source allocation is available.</p>}</section>;
}
