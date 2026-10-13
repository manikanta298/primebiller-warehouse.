import { createHash } from "node:crypto";
import type { Ctx } from "./auth.js";
import { exec, one, type Conn } from "./db.js";
import { ApiError } from "./errors.js";
import type { Invoice } from "./shared/types.js";
import { invoiceNumberProblems } from "./shared/numbering.js";

export function canonicalJson(value: unknown): string {
  function sorted(v: any): any {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, sorted(v[k])]));
    return v;
  }
  return JSON.stringify(sorted(value));
}
export const snapshotHash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
export const parseSnapshot = (value: any): Invoice => typeof value === "string" ? JSON.parse(value) : value;
const frozenFields = ["id","number","date","dueDate","customerId","customerName","billingAddress","customerPhone","gstin","placeOfSupplyCode","placeOfSupplyName","supply","challans","lines","taxable","cgst","sgst","igst","roundOff","grandTotal","byRate","createdBy"] as const;
export function assertInvoiceFrozen(before: Invoice, after: Invoice) {
  for (const field of frozenFields) if (canonicalJson(before[field] ?? null) !== canonicalJson(after[field] ?? null))
    throw new ApiError(409, "invoice_immutable", `Issued invoice ${field} cannot be changed; use the supported correction workflow`);
}
export async function prepareInvoiceAudit(conn: Conn, ctx: Ctx, invoice: Invoice) {
  const row = await one(conn, "SELECT body FROM invoices WHERE org_id = ? AND id = ? FOR UPDATE", [ctx.orgId, invoice.id]);
  const before = row ? parseSnapshot(row["body"]) : undefined;
  if (before) assertInvoiceFrozen(before, invoice);
  else if (invoiceNumberProblems(invoice.number).length) throw new ApiError(422,"invalid_invoice_number",invoiceNumberProblems(invoice.number)[0]!);
  return { before, changed: !before || canonicalJson(before) !== canonicalJson(invoice) };
}
export async function appendInvoiceAudit(conn: Conn, ctx: Ctx, invoice: Invoice, audit: {before: Invoice | undefined; changed: boolean}) {
  if (!audit.changed) return;
  const event = !audit.before ? "issued" : invoice.status === "cancelled" && audit.before.status !== "cancelled" ? "cancelled" : "settlement_updated";
  await exec(conn, `INSERT INTO invoice_audit_events
    (org_id, invoice_id, event_type, actor_id, actor_name, before_snapshot, after_snapshot, snapshot_sha256)
    VALUES (?,?,?,?,?,?,?,?)`, [ctx.orgId, invoice.id, event, ctx.userId, ctx.userName,
    audit.before ? canonicalJson(audit.before) : null, canonicalJson(invoice), snapshotHash(invoice)]);
}
