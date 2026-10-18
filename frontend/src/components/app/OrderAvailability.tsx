import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@/api/client";
import type { Godown } from "@/api/types";
import { fulfillmentPlan } from "@/lib/fulfillment-plan";
import { formatQty } from "@/lib/format";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

export function OrderAvailability({ lines, godowns, godownId, orderId, unsaved }: { lines: { itemId: string; qty: number }[]; godowns: Godown[]; godownId: string; orderId?: string | undefined; unsaved: boolean }) {
  const session = useSession();
  const stock = useQuery({ queryKey: ["order-availability", session?.orgId], queryFn: () => api.listItems(), enabled: !!session?.orgId && lines.length > 0, staleTime: 0, refetchOnWindowFocus: true });
  const transfers = useQuery({ queryKey: ["order-incoming", session?.orgId], queryFn: () => api.listTransfers("in_transit"), enabled: !!session?.orgId && lines.length > 0 && can(session?.user.role, "transfer"), staleTime: 0 });
  const incoming = (transfers.data ?? []).filter((t) => t.status === "in_transit" && t.toId === godownId && t.reason === `Fulfillment for sales order ${orderId}`);
  const incomingByItem: Record<string, number> = {};
  for (const transfer of incoming) for (const line of transfer.lines) incomingByItem[line.itemId] = (incomingByItem[line.itemId] ?? 0) + line.qty;
  if (!lines.length) return null;
  const destination = godowns.find((g) => g.id === godownId);
  return <section className="space-y-3 rounded-lg border bg-card p-4" aria-label="Order stock by warehouse">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Availability by warehouse</h2><Button size="sm" variant="outline" disabled={stock.isFetching} onClick={() => { stock.refetch(); transfers.refetch(); }}>Refresh availability</Button></div>
    <p className="text-sm text-muted-foreground">Fulfill from {destination?.name ?? "the selected dispatch warehouse"}. Transfer remote stock here and receive it before confirming this order. Stock in transit is not available for dispatch.</p>
    {stock.isLoading && <p role="status">Loading warehouse balances…</p>}
    {stock.error && <p role="alert">Could not load warehouse availability. Refresh to retry.</p>}
    {incoming.map((t) => <p key={t.id} className="text-sm"><Link to="/transfers/$id" params={{ id: t.id }} search={{ orderId }} className="underline">Receive {t.number}</Link> · {t.fromName} → {t.toName} · in transit</p>)}
    {stock.data && fulfillmentPlan(lines, stock.data, godowns, godownId, incomingByItem).map((p) => <div key={p.itemId} className="space-y-2 border-t pt-3">
      <h3 className="text-sm font-medium">{p.itemName} · Required {formatQty(p.qty)} {p.uom}</h3>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left"><th>Warehouse</th><th className="text-right">On hand</th><th className="text-right">Reserved</th><th className="text-right">Free</th></tr></thead><tbody>{p.locations.map((l) => <tr key={l.id}><td>{l.name}{l.id === godownId ? " (dispatch)" : ""}</td><td className="text-right">{formatQty(l.onHand)}</td><td className="text-right">{formatQty(l.held)}</td><td className="text-right">{formatQty(l.free)} {p.uom}</td></tr>)}</tbody></table></div>
      {p.inTransit > 0 && <p className="text-sm">{formatQty(p.inTransit)} {p.uom} incoming for this order; receive before confirmation.</p>}
      {p.localFree >= p.qty ? <p className="text-sm text-success">Available at dispatch warehouse</p> : <>
        {p.shortage > 0 && <p role="alert" className="text-sm text-destructive">Short by {formatQty(p.shortage)} {p.uom} after available transfers. Purchase or receive more stock.</p>}
        {p.transfers.map((t) => <div key={t.fromId} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>Transfer {formatQty(t.qty)} {p.uom} from {t.fromName} → {destination?.name}</span>{can(session?.user.role, "transfer") && orderId && !unsaved && !transfers.isLoading && !transfers.error ? <Button variant="outline" size="sm" asChild><Link to="/transfers/new" search={{ fromId: t.fromId, toId: godownId, itemId: p.itemId, qty: String(t.qty), orderId }}>Prepare transfer</Link></Button> : <span className="text-muted-foreground">{!orderId || unsaved ? "Save draft to prepare transfer" : "Ask a warehouse manager to transfer stock"}</span>}</div>)}
      </>}
    </div>)}
  </section>;
}
