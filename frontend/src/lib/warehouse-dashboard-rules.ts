/** Shared warehouse catalogue and movement summaries; never mutate stock here.
 * Movement value (INR) is comparable across unlike units (KG/BAG/PCS).
 */
import type { Item, LedgerEntry, WarehouseActivity, WarehouseDayFlow } from "../api/types.ts";

export type WarehouseItemRow = {
  item: Item; onHand: number; held: number; free: number; value: number;
};
export type WarehouseStockFilter = "all" | "available" | "zero" | "reserved";

export function warehouseCatalogue(items: Item[], warehouseId: string, query = "", filter: WarehouseStockFilter = "all"): WarehouseItemRow[] {
  const term = query.trim().toLowerCase();
  return items.flatMap((item) => {
    const s = item.stock.find((row) => row.godownId === warehouseId);
    const onHand = s?.onHand ?? 0;
    const held = s?.held ?? 0;
    const free = onHand - held;
    if (term && ![item.name, item.sku, item.category, item.brand, item.hsn].some((v) => v.toLowerCase().includes(term))) return [];
    if (filter === "available" && free <= 0) return [];
    if (filter === "zero" && free > 0) return [];
    if (filter === "reserved" && held <= 0) return [];
    return [{ item, onHand, held, free, value: onHand * item.costPrice }];
  }).sort((a, b) => a.item.name.localeCompare(b.item.name) || a.item.sku.localeCompare(b.item.sku));
}

export function warehouseActivityFromLedger(entries: LedgerEntry[], godownId: string, fromDate: string, toDate: string): WarehouseActivity {
  const scoped = entries.filter((e) => e.godownId === godownId && e.at.slice(0, 10) >= fromDate && e.at.slice(0, 10) <= toDate && e.qty !== 0);
  const dates = new Map<string, WarehouseDayFlow>();
  let incomingValue = 0, outgoingValue = 0, incomingMovements = 0, outgoingMovements = 0;
  for (const e of scoped) {
    const amount = Math.abs(e.qty * e.unitCost);
    const day = e.at.slice(0, 10);
    const d = dates.get(day) ?? { date: day, incomingValue: 0, outgoingValue: 0 };
    if (e.qty > 0) { incomingValue += amount; incomingMovements++; d.incomingValue += amount; }
    else { outgoingValue += amount; outgoingMovements++; d.outgoingValue += amount; }
    dates.set(day, d);
  }
  return {
    godownId, fromDate, toDate,
    incomingValue: Math.round(incomingValue * 100) / 100,
    outgoingValue: Math.round(outgoingValue * 100) / 100,
    incomingMovements, outgoingMovements,
    daily: [...dates.values()].sort((a, b) => a.date.localeCompare(b.date)),
    recent: [...scoped].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).slice(0, 20),
  };
}

export function warehouseActivityPeriod(today: string): string {
  const t = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(t)) throw new Error("Invalid warehouse activity date");
  return new Date(t - 29 * 86_400_000).toISOString().slice(0, 10);
}
