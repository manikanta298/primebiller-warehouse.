import { Router } from "express";
import { z } from "zod";
import { h, read, write } from "../http.js";
import { requirePerm } from "../auth.js";
import { exec, one, rows } from "../db.js";
import { ApiError } from "../errors.js";
import { jsonBody } from "../distribution.js";
import { mayDecideRevision, normalizeWhatsappPhone } from "../shared/distribution-rules.js";
import type { Uow } from "../uow.js";

export const crmRouter = Router();
async function source(u: Uow, type: string, id: string) {
  if (type !== "quotation" && type !== "invoice") throw new ApiError(422, "validation", "Unknown document type");
  requirePerm(u.ctx, type === "quotation" ? "salesOrders" : "issueInvoice", "Your role cannot access this document");
  const doc = await u.doc(type === "quotation" ? "quotations" : "invoices", id);
  if (!doc) throw new ApiError(404, "not_found", "Document not found");
  return doc;
}
crmRouter.get("/distribution/:type/:id", h(req => read(req, async u => {
  await source(u, String(req.params.type), String(req.params.id));
  return (await rows(u.conn, `SELECT version, status, author_id, author_name, created_at, decision_by, decision_reason, provider_id, error_code FROM document_distributions WHERE org_id = ? AND document_type = ? AND document_id = ? ORDER BY version DESC`, [u.ctx.orgId, req.params.type, req.params.id])).map(r => ({ version: r.version, status: r.status, authoredBy: r.author_id, authoredByName: r.author_name, createdAt: String(r.created_at), decidedBy: r.decision_by, reason: r.decision_reason, providerId: r.provider_id, error: r.error_code }));
})));
crmRouter.post("/distribution/quotation/:id/:version/decision", h(req => write(req, async u => {
  requirePerm(u.ctx, "approveQuotationRevision", "Only an Owner or Manager can decide quotation revisions");
  const q = await source(u, "quotation", String(req.params.id));
  const version = z.coerce.number().int().positive().parse(req.params.version);
  const input = z.object({ approve: z.boolean(), reason: z.string().trim().min(3).max(500) }).strict().parse(req.body);
  const latest = await one(u.conn, "SELECT * FROM document_distributions WHERE org_id = ? AND document_type = 'quotation' AND document_id = ? ORDER BY version DESC LIMIT 1 FOR UPDATE", [u.ctx.orgId, q.id]);
  if (!latest || latest.version !== version || latest.status !== "pending_approval" || ["cancelled", "converted"].includes(q.status)) throw new ApiError(409, "stale_revision", "Only the current pending revision can be decided");
  if (!mayDecideRevision(u.ctx.role, u.ctx.userId, latest.author_id)) throw new ApiError(403, "self_approval", "A different Owner or Manager must decide this revision");
  await exec(u.conn, "UPDATE document_distributions SET status = ?, decision_by = ?, decision_reason = ? WHERE org_id = ? AND document_type = 'quotation' AND document_id = ? AND version = ?", [input.approve ? "queued" : "rejected", u.ctx.userId, input.reason, u.ctx.orgId, q.id, version]);
  return { ok: true };
})));
crmRouter.post("/distribution/:type/:id/:version/retry", h(req => write(req, async u => {
  requirePerm(u.ctx, "approveQuotationRevision", "Only Owner or Manager can retry delivery");
  const type = String(req.params.type), id = String(req.params.id);
  const doc = await source(u, type, id);
  const version = z.coerce.number().int().positive().parse(req.params.version);
  const row = await one(u.conn, "SELECT * FROM document_distributions WHERE org_id = ? AND document_type = ? AND document_id = ? ORDER BY version DESC LIMIT 1 FOR UPDATE", [u.ctx.orgId, type, id]);
  if (!row || row.version !== version || !["blocked", "failed"].includes(row.status) || doc.status === "cancelled") throw new ApiError(409, "invalid_status", "Only current blocked or definitely failed deliveries can be retried");
  if (type === "quotation" && version > 1 && !row.decision_by) throw new ApiError(409, "approval_required", "Approval is required");
  await exec(u.conn, "UPDATE document_distributions SET status = 'queued', error_code = NULL, provider_id = NULL WHERE org_id = ? AND document_type = ? AND document_id = ? AND version = ?", [u.ctx.orgId, type, id, version]);
  return { ok: true };
})));
crmRouter.get("/parties/:id/crm", h(req => read(req, async u => {
  requirePerm(u.ctx, "customerHistory", "Your role cannot view full customer history");
  const customer = await u.party(String(req.params.id));
  if (!customer || !["customer", "both"].includes(customer.kind)) throw new ApiError(404, "not_found", "Customer not found");
  const prefs = await one(u.conn, "SELECT enabled, phone, evidence FROM customer_communication_preferences WHERE org_id = ? AND customer_id = ?", [u.ctx.orgId, customer.id]);
  const messages = await rows(u.conn, "SELECT document_type, document_id, version, status, created_at, error_code FROM document_distributions WHERE org_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT 200", [u.ctx.orgId, customer.id]);
  return { customer, preferences: { enabled: !!prefs?.enabled, phone: prefs?.phone ?? "", evidence: prefs?.evidence ?? "" },
    quotations: await u.docs_("quotations", "party_id = ?", [customer.id]), orders: await u.docs_("salesOrders", "party_id = ?", [customer.id]),
    invoices: await u.docs_("invoices", "party_id = ?", [customer.id]), deliveries: await u.docs_("challans", "party_id = ?", [customer.id]), receipts: await u.docs_("receipts", "party_id = ?", [customer.id]),
    messages: messages.map(r => ({ documentType: r.document_type, documentId: r.document_id, version: r.version, status: r.status, createdAt: String(r.created_at), error: r.error_code })) };
})));
crmRouter.put("/parties/:id/communication", h(req => write(req, async u => {
  requirePerm(u.ctx, "approveQuotationRevision", "Only Owner or Manager can record communication consent");
  const customer = await u.party(String(req.params.id));
  if (!customer || !["customer", "both"].includes(customer.kind)) throw new ApiError(404, "not_found", "Customer not found");
  const p = z.object({ enabled: z.boolean(), phone: z.string().max(30), evidence: z.string().trim().min(3).max(500) }).strict().parse(req.body);
  if (p.enabled && !normalizeWhatsappPhone(p.phone)) throw new ApiError(422, "validation", "Use an international number such as +919876543210");
  await exec(u.conn, "INSERT INTO customer_communication_preferences (org_id, customer_id, enabled, phone, evidence, recorded_by) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), phone=VALUES(phone), evidence=VALUES(evidence), recorded_by=VALUES(recorded_by)", [u.ctx.orgId, customer.id, p.enabled, p.phone, p.evidence, u.ctx.userId]);
  await exec(u.conn, "INSERT INTO customer_communication_events (org_id, customer_id, enabled, phone, evidence, recorded_by) VALUES (?,?,?,?,?,?)", [u.ctx.orgId, customer.id, p.enabled, p.phone, p.evidence, u.ctx.userId]);
  return { ok: true };
})));
crmRouter.get("/invoices/:id/sources", h(req => read(req, async u => {
  requirePerm(u.ctx, "issueInvoice", "Your role cannot view invoices");
  const inv = await u.doc("invoices", String(req.params.id));
  if (!inv) throw new ApiError(404, "not_found", "Invoice not found");
  if (inv.sources) return inv.sources;
  const sources = [];
  for (const ref of inv.challans) {
    const c = await u.doc("challans", ref.id);
    if (!c) continue;
    for (const l of c.lines) for (const a of l.allocations) sources.push({ itemId: l.itemId, itemName: l.itemName, qty: a.qty, uom: l.uom, warehouseId: c.godownId, warehouseName: c.godownName, challanId: c.id, challanNumber: c.number, batchNo: a.batchNo ?? "" });
  }
  return sources;
})));
