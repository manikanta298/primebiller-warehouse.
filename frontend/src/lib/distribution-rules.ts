import type { Quotation, Invoice, Role, Party, SalesOrder, Challan, Receipt } from "../api/types";
import { can } from "./permissions";

/** Stable business content only: generated line IDs and delivery status are not revisions. */
export function quotationContent(q: Quotation) {
  return JSON.stringify({ customerId: q.customerId, customerName: q.customerName, date: q.date, validUntil: q.validUntil,
    godownId: q.godownId, notes: q.notes, terms: q.terms, supply: q.supply, placeOfSupplyCode: q.placeOfSupplyCode,
    grandTotal: q.grandTotal, lines: q.lines.map(l => ({ itemId: l.itemId, itemName: l.itemName, hsn: l.hsn,
      uom: l.uom, qty: l.qty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate })) });
}
export function mayDecideRevision(role: Role, actorId: string, authorId: string): boolean {
  return can(role, "approveQuotationRevision") && actorId !== authorId;
}
export function normalizeWhatsappPhone(value: string): string | null {
  const phone = value.trim().replace(/[ ()-]/g, "");
  return /^\+[1-9][0-9]{7,14}$/.test(phone) ? phone.slice(1) : null;
}
export function advanceDeliveryStatus(current: string, incoming: string): string {
  if (!["sent", "delivered", "read", "failed"].includes(incoming)) return current;
  if (current === "read" || ["superseded", "rejected", "blocked"].includes(current)) return current;
  if (incoming === "failed") return ["delivered", "read"].includes(current) ? current : "failed";
  const rank: Record<string, number> = { accepted: 0, failed: 0, sent: 1, delivered: 2, read: 3 };
  return (rank[incoming] ?? -1) > (rank[current] ?? -1) ? incoming : current;
}
export type InvoiceSource = { itemId: string; itemName: string; qty: number; uom: string; warehouseId: string; warehouseName: string; challanId: string; challanNumber: string; batchNo: string };
export type DistributionVersion = { version: number; status: string; authoredBy: string; authoredByName: string; createdAt: string; decidedBy?: string; reason?: string; providerId?: string; error?: string };
export type CustomerDashboard = { customer: Party; quotations: Quotation[]; invoices: Invoice[];
  orders: SalesOrder[]; deliveries: Challan[]; receipts: Receipt[];
  preferences: { enabled: boolean; phone: string; evidence: string }; messages: { documentType: string; documentId: string; version: number; status: string; createdAt: string; error?: string }[] };
