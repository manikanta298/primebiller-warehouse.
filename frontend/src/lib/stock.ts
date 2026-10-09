import type { Item } from "@/api/types";

export function stockFor(item: Item, godownId: string) {
  const rows = godownId === "all" ? item.stock : item.stock.filter((s) => s.godownId === godownId);
  const onHand = rows.reduce((a, s) => a + s.onHand, 0);
  const held = rows.reduce((a, s) => a + s.held, 0);
  const reorder = rows.reduce((a, s) => a + s.reorderLevel, 0);
  return { onHand, held, free: onHand - held, reorder };
}
