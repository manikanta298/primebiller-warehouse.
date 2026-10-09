/** Tax-invoice rules: advances, due dates, status, gapless numbering. */
export interface AdvanceLike { id: string; date: string; remaining: number }
export interface AdvanceAllocation { advanceId: string; amount: number }

/** Apply advances oldest first until the invoice total is covered. */
export function applyAdvancesOldestFirst(advances: AdvanceLike[], total: number): AdvanceAllocation[] {
  let left = Math.max(0, total);
  const out: AdvanceAllocation[] = [];
  for (const a of [...advances].sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id))) {
    if (left <= 0) break;
    const amt = Math.min(a.remaining, left);
    if (amt > 0) { out.push({ advanceId: a.id, amount: amt }); left -= amt; }
  }
  return out;
}

export function dueDateFor(date: string, creditDays: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.max(0, creditDays));
  return d.toISOString().slice(0, 10);
}

export type InvoiceStatus = "awaiting_payment" | "partially_paid" | "paid" | "overdue" | "cancelled";

export function invoiceStatus(total: number, settled: number, dueDate: string, today: string): InvoiceStatus {
  const balance = total - settled;
  if (balance <= 0) return "paid";
  if (dueDate < today) return "overdue";
  return settled > 0 ? "partially_paid" : "awaiting_payment";
}

/** Gapless: the next number is always last issued + 1. */
export function invoiceNumber(prefix: string, fy: string, seq: number): string {
  return `${prefix}/${fy}/${String(seq).padStart(4, "0")}`;
}

/** Challans that may go on one invoice: delivered, uninvoiced, same customer. */
export function invoiceProblems(challans: { status: string; invoiceNo?: string | undefined; customerId: string; number: string }[]): string[] {
  const p: string[] = [];
  if (!challans.length) p.push("Select at least one delivered challan");
  for (const c of challans) {
    if (c.status !== "delivered") p.push(`${c.number} is not delivered yet`);
    if (c.invoiceNo) p.push(`${c.number} is already on ${c.invoiceNo}`);
  }
  if (new Set(challans.map((c) => c.customerId)).size > 1) p.push("All challans must be for the same customer");
  return p;
}

const realDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

export type InvoiceChallan = {
  id: string; status: string; invoiceNo?: string | undefined; customerId: string;
  number: string; date: string; placeOfSupplyCode: string;
};

/** Validate the complete selection, not just the subset which happened to be found. */
export function invoiceIssueProblems(challans: InvoiceChallan[], ids: string[], date: string, businessToday: string): string[] {
  const problems = invoiceProblems(challans);
  if (!ids.length || ids.length > 100) problems.push('Select between 1 and 100 challans');
  if (new Set(ids).size !== ids.length) problems.push('A challan cannot be selected twice');
  if (ids.some((id) => !challans.some((c) => c.id === id))) problems.push('One or more selected challans could not be found');
  if (new Set(challans.map((c) => c.placeOfSupplyCode)).size > 1)
    problems.push('Challans with different places of supply need separate invoices');
  if (!realDate(date)) problems.push('Enter a valid invoice date');
  else {
    if (date > businessToday) problems.push('Invoice date cannot be in the future');
    if (challans.some((c) => c.date > date)) problems.push('Invoice date cannot be before a selected challan');
  }
  return problems;
}

/** Credit notes are a separate workflow: only unpaid invoices in the current GST month may be voided here. */
export function invoiceCancelProblems(
  invoice: { status: string; paid: number; date: string }, reason: string, businessToday: string,
): string[] {
  const problems: string[] = [];
  if (invoice.status === 'cancelled') problems.push('This invoice is already cancelled');
  if (invoice.paid > 0) problems.push('Paid invoices require a credit note, not cancellation');
  if (!realDate(invoice.date) || invoice.date.slice(0, 7) !== businessToday.slice(0, 7))
    problems.push('Only invoices from the current GST month can be cancelled; a credit note is required otherwise');
  if (reason.trim().length < 5 || reason.trim().length > 500) problems.push('Give a cancellation reason of 5–500 characters');
  return problems;
}

export function invoicesForOrg<T extends { id: string }>(rows: T[], owners: Record<string, string>, orgId: string): T[] {
  return rows.filter((row) => !!orgId && owners[row.id] === orgId);
}

export function filterInvoices<T extends { number: string; date: string; customerName: string; status: string; dueDate: string;
  challans: { number: string }[] }>(rows: T[], status: string, search: string): T[] {
  const tokens = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => (!status || status === 'all' || row.status === status) && tokens.every((token) =>
    `${row.number} ${row.date} ${row.customerName} ${row.dueDate} ${row.status} ${row.challans.map((c) => c.number).join(' ')}`.toLocaleLowerCase().includes(token)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
}

export interface OpenInvoiceLike { id: string; date: string; balance: number }
/** Split a receipt across open invoices oldest first; anything left over becomes an advance. */
export function allocateReceipt(invoices: OpenInvoiceLike[], amount: number): { allocations: { invoiceId: string; amount: number }[]; advance: number } {
  let left = Math.max(0, amount);
  const allocations: { invoiceId: string; amount: number }[] = [];
  for (const i of [...invoices].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    if (left <= 0) break;
    const amt = Math.min(i.balance, left);
    if (amt > 0) { allocations.push({ invoiceId: i.id, amount: amt }); left -= amt; }
  }
  return { allocations, advance: left };
}
