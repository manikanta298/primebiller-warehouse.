import type { Godown, Item } from "../api/types.ts";

export function pipelineStatus(stage: string) {
  return ({ Draft: "draft", Confirmed: "confirmed", "Part delivered": "partially_delivered", Delivered: "delivered" } as Record<string, string>)[stage] ?? "all";
}

/** Consolidate at the order's dispatch warehouse; never treat remote stock as local. */
export function fulfillmentPlan(lines: { itemId: string; qty: number }[], items: Item[], godowns: Godown[], destinationId: string, incoming: Record<string, number> = {}) {
  const demand = new Map<string, number>();
  for (const line of lines) {
    if (line.itemId && Number.isFinite(line.qty) && line.qty > 0) demand.set(line.itemId, Math.round(((demand.get(line.itemId) ?? 0) + line.qty) * 1000) / 1000);
  }
  return [...demand].map(([itemId, qty]) => {
    const item = items.find((i) => i.id === itemId && i.active);
    const locations = godowns.filter((g) => g.active !== false).map((g) => {
      const balance = item?.stock.find((s) => s.godownId === g.id);
      return { id: g.id, name: g.name, onHand: balance?.onHand ?? 0, held: balance?.held ?? 0, free: Math.max(0, (balance?.onHand ?? 0) - (balance?.held ?? 0)) };
    });
    const localFree = locations.find((l) => l.id === destinationId)?.free ?? 0;
    const inTransit = Math.max(0, incoming[itemId] ?? 0);
    let missing = Math.max(0, Math.round((qty - localFree - inTransit) * 1000) / 1000);
    const transfers: { fromId: string; fromName: string; qty: number }[] = [];
    if (item && locations.some((l) => l.id === destinationId)) {
      for (const source of locations.filter((l) => l.id !== destinationId && l.free > 0)) {
        if (missing <= 0) break;
        const take = Math.min(source.free, missing);
        transfers.push({ fromId: source.id, fromName: source.name, qty: take });
        missing = Math.max(0, Math.round((missing - take) * 1000) / 1000);
      }
    }
    return { itemId, itemName: item?.name ?? itemId, uom: item?.baseUom ?? "", qty, localFree, inTransit, locations, transfers, shortage: missing };
  });
}
