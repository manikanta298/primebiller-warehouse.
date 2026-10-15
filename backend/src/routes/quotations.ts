import { one, exec } from "../db.js";
import { Router } from "express";
import { z } from "zod";
import { h, read, write } from "../http.js";
import { requirePerm } from "../auth.js";
import { ApiError } from "../errors.js";
import { today, nowIso } from "../config.js";
import { newId } from "../uow.js";
import type { Uow } from "../uow.js";
import { computeTotals, supplyType } from "../shared/gst.js";
import { orderCustomerEligible } from "../shared/sales-order-rules.js";
import { quotationProblems, quotationActionProblem } from "../shared/quotation-rules.js";
import type { Quotation, SalesOrder } from "../shared/types.js";

export const quotationRouter = Router();
const inputSchema = z.object({
  id: z.string().optional(), date: z.string().max(10), validUntil: z.string().max(10),
  customerId: z.string().min(1).max(40), godownId: z.string().max(40).default(""),
  notes: z.string().max(2000), terms: z.string().max(2000),
  lines: z.array(z.object({ itemId: z.string().min(1).max(40), itemName: z.string().max(200), hsn: z.string().max(8), uom: z.string().max(12), qty: z.number().finite(), rate: z.number().finite(), discountPct: z.number().finite(), gstRate: z.number().finite() }).strict()).min(1).max(200),
}).strict();
// Relax only business completeness, not field types/size limits. No counters or stock writes.
const draftInputSchema = inputSchema.extend({
  customerId: z.string().max(40),
  lines: inputSchema.shape.lines.element.extend({ itemId: z.string().max(40) }).array().max(200),
});
const draftKey = (key: unknown) => z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/).parse(key);
async function draftRow(u: Uow, key: string, lock = false) {
  if (key !== "new") {
    const q = await u.doc("quotations", key);
    if (!q) throw new ApiError(404, "not_found", "Quotation not found");
    if (lock && q.status !== "draft") throw new ApiError(409, "invalid_status", "Only draft quotations can be edited");
  }
  const params = [u.ctx.orgId, u.ctx.userId, key];
  if (lock) await exec(u.conn, "INSERT IGNORE INTO quotation_drafts (org_id, user_id, draft_key, version, body) VALUES (?,?,?,0,NULL)", params);
  return one(u.conn, `SELECT version, body FROM quotation_drafts WHERE org_id = ? AND user_id = ? AND draft_key = ?${lock ? " FOR UPDATE" : ""}`, params);
}
quotationRouter.get("/quotation-drafts/:key", h(req => read(req, async u => {
  requirePerm(u.ctx, "salesOrders", "Your role cannot edit quotations");
  const row = await draftRow(u, draftKey(req.params["key"]));
  return { version: Number(row?.["version"] ?? 0), input: row?.["body"] ? (typeof row["body"] === "string" ? JSON.parse(row["body"]) : row["body"]) : null };
})));
quotationRouter.put("/quotation-drafts/:key", h(req => write(req, async u => {
  requirePerm(u.ctx, "salesOrders", "Your role cannot edit quotations");
  const key = draftKey(req.params["key"]);
  const { version, input } = z.object({ version: z.number().int().nonnegative(), input: draftInputSchema }).strict().parse(req.body);
  if ((input.id ?? "new") !== key) throw new ApiError(422, "validation", "Draft ID does not match the URL");
  const row = await draftRow(u, key, true);
  if (Number(row!["version"]) !== version) throw new ApiError(409, "draft_conflict", "This draft changed in another tab. Reopen it before editing.");
  await exec(u.conn, "UPDATE quotation_drafts SET version = version + 1, body = ? WHERE org_id = ? AND user_id = ? AND draft_key = ?", [JSON.stringify(input), u.ctx.orgId, u.ctx.userId, key]);
  return { version: version + 1, input };
})));
quotationRouter.get("/quotation-defaults", h(req => read(req, async u => {
  const row = await one(u.conn, "SELECT body FROM org_settings WHERE org_id = ?", [u.ctx.orgId]);
  const settings = row ? (typeof row["body"] === "string" ? JSON.parse(row["body"]) : row["body"]) : {};
  return { terms: settings.quotationTerms ?? "", notes: settings.quotationNotes ?? "" };
})));
quotationRouter.get("/quotations", h(req => read(req, u => u.docs_("quotations"))));
quotationRouter.get("/quotations/:id", h(req => read(req, async u => {
  const q = await u.doc("quotations", String(req.params["id"]));
  if (!q) throw new ApiError(404, "not_found", "Quotation not found");
  return q;
})));
const save = h(req => write(req, async u => {
  requirePerm(u.ctx, "salesOrders", "Your role cannot create quotations");
  if (req.body?.id && req.body.id !== req.params["id"]) throw new ApiError(422, "validation", "Quotation ID does not match the URL");
  const { draftVersion, ...body } = z.object({ draftVersion: z.number().int().nonnegative().optional() }).passthrough().parse(req.body);
  const input = inputSchema.parse({ ...body, id: req.params["id"] });
  const problems = quotationProblems(input, today());
  if (problems.length) throw new ApiError(422, "validation", problems[0]!, problems);
  const previous = input.id ? await u.doc("quotations", input.id) : undefined;
  if (input.id && !previous) throw new ApiError(404, "not_found", "Quotation not found");
  if (previous && previous.status !== "draft") throw new ApiError(409, "invalid_status", "Only draft quotations can be edited");
  if (draftVersion !== undefined) {
    const row = await draftRow(u, input.id ?? "new", true);
    if (Number(row!["version"]) !== draftVersion) throw new ApiError(409, "draft_conflict", "This draft changed in another tab. Reopen it before saving.");
    // Keep a tombstone/version so a stale tab cannot recreate an already-saved draft.
    await exec(u.conn, "UPDATE quotation_drafts SET version = version + 1, body = NULL WHERE org_id = ? AND user_id = ? AND draft_key = ?", [u.ctx.orgId, u.ctx.userId, input.id ?? "new"]);
  }
  const cust = await u.party(input.customerId);
  if (!cust || !orderCustomerEligible(cust.kind, !!cust.blocked)) throw new ApiError(422, "validation", "Choose an active customer");
  const godown = input.godownId ? await u.godown(input.godownId) : undefined;
  if (input.godownId && !godown?.active) throw new ApiError(422, "validation", "Choose an active warehouse");
  const lines = [];
  for (const [index, l] of input.lines.entries()) {
    const it = await u.item(l.itemId);
    if (!it.active || l.uom !== it.baseUom) throw new ApiError(422, "validation", "Select an active item using its base unit");
    lines.push({ ...l, id: newId(`ql${index}`), deliveredQty: 0, itemName: it.name, hsn: it.hsn, gstRate: it.gstRate, uom: it.baseUom });
  }
  const q: Quotation = {
    id: previous?.id ?? newId("qt"), number: previous?.number ?? await u.nextQuotation(input.date),
    date: input.date, validUntil: input.validUntil, terms: input.terms, notes: input.notes,
    customerId: cust.id, customerName: cust.name, placeOfSupplyCode: cust.stateCode, placeOfSupplyName: cust.stateName,
    godownId: godown?.id ?? "", status: "draft", lines, grandTotal: computeTotals(lines, supplyType(u.ctx.orgStateCode, cust.stateCode)).grandTotal,
    supply: supplyType(u.ctx.orgStateCode, cust.stateCode),
    linked: [], payments: [], createdBy: previous?.createdBy ?? u.ctx.userName, createdAt: previous?.createdAt ?? nowIso(),
  };
  u.put("quotations", q);
  return q;
}));
quotationRouter.post("/quotations", save);
quotationRouter.put("/quotations/:id", save);
for (const action of ["issue", "accept", "cancel", "convert"] as const) {
  quotationRouter.post(`/quotations/:id/${action}`, h(req => write(req, async u => {
    requirePerm(u.ctx, "salesOrders", "Your role cannot change quotations");
    const conversion = action === "convert" ? z.object({ godownId: z.string().min(1).max(40).optional() }).strict().parse(req.body ?? {}) : (z.object({}).strict().parse(req.body ?? {}), { godownId: undefined });
    const q = await u.doc("quotations", String(req.params["id"]));
    if (!q) throw new ApiError(404, "not_found", "Quotation not found");
    if (action === "convert" && q.salesOrderId) {
      const existing = await u.doc("salesOrders", q.salesOrderId);
      if (!existing) throw new ApiError(409, "invalid_order", "Linked order is missing");
      return existing; // Locked quote makes retry/concurrent conversion idempotent.
    }
    if (action === "cancel") {
      if (!["draft", "issued", "accepted"].includes(q.status) || q.payments.length) throw new ApiError(409, "invalid_status", "Cannot cancel a converted quotation or one with recorded advances");
      q.status = "cancelled";
    } else {
      const problem = quotationActionProblem(q, action, today());
      if (problem) throw new ApiError(409, "invalid_status", problem);
      if (action === "issue") q.status = "issued";
      if (action === "accept") { q.status = "accepted"; q.acceptedAt = nowIso(); q.acceptedBy = u.ctx.userName; }
      if (action === "convert") {
        const cust = await u.party(q.customerId);
        if (!cust || !orderCustomerEligible(cust.kind, !!cust.blocked)) throw new ApiError(422, "validation", "Customer is unavailable or blocked");
        const godownId = conversion.godownId ?? q.godownId;
        if (!godownId || !(await u.godown(godownId))?.active) throw new ApiError(422, "validation", "Warehouse is inactive");
        for (const l of q.lines) {
          const it = await u.item(l.itemId);
          if (!it.active || it.baseUom !== l.uom || it.hsn !== l.hsn || it.gstRate !== l.gstRate) throw new ApiError(409, "item_changed", "Item tax or unit details changed; create a new quotation");
        }
        if (cust.stateCode !== q.placeOfSupplyCode || supplyType(u.ctx.orgStateCode, cust.stateCode) !== q.supply) throw new ApiError(409, "customer_changed", "Customer state changed; create a new quotation");
        const o: SalesOrder = {
          id: newId("so"), number: null, date: today(), customerId: q.customerId, customerName: q.customerName,
          placeOfSupplyCode: q.placeOfSupplyCode, placeOfSupplyName: q.placeOfSupplyName, godownId,
          status: "draft", notes: [q.notes, q.terms].filter(Boolean).join("\n").slice(0, 2000),
          lines: q.lines.map(l => ({ ...l, id: newId("sol"), deliveredQty: 0 })), grandTotal: q.grandTotal,
          quotationId: q.id, quotationNumber: q.number,
          linked: q.payments.map(p => ({ type: "receipt", number: p.receiptNo, date: p.date, status: "Advance", amount: p.amount })),
        };
        for (const p of q.payments) {
          const a = await u.doc("advances", p.advanceId);
          const receipt = await u.doc("receipts", p.receiptId);
          if (!a || !receipt || a.customerId !== q.customerId || a.quotationId !== q.id) throw new ApiError(409, "invalid_advance", "Quotation advance is missing or mismatched");
          a.salesOrderId = o.id; receipt.salesOrderId = o.id;
          u.put("advances", a); u.put("receipts", receipt);
        }
        q.acceptedAt ??= nowIso(); q.acceptedBy ??= u.ctx.userName;
        q.status = "converted"; q.salesOrderId = o.id;
        u.put("quotations", q); u.put("salesOrders", o);
        return o;
      }
    }
    u.put("quotations", q);
    return q;
  })));
}
