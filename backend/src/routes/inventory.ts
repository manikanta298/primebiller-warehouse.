/** Purchase orders, goods receipts, transfers, adjustments, stock ledger and alerts. */
import { Router } from "express";
import { z } from "zod";
import { exec, rows } from "../db.js";
import { ApiError } from "../errors.js";
import { h, read, str, write } from "../http.js";
import { requirePerm } from "../auth.js";
import { nowIso, today } from "../config.js";
import { newId, rowToGodown, type Uow } from "../uow.js";
import { loadItems } from "./core.js";
import { computeTotals, supplyType } from "../shared/gst.js";
import { apportionFreight, poStatus, weightedAverageCost, poDraftProblems, poWorkflowProblems } from "../shared/purchase-rules.js";
import { grnDraftProblems, invoiceKey } from "../shared/grn-rules.js";
import { receivedStatus, receiveProblems, transferDraftProblems } from "../shared/transfer-rules.js";
import { adjustmentDraftProblems, adjustmentValue, needsApproval, reasonLabel } from "../shared/adjustment-rules.js";
import { buildLedger, computeAlerts } from "../shared/stock-rules.js";
import type { Adjustment, Grn, GrnLine, Item, LedgerEntry, PurchaseOrder, Transfer } from "../shared/types.js";

export const inventoryRouter = Router();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------- Purchase orders ----------
inventoryRouter.get("/purchase-orders", h((req) => read(req, (u) => {
  requirePerm(u.ctx, "postGrn", "Your role cannot view purchase orders");
  return u.docs_("pos", "1=1", [], "number DESC");
})));
inventoryRouter.get("/purchase-orders/:id", h((req) => read(req, async (u) => {
  requirePerm(u.ctx, "postGrn", "Your role cannot view purchase orders");
  const po = await u.doc("pos", String(req.params["id"]));
  if (!po) throw new ApiError(404, "not_found", "Purchase order not found");
  return po;
})));
inventoryRouter.post("/purchase-orders", h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "raisePO", "Only Owner or Manager can raise purchase orders");
  const input = z.object({ date, supplierId: z.string(), godownId: z.string(), notes: z.string().default(""), draft: z.boolean().optional(),
    lines: z.array(z.object({ itemId: z.string(), qty: z.number(), rate: z.number() })).min(1).max(200) }).strict().parse(req.body);
  const sup = await u.party(input.supplierId);
  const g = await u.godown(input.godownId);
  const catalog = [];
  for (const l of input.lines) {
    const it = await u.item(l.itemId);
    catalog.push(it);
  }
  const errors = poDraftProblems(input, sup, g, catalog, today());
  if (errors.length) throw new ApiError(422, "invalid_po", errors[0]!);
  const lines = [];
  for (const [n, l] of input.lines.entries()) {
    const it = catalog[n]!;
    lines.push({ id: `l${Date.now()}${n}`, itemId: it.id, itemName: it.name, hsn: it.hsn, uom: it.baseUom, gstRate: it.gstRate, qty: l.qty, receivedQty: 0, rate: l.rate });
  }
  const { number } = await u.next("PO", input.date);
  const po: PurchaseOrder = {
    id: newId("po"), number, date: input.date, supplierId: sup!.id, supplierName: sup!.name, godownId: g!.id, godownName: g!.name, status: input.draft ? "draft" : "open", lines,
    notes: input.notes, grns: [], createdBy: u.ctx.userName,
    ...(input.draft ? {} : { approvedBy: u.ctx.userName }),
    grandTotal: computeTotals(lines.map((l) => ({ ...l, discountPct: 0 })), supplyType(u.ctx.orgStateCode, sup!.stateCode)).grandTotal,
  };
  u.put("pos", po);
  return po;
})));
inventoryRouter.post("/purchase-orders/:id/approve", h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "raisePO", "Only Owner or Manager can approve purchase orders");
  const po = await u.doc("pos", String(req.params["id"]));
  if (!po) throw new ApiError(404, "not_found", "Purchase order not found");
  const errors = poWorkflowProblems(po, "approve");
  if (errors.length) throw new ApiError(409, "invalid_status", errors[0]!);
  po.status = "open";
  po.approvedBy = u.ctx.userName;
  u.put("pos", po);
  return po;
})));
inventoryRouter.post("/purchase-orders/:id/cancel", h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "raisePO", "Only Owner or Manager can cancel purchase orders");
  const { reason } = z.object({ reason: z.string().max(500) }).strict().parse(req.body);
  const po = await u.doc("pos", String(req.params["id"]));
  if (!po) throw new ApiError(404, "not_found", "Purchase order not found");
  const errors = poWorkflowProblems(po, "cancel", reason);
  if (errors.length) throw new ApiError(409, "invalid_status", errors[0]!);
  po.status = "cancelled";
  po.cancellationReason = reason.trim();
  po.cancelledBy = u.ctx.userName;
  u.put("pos", po);
  return po;
})));

// ---------- Goods receipts ----------
inventoryRouter.get("/grns", h((req) => read(req, (u) => {
  requirePerm(u.ctx, "postGrn", "Your role cannot view goods receipts");
  return u.docs_("grns", "1=1", [], "number DESC");
})));
inventoryRouter.get("/grns/:id", h((req) => read(req, async (u) => {
  requirePerm(u.ctx, "postGrn", "Your role cannot view goods receipts");
  const g = await u.doc("grns", String(req.params["id"]));
  if (!g) throw new ApiError(404, "not_found", "GRN not found");
  return g;
})));
inventoryRouter.post("/grns", h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "postGrn", "Your role cannot post GRNs");
  const input = z.object({
    date, supplierId: z.string(), poId: z.string().optional(), supplierInvoiceNo: z.string().max(100), supplierInvoiceDate: date, godownId: z.string(),
    vehicleNo: z.string().max(32).default(""), freight: z.number(),
    lines: z.array(z.object({ poLineId: z.string().optional(), itemId: z.string(), received: z.number(), rejected: z.number(), rate: z.number(),
      batchNo: z.string().max(100).optional(), mfgDate: z.string().optional(), expiryDate: z.string().optional(), rejectionReason: z.string().max(500).optional() }).strict()).min(1).max(200),
  }).strict().parse(req.body);
  const sup = await u.party(input.supplierId);
  const g = await u.godown(input.godownId);
  const po = input.poId ? await u.doc("pos", input.poId) : undefined;
  if (input.poId && !po) throw new ApiError(404, "not_found", "Purchase order not found");
  const catalog: Item[] = [];
  for (const l of input.lines) {
    const it = await u.item(l.itemId);
    if (!catalog.some((x) => x.id === it.id)) catalog.push(it);
  }
  const earlier = await u.docs_("grns");
  const problems = grnDraftProblems(input, sup, g, catalog, po, today(), earlier);
  if (problems.length) throw new ApiError(422, "invalid_grn", problems[0]!);
  // The unique primary key is the final authority under concurrent requests;
  // insertion and document/stock posting share one transaction.
  const grnId = newId("grn");
  try {
    await exec(u.conn, "INSERT INTO grn_invoice_registry (org_id, supplier_id, invoice_key, grn_id) VALUES (?,?,?,?)",
      [u.ctx.orgId, sup!.id, invoiceKey(input.supplierInvoiceNo), grnId]);
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY")
      throw new ApiError(409, "duplicate_invoice", "This supplier invoice has already been received");
    throw error;
  }
  const lines = input.lines;
  const shares = apportionFreight(lines.map((l) => (l.received - l.rejected) * l.rate), input.freight);
  const { number } = await u.next("GRN", input.date);
  const at = nowIso().slice(0, 16);
  const gl: GrnLine[] = [];
  for (const [n, l] of lines.entries()) {
    const it = catalog.find((x) => x.id === l.itemId)!;
    const accepted = l.received - l.rejected;
    const landed = accepted > 0 ? Math.round((l.rate + shares[n]! / accepted) * 100) / 100 : l.rate;
    const bn = l.batchNo?.trim();
    if (accepted > 0) {
      const totalQty = it.stock.reduce((a, x) => a + x.onHand, 0);
      it.costPrice = weightedAverageCost(totalQty, it.costPrice, accepted, landed);
      moveStock(it, g.id, accepted, bn, input.date, { mfgDate: l.mfgDate || input.date, expiryDate: l.expiryDate });
      u.ledger({ at, docNo: number, docType: "grn", type: "PURCHASE_IN", itemId: it.id, itemName: it.name, godownId: g.id, godownName: g.name, ...(bn ? { batchNo: bn } : {}), qty: accepted, unitCost: landed, user: u.ctx.userName });
    }
    const pl = po?.lines.find((x) => x.id === l.poLineId);
    if (pl) pl.receivedQty += l.received;
    gl.push({ poLineId: l.poLineId, itemId: it.id, itemName: it.name, hsn: it.hsn, uom: it.baseUom, gstRate: it.gstRate, ordered: pl?.qty, received: l.received, accepted,
      rejected: l.rejected, rate: l.rate, batchNo: bn || undefined, mfgDate: l.mfgDate || undefined, expiryDate: l.expiryDate || undefined,
      rejectionReason: l.rejectionReason || undefined, freightShare: shares[n]!, landedCost: landed });
  }
  const t = computeTotals(gl.map((l) => ({ qty: l.accepted, rate: l.rate, discountPct: 0, gstRate: l.gstRate })), supplyType(u.ctx.orgStateCode, sup.stateCode));
  const grn: Grn = {
    id: grnId, number, date: input.date, supplierId: sup.id, supplierName: sup.name, poId: po?.id, poNumber: po?.number,
    supplierInvoiceNo: input.supplierInvoiceNo.trim(), supplierInvoiceDate: input.supplierInvoiceDate, godownId: g.id, godownName: g.name,
    vehicleNo: input.vehicleNo.trim().toUpperCase(), freight: input.freight, lines: gl, taxable: t.taxable, tax: t.cgst + t.sgst + t.igst,
    grandTotal: Math.round(t.taxable + t.cgst + t.sgst + t.igst + input.freight), createdBy: u.ctx.userName,
  };
  if (po) { po.status = poStatus(po.lines); po.grns.push({ id: grn.id, number, date: input.date }); u.put("pos", po); }
  sup.outstanding += grn.grandTotal;
  u.touchParty(sup);
  u.put("grns", grn);
  return grn;
})));

// ---------- Stock movement helpers ----------
function moveStock(it: Item, godownId: string, qty: number, batchNo?: string, receivedDate?: string, dates?: { mfgDate?: string | undefined; expiryDate?: string | undefined }) {
  let st = it.stock.find((x) => x.godownId === godownId);
  if (!st) { st = { godownId, onHand: 0, held: 0, reorderLevel: 0, maxLevel: 0 }; it.stock.push(st); }
  st.onHand += qty;
  if (!batchNo) return;
  const b = it.batches.find((x) => x.batchNo === batchNo && x.godownId === godownId);
  if (b) b.qty += qty;
  else if (qty > 0) {
    const src = it.batches.find((x) => x.batchNo === batchNo);
    const d = receivedDate ?? today();
    const expiry = dates?.expiryDate ?? src?.expiryDate;
    it.batches.push({ id: newId("b"), batchNo, godownId, qty, mfgDate: dates?.mfgDate ?? src?.mfgDate ?? d, receivedDate: src?.receivedDate ?? d, ...(expiry ? { expiryDate: expiry } : {}) });
  }
}

function stockLedger(u: Uow, docNo: string, it: Item, godownId: string, godownName: string, type: LedgerEntry["type"], qty: number, unitCost: number, batchNo?: string, reason?: string) {
  u.ledger({ at: nowIso().slice(0, 16), docNo, docType: type.startsWith("ADJ") ? "adjustment" : "transfer", type, itemId: it.id, itemName: it.name, godownId, godownName,
    ...(batchNo ? { batchNo } : {}), qty, unitCost, user: u.ctx.userName, ...(reason ? { reason } : {}) });
}

// ---------- Stock transfers ----------
inventoryRouter.get("/transfers", h((req) => read(req, (u) => {
  requirePerm(u.ctx, "transfer", "Your role cannot view transfers");
  const s = str(req.query["status"]);
  return s && s !== "all" ? u.docs_("transfers", "status = ?", [s], "number DESC") : u.docs_("transfers", "1=1", [], "number DESC");
})));
inventoryRouter.get("/transfers/:id", h((req) => read(req, async (u) => {
  requirePerm(u.ctx, "transfer", "Your role cannot view transfers");
  const t = await u.doc("transfers", String(req.params["id"]));
  if (!t) throw new ApiError(404, "not_found", "Transfer not found");
  return t;
})));
inventoryRouter.post("/transfers", h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "transfer", "Your role cannot create transfers");
  const input = z.object({ date, fromId: z.string(), toId: z.string(), vehicleNo: z.string().default(""), reason: z.string().default(""),
    lines: z.array(z.object({ itemId: z.string(), batchNo: z.string().optional(), qty: z.number() }).strict()).min(1).max(200) }).strict().parse(req.body);
  const from = await u.godown(input.fromId);
  const to = await u.godown(input.toId);
  // Lock items in a stable order to avoid deadlocks when two dispatches share items.
  const items = new Map<string, Item>();
  for (const id of [...new Set(input.lines.map((l) => l.itemId))].sort()) items.set(id, await u.item(id));
  const checks = input.lines.map((l) => {
    const it = items.get(l.itemId)!;
    const st = it.stock.find((x) => x.godownId === input.fromId);
    const b = l.batchNo ? it.batches.find((x) => x.batchNo === l.batchNo && x.godownId === input.fromId) : undefined;
    return { itemId: it.id, itemName: it.name, active: it.active, qty: l.qty, free: st ? st.onHand - st.held : 0,
      trackBatches: it.trackBatches, batchNo: l.batchNo, batchQty: b?.qty };
  });
  const problems = transferDraftProblems(input, from, to, today(), checks);
  if (problems.length) throw new ApiError(422, "invalid_transfer", problems[0]!);
  const { number } = await u.next("TRF", input.date);
  const lines = input.lines.map((l) => {
    const it = items.get(l.itemId)!;
    return { itemId: it.id, itemName: it.name, uom: it.baseUom, batchNo: l.batchNo?.trim() || undefined, qty: l.qty, unitCost: it.costPrice };
  });
  const t: Transfer = {
    id: newId("trf"), number, date: input.date, fromId: from!.id, fromName: from!.name, toId: to!.id, toName: to!.name,
    status: "in_transit", vehicleNo: input.vehicleNo.trim().toUpperCase(), reason: input.reason.trim(), lines,
    value: lines.reduce((a, l) => a + l.qty * l.unitCost, 0),
    events: [{ at: nowIso(), label: "Dispatched", by: u.ctx.userName }],
  };
  for (const l of lines) {
    const it = items.get(l.itemId)!;
    moveStock(it, t.fromId, -l.qty, l.batchNo);
    stockLedger(u, t.number, it, t.fromId, t.fromName, "TRANSFER_OUT", -l.qty, l.unitCost, l.batchNo);
  }
  u.put("transfers", t);
  return t;
})));
inventoryRouter.post("/transfers/:id/receive", h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "transfer", "Your role cannot receive transfers");
  const input = z.object({ lines: z.array(z.object({ received: z.number(), reason: z.string().optional() }).strict()).min(1).max(200) }).strict().parse(req.body);
  const t = await u.doc("transfers", String(req.params["id"]));
  if (!t) throw new ApiError(404, "not_found", "Transfer not found");
  if (t.status !== "in_transit") throw new ApiError(409, "invalid_status", "Only transfers in transit can be received");
  const rowsIn = input.lines.map((r, n) => ({ itemName: t.lines[n]?.itemName ?? `Line ${n + 1}`, sent: t.lines[n]?.qty ?? 0, received: r.received, reason: r.reason }));
  const problems = receiveProblems(rowsIn, t.lines.length);
  if (problems.length) throw new ApiError(422, "invalid_receive", problems[0]!);
  // A posted receipt is final; shortages are recorded as transit loss, not pending stock.
  for (const id of [...new Set(t.lines.map((l) => l.itemId))].sort()) await u.item(id);
  for (const [n, l] of t.lines.entries()) {
    const r = rowsIn[n]!;
    const it = await u.item(l.itemId);
    l.receivedQty = r.received;
    moveStock(it, t.toId, l.qty, l.batchNo, t.date);
    stockLedger(u, t.number, it, t.toId, t.toName, "TRANSFER_IN", l.qty, l.unitCost, l.batchNo);
    if (r.received < l.qty) {
      l.shortReason = r.reason?.trim();
      moveStock(it, t.toId, -(l.qty - r.received), l.batchNo);
      stockLedger(u, t.number, it, t.toId, t.toName, "ADJ_OUT", -(l.qty - r.received), l.unitCost, l.batchNo, `TRANSIT_LOSS: ${l.shortReason}`);
    }
  }
  t.status = receivedStatus(rowsIn);
  const short = rowsIn.reduce((a, r) => a + (r.sent - r.received), 0);
  t.events.push({ at: nowIso(), label: short ? "Received with shortage" : "Received in full", by: u.ctx.userName,
    note: short ? `${short} written off as transit loss` : undefined });
  u.put("transfers", t);
  return t;
})));
inventoryRouter.post("/transfers/:id/cancel", h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "cancelTransfer", "Only Owner or Manager can cancel transfers");
  const { reason } = z.object({ reason: z.string().trim().min(1).max(500) }).strict().parse(req.body ?? {});
  const t = await u.doc("transfers", String(req.params["id"]));
  if (!t) throw new ApiError(404, "not_found", "Transfer not found");
  if (t.status !== "in_transit") throw new ApiError(409, "invalid_status", "Only transfers in transit can be cancelled");
  for (const id of [...new Set(t.lines.map((l) => l.itemId))].sort()) await u.item(id);
  for (const l of t.lines) {
    const it = await u.item(l.itemId);
    moveStock(it, t.fromId, l.qty, l.batchNo);
    stockLedger(u, t.number, it, t.fromId, t.fromName, "TRANSFER_IN", l.qty, l.unitCost, l.batchNo, "Transfer cancelled");
  }
  t.status = "cancelled";
  t.events.push({ at: nowIso(), label: "Cancelled · stock returned to source", by: u.ctx.userName, note: reason });
  u.put("transfers", t);
  return t;
})));

// ---------- Adjustments ----------
async function adjChecks(u: Uow, godownId: string, lines: { itemId: string; batchNo?: string | undefined; direction: "up" | "down"; qty: number; unitCost: number }[]) {
  // Lock all items in a consistent order before checking available stock; the
  // same item can occur on multiple lines, including different batches.
  const items = new Map<string, Item>();
  for (const id of [...new Set(lines.map((l) => l.itemId))].sort()) items.set(id, await u.item(id));
  return lines.map((l) => {
    const it = items.get(l.itemId)!;
    const stock = it.stock.find((x) => x.godownId === godownId);
    const batch = l.batchNo ? it.batches.find((x) => x.batchNo === l.batchNo.trim() && x.godownId === godownId) : undefined;
    return { itemId: it.id, itemName: it.name, active: it.active, direction: l.direction, qty: l.qty,
      onHand: stock?.onHand ?? 0, held: stock?.held ?? 0, unitCost: l.direction === "up" ? l.unitCost : it.costPrice,
      trackBatches: it.trackBatches, batchNo: l.batchNo, batchQty: batch?.qty };
  });
}
async function postAdjustment(u: Uow, a: Adjustment) {
  for (const l of a.lines) {
    const it = await u.item(l.itemId);
    // Reductions use the current weighted-average cost, including approvals
    // posted after other stock movements have changed that cost.
    if (l.direction === "down") l.unitCost = it.costPrice;
    if (l.direction === "up") it.costPrice = weightedAverageCost(it.stock.reduce((x, y) => x + y.onHand, 0), it.costPrice, l.qty, l.unitCost);
    const q = l.direction === "up" ? l.qty : -l.qty;
    moveStock(it, a.godownId, q, l.batchNo, a.date);
    stockLedger(u, a.number, it, a.godownId, a.godownName, l.direction === "up" ? "ADJ_IN" : "ADJ_OUT", q, l.unitCost, l.batchNo, reasonLabel(a.reason) + (a.notes ? `: ${a.notes}` : ""));
  }
  const totals = adjustmentValue(a.lines);
  a.valueUp = totals.up; a.valueDown = totals.down;
  a.status = "posted";
}
async function approvalLimit(u: Uow) {
  const r = await rows(u.conn, "SELECT body FROM org_settings WHERE org_id = ?", [u.ctx.orgId]);
  const b = r[0] ? (typeof r[0]["body"] === "string" ? JSON.parse(r[0]["body"]) : r[0]["body"]) : {};
  return Number(b.adjApprovalLimit ?? 25000);
}

inventoryRouter.get("/adjustments", h((req) => read(req, (u) => {
  requirePerm(u.ctx, "adjust", "Your role cannot view adjustments");
  const s = str(req.query["status"]);
  return s && s !== "all" ? u.docs_("adjustments", "status = ?", [s], "number DESC") : u.docs_("adjustments", "1=1", [], "number DESC");
})));
inventoryRouter.get("/adjustments/:id", h((req) => read(req, async (u) => {
  requirePerm(u.ctx, "adjust", "Your role cannot view adjustments");
  const a = await u.doc("adjustments", String(req.params["id"]));
  if (!a) throw new ApiError(404, "not_found", "Adjustment not found");
  return a;
})));
inventoryRouter.post("/adjustments", h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "adjust", "Your role cannot adjust stock");
  const input = z.object({
    date, godownId: z.string().min(1), reason: z.enum(["damage", "theft", "expiry", "found", "correction", "sample"]), notes: z.string().max(500).default(""),
    lines: z.array(z.object({ itemId: z.string().min(1), batchNo: z.string().max(100).optional(), direction: z.enum(["up", "down"]), qty: z.number().finite(), unitCost: z.number().finite() }).strict()).min(1).max(200),
  }).strict().parse(req.body);
  const g = await u.godown(input.godownId);
  const checks = await adjChecks(u, input.godownId, input.lines);
  const problems = adjustmentDraftProblems(input, g, today(), checks);
  if (problems.length) throw new ApiError(422, "invalid_adjustment", problems[0]!);
  const { number } = await u.next("ADJ", input.date);
  const lines = [];
  for (const l of input.lines) {
    const it = await u.item(l.itemId);
    lines.push({ itemId: it.id, itemName: it.name, uom: it.baseUom, batchNo: l.batchNo?.trim() || undefined, direction: l.direction, qty: l.qty, unitCost: l.direction === "down" ? it.costPrice : l.unitCost });
  }
  const v = adjustmentValue(lines);
  const pending = needsApproval(u.ctx.role, v.gross, await approvalLimit(u));
  const a: Adjustment = {
    id: newId("adj"), number, date: input.date, godownId: g!.id, godownName: g!.name, reason: input.reason, notes: input.notes.trim(), status: "pending_approval",
    lines, valueUp: v.up, valueDown: v.down, createdBy: u.ctx.userName, createdByRole: u.ctx.role,
    events: [{ at: nowIso(), label: pending ? "Submitted for approval" : "Created", by: u.ctx.userName }],
  };
  if (!pending) { await postAdjustment(u, a); a.events.push({ at: nowIso(), label: "Posted to stock", by: u.ctx.userName }); }
  u.put("adjustments", a);
  return a;
})));
const decide = (approve: boolean) => h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "approveAdjustment", "Only Owner or Manager can decide adjustments");
  const { note } = z.object({ note: z.string().max(500).optional() }).strict().parse(req.body ?? {});
  const a = await u.doc("adjustments", String(req.params["id"]));
  if (!a || a.status !== "pending_approval") throw new ApiError(409, "invalid_status", "Only pending adjustments can be decided");
  if (approve) {
    const godown = await u.godown(a.godownId);
    const checks = await adjChecks(u, a.godownId, a.lines);
    const problems = adjustmentDraftProblems(a, godown, today(), checks);
    if (problems.length) throw new ApiError(422, "invalid_adjustment", problems[0]!);
    await postAdjustment(u, a);
    a.events.push({ at: nowIso(), label: "Approved · posted to stock", by: u.ctx.userName, note: note?.trim() });
  } else {
    if (!note?.trim()) throw new ApiError(422, "invalid", "Give a reason for rejecting");
    a.status = "rejected";
    a.events.push({ at: nowIso(), label: "Rejected", by: u.ctx.userName, note: note.trim() });
  }
  u.put("adjustments", a);
  return a;
}));
inventoryRouter.post("/adjustments/:id/approve", decide(true));
inventoryRouter.post("/adjustments/:id/reject", decide(false));

// ---------- Stock ledger ----------
const inventoryReadRoles = ["Owner", "Manager", "Storekeeper", "Accountant"];
const alertReadRoles = ["Owner", "Manager", "Storekeeper"];
inventoryRouter.get("/stock/ledger", h((req) => read(req, async (u) => {
  if (!inventoryReadRoles.includes(u.ctx.role)) throw new ApiError(403, "forbidden", "Your role cannot view stock ledger");
  const conds = ["org_id = ?"];
  const params: unknown[] = [u.ctx.orgId];
  const itemId = str(req.query["itemId"]);
  const godownId = str(req.query["godownId"]);
  const batchNo = str(req.query["batchNo"]);
  if (itemId) {
    await u.item(itemId); // organisation-scoped lookup (404 if foreign item)
    conds.push("item_id = ?"); params.push(itemId);
  }
  if (godownId && godownId !== "all") {
    if (!await u.godown(godownId)) throw new ApiError(404, "not_found", "Godown not found in this organisation");
    conds.push("godown_id = ?"); params.push(godownId);
  }
  if (batchNo) { conds.push("batch_no = ?"); params.push(batchNo); }
  // Include ALL types/documents for each stock stream so running balances are accurate.
  // Reject oversized history instead of silently returning a misleading first 5,000.
  const result = await rows(u.conn, `SELECT * FROM stock_ledger WHERE ${conds.join(" AND ")} ORDER BY at, id LIMIT 5001`, params);
  if (result.length > 5000) throw new ApiError(422, "ledger_too_large", "Choose an item, godown or batch to narrow the ledger below 5,000 movements");
  const entries: LedgerEntry[] = result.map((x) => ({
    id: String(x["id"]), at: String(x["at"]).replace(" ", "T").slice(0, 16), docNo: x["doc_no"], docType: x["doc_type"], ...(x["so_id"] ? { soId: x["so_id"] } : {}),
    type: x["type"], itemId: x["item_id"], itemName: x["item_name"], godownId: x["godown_id"], godownName: x["godown_name"], ...(x["batch_no"] ? { batchNo: x["batch_no"] } : {}),
    qty: Number(x["qty"]), unitCost: Number(x["unit_cost"]), user: x["user_name"], ...(x["reason"] ? { reason: x["reason"] } : {}),
  }));
  return entries;
})));

// ---------- Alerts ----------
inventoryRouter.get("/alerts", h((req) => read(req, async (u) => {
  if (!alertReadRoles.includes(u.ctx.role)) throw new ApiError(403, "forbidden", "Your role cannot view stock alerts");
  const scope = str(req.query["godownId"]) ?? "all";
  if (scope !== "all" && !await u.godown(scope)) throw new ApiError(404, "not_found", "Godown not found in this organisation");
  const items = await loadItems(u.conn, u.ctx.orgId);
  const godowns = (await rows(u.conn, "SELECT * FROM godowns WHERE org_id = ?", [u.ctx.orgId])).map(rowToGodown).filter((g) => scope === "all" || g.id === scope);
  const acked = new Set((await rows(u.conn, "SELECT alert_id FROM alert_acks WHERE org_id = ?", [u.ctx.orgId])).map((r) => r["alert_id"] as string));
  return computeAlerts(items, godowns, today(), acked);
})));
const ack = async (u: Uow, ids: string[]) => {
  if (!alertReadRoles.includes(u.ctx.role)) throw new ApiError(403, "forbidden", "Your role cannot acknowledge stock alerts");
  if (!ids.length || ids.length > 500 || ids.some((id) => typeof id !== "string" || id.length > 200))
    throw new ApiError(422, "invalid_alert", "Select between 1 and 500 valid alerts");
  const items = await loadItems(u.conn, u.ctx.orgId);
  const godowns = (await rows(u.conn, "SELECT * FROM godowns WHERE org_id = ?", [u.ctx.orgId])).map(rowToGodown);
  const live = new Set(computeAlerts(items, godowns, today(), new Set()).map((alert) => alert.id));
  if (ids.some((id) => !live.has(id))) throw new ApiError(422, "invalid_alert", "A selected alert is no longer active. Refresh the list.");
  for (const id of new Set(ids))
    await exec(u.conn, "INSERT IGNORE INTO alert_acks (org_id, alert_id, acked_by) VALUES (?,?,?)", [u.ctx.orgId, id, u.ctx.userId]);
};
inventoryRouter.post("/alerts/acknowledge-all", h((req) => write(req, async (u) => {
  const { ids } = z.object({ ids: z.array(z.string()).min(1).max(500) }).strict().parse(req.body);
  await ack(u, ids);
})));
inventoryRouter.post("/alerts/:id/acknowledge", h((req) => write(req, async (u) => { await ack(u, [String(req.params["id"])]); })));
