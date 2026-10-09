/** Shared sales-order validation, free-stock checks and list transforms.
 * Keep this dependency-free so the React mock and Express backend use identical decisions.
 */
export type OrderLineDraft = { itemId: string; qty: number; rate: number; discountPct: number; uom: string };
export type OrderDraft = { date: string; customerId: string; godownId: string; notes: string; lines: OrderLineDraft[] };
export type OrderItemStock = { godownId: string; onHand: number; held: number };
export type OrderStockItem = { id: string; name: string; active?: boolean; allowNegative: boolean; baseUom: string; stock: OrderItemStock[] };
export type OrderKind = 'customer' | 'supplier' | 'both' | 'transporter';

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const precision = (n: number, digits: number) => Number.isFinite(n) && Math.abs(n * 10 ** digits - Math.round(n * 10 ** digits)) < 1e-6;

export function orderDraftProblems(d: OrderDraft): string[] {
  const errors: string[] = [];
  if (!validDate(d.date)) errors.push('Enter a valid order date');
  if (!d.customerId.trim()) errors.push('Select a customer');
  if (!d.godownId.trim()) errors.push('Select a dispatch godown');
  if (!d.lines.length) errors.push('Add at least one item');
  if (d.lines.length > 200) errors.push('An order cannot have more than 200 lines');
  if (d.notes.length > 2000) errors.push('Notes cannot exceed 2,000 characters');
  for (const [index, line] of d.lines.entries()) {
    const label = `Line ${index + 1}`;
    if (!line.itemId.trim()) errors.push(`${label}: select an item`);
    if (!(line.qty > 0 && line.qty <= 999999999 && precision(line.qty, 3))) errors.push(`${label}: quantity must be positive with up to 3 decimals`);
    if (!(line.rate >= 0 && line.rate <= 999999999 && precision(line.rate, 2))) errors.push(`${label}: rate must be non-negative with up to 2 decimals`);
    if (!(line.discountPct >= 0 && line.discountPct <= 100 && precision(line.discountPct, 2))) errors.push(`${label}: discount must be between 0–100% with up to 2 decimals`);
  }
  return errors;
}

/** Multiple lines for one item must reserve their combined quantity, never each in isolation. */
export function stockHoldProblems(lines: Pick<OrderLineDraft, 'itemId' | 'qty'>[], godownId: string, items: OrderStockItem[]): string[] {
  const needed = new Map<string, number>();
  for (const line of lines) needed.set(line.itemId, (needed.get(line.itemId) ?? 0) + line.qty);
  const byId = new Map(items.map((item) => [item.id, item]));
  const problems: string[] = [];
  for (const [id, qty] of needed) {
    const item = byId.get(id);
    if (!item) { problems.push(`Item ${id} was not found`); continue; }
    if (item.active === false) { problems.push(`${item.name} is inactive`); continue; }
    const stock = item.stock.find((s) => s.godownId === godownId);
    const free = (stock?.onHand ?? 0) - (stock?.held ?? 0);
    if (!item.allowNegative && qty > free + 1e-6) problems.push(`${item.name}: need ${Number(qty.toFixed(3))}, free ${Number(free.toFixed(3))}`);
  }
  return problems;
}

export function orderCustomerEligible(kind: OrderKind, blocked: boolean): boolean {
  return (kind === 'customer' || kind === 'both') && !blocked;
}

/** Demo-mode document tenancy. Never use a DTO's customer alone to infer ownership. */
export function salesOrdersForOrg<T extends { id: string }>(orders: T[], owners: Record<string, string>, orgId: string): T[] {
  return orders.filter((order) => Boolean(orgId) && owners[order.id] === orgId);
}

export type OrderListRow = { id: string; number: string | null; date: string; customerName: string; status: string; grandTotal: number };
export function filterSalesOrders<T extends OrderListRow>(orders: T[], status: string, search: string): T[] {
  const tokens = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return orders.filter((o) => (!status || status === 'all' || o.status === status) &&
    tokens.every((term) => `${o.number ?? 'draft'} ${o.customerName} ${o.date} ${o.status}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}
export function orderPage<T>(rows: T[], page: number, size = 25) {
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const actual = Math.min(totalPages, Math.max(1, Math.floor(page) || 1));
  return { rows: rows.slice((actual - 1) * size, actual * size), page: actual, totalPages };
}
