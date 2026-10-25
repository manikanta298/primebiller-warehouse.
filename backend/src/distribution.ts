import { createHash } from "node:crypto";
import { exec, one } from "./db.js";
import type { Uow } from "./uow.js";
import type { Quotation, Invoice } from "./shared/types.js";
import { quotationContent } from "./shared/distribution-rules.js";

export const jsonBody = (v: any) => typeof v === "string" ? JSON.parse(v) : v;
/** Caller holds the source document lock. Runs in the same transaction as its save. */
export async function queueDocument(u: Uow, type: "quotation" | "invoice", doc: Quotation | Invoice, previousDocument?: Quotation) {
  let previous = await one(u.conn, "SELECT version, content_hash FROM document_distributions WHERE org_id = ? AND document_type = ? AND document_id = ? ORDER BY version DESC LIMIT 1 FOR UPDATE", [u.ctx.orgId, type, doc.id]);
  // Existing quotations predate this feature. Never treat an edited legacy quote as a new auto-send.
  if (!previous && previousDocument && type === "quotation") {
    await queueDocument(u, type, previousDocument);
    await exec(u.conn, "UPDATE document_distributions SET status = 'legacy' WHERE org_id = ? AND document_type = ? AND document_id = ? AND version = 1", [u.ctx.orgId, type, doc.id]);
    previous = await one(u.conn, "SELECT version, content_hash FROM document_distributions WHERE org_id = ? AND document_type = ? AND document_id = ? ORDER BY version DESC LIMIT 1 FOR UPDATE", [u.ctx.orgId, type, doc.id]);
  }
  const hash = createHash("sha256").update(type === "quotation" ? quotationContent(doc as Quotation) : JSON.stringify(doc)).digest("hex");
  if (previous?.["content_hash"] === hash || (type === "invoice" && previous)) return;
  const version = Number(previous?.["version"] ?? 0) + 1;
  await exec(u.conn, "UPDATE document_distributions SET status = 'superseded' WHERE org_id = ? AND document_type = ? AND document_id = ? AND status IN ('pending_approval','queued','blocked','failed','rejected')", [u.ctx.orgId, type, doc.id]);
  const org = await one(u.conn, "SELECT name, gstin, state_code FROM orgs WHERE id = ?", [u.ctx.orgId]);
  const party = await u.party(doc.customerId);
  const settingsRow = await one(u.conn, "SELECT body FROM org_settings WHERE org_id = ?", [u.ctx.orgId]);
  const settings = settingsRow ? jsonBody(settingsRow.body) : {};
  const business = { ...org, name: settings.legalName || org?.name, address: settings.address || "", phone: settings.phone || "", email: settings.email || "", invoiceTerms: settings.invoiceTerms || "" };
  await exec(u.conn, `INSERT INTO document_distributions (org_id, document_type, document_id, version, content_hash, snapshot, customer_id, author_id, author_name, status) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [u.ctx.orgId, type, doc.id, version, hash, JSON.stringify({ document: doc, business, customer: party }), doc.customerId, u.ctx.userId, u.ctx.userName, type === "quotation" && version > 1 ? "pending_approval" : "queued"]);
}
