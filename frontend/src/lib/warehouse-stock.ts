import type { Item } from "@/api/types";
import { weightedAverageCost } from "./purchase-rules.ts";

/** Item master cost is a legacy/default cost, never a cross-warehouse moving average. */
export function warehouseUnitCost(item: Item, godownId: string): number {
  return item.stock.find(s => s.godownId === godownId)?.unitCost ?? item.costPrice;
}
export function warehouseStockRow(item: Item, godownId: string) {
  if (!godownId || godownId === "all") throw new Error("Choose one warehouse for stock changes");
  let row = item.stock.find(s => s.godownId === godownId);
  if (!row) {
    row = { godownId, onHand: 0, held: 0, reorderLevel: 0, maxLevel: 0, unitCost: item.costPrice };
    item.stock.push(row);
  }
  return row;
}
/** Call before adding quantity. Only the receiving warehouse's valuation changes. */
export function receiveWarehouseCost(item: Item, godownId: string, qty: number, cost: number) {
  if (qty <= 0) return;
  const row = warehouseStockRow(item, godownId);
  row.unitCost = weightedAverageCost(row.onHand, warehouseUnitCost(item, godownId), qty, cost);
}
export function warehouseStockValue(item: Item, godownId: string) {
  return item.stock.filter(s => godownId === "all" || s.godownId === godownId)
    .reduce((sum, s) => sum + s.onHand * (s.unitCost ?? item.costPrice), 0);
}
