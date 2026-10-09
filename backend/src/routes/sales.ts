/** Sales orders, delivery challans + e-way bills, tax invoices, receipts and advances. */
import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { h, read, str, write } from "../http.js";
import { requirePerm } from "../auth.js";
import { nowIso, today } from "../config.js";
import { newId, type Uow } from "../uow.js";
import { generateEwb } from "../ewb.js";
import { canOverrideCredit, computeTotals, creditCheck, ewayBillRequired, supplyType } from "../shared/gst.js";
import { canCancelTestEwb, dispatchPlanProblems, dispatchTransportProblems, ewbValidityDays, ewbValidUntil, normaliseVehicle, VEHICLE_PATTERN } from "../shared/challan-rules.js";
import { applyAdvancesOldestFirst, dueDateFor, invoiceIssueProblems, invoiceCancelProblems, invoiceStatus } from "../shared/invoice-rules.js";
import { receiptProblems, receiptAllocation, receiptPaise } from "../shared/receipt-rules.js";
import { orderCustomerEligible, orderDraftProblems, stockHoldProblems } from "../shared/sales-order-rules.js";
import type { Challan, ChallanLine, Invoice, Receipt, SalesOrder } from "../shared/types.js";

export const salesRouter = Router();
const statusFilter = (s: string | undefined) => (s && s !== "all" ? ["status = ?", [s]] as const : ["1=1", []] as const);

// ---------- Sales orders ----------
salesRouter.get("/sales-orders", h((req) => read(req, (u) => {
  const [w, p] = statusFilter(str(req.query["status"]));
  return u.docs_("salesOrders", w, [...p]);
})));
salesRouter.get("/sales-orders/:id", h((req) => read(req, async (u) => {
  const o = await u.doc("salesOrders", String(req.params["id"]));
  if (!o) throw new ApiError(404, "not_found", "Sales order not found");
  return o;
})));

const soInput = z.object({
  id: z.string().optional(), date: z.string(), customerId: z.string(), godownId: z.string(), notes: z.string().default(""),
  lines: z.array(z.object({ itemId: z.string(), itemName: z.string(), hsn: z.string(), uom: z.string(), qty: z.number(), rate: z.number(), discountPct: z.number(), gstRate: z.number() }).strict()),
}).strict();
const saveSo = h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "salesOrders", "Your role cannot change sales orders");
  if (req.params["id"] && req.body?.id && req.params["id"] !== req.body.id) throw new ApiError(422, "validation", "Order ID does not match the URL");
  if (!req.params["id"] && req.body?.id) throw new ApiError(422, "validation", "Create requests cannot specify an order ID");
  const input = soInput.parse({ ...req.body, id: req.params["id"] ?? undefined });
  const problems = orderDraftProblems(input);
  if (problems.length) throw new ApiError(422, "validation", problems[0]!, problems);
  const cust = await u.party(input.customerId);
  if (!cust) throw new ApiError(422, "validation", "Select a customer");
  if (!orderCustomerEligible(cust.kind, !!cust.blocked)) throw new ApiError(422, "blocked", `${cust.name} is not an active customer`);
  const godown = await u.godown(input.godownId);
  if (!godown?.active) throw new ApiError(422, "validation", "Select an active godown in this organisation");
  const existing = input.id ? await u.doc("salesOrders", input.id) : undefined;
  if (input.id && !existing) throw new ApiError(404, "not_found", "Sales order not found");
  if (existing && existing.status !== "draft") throw new ApiError(409, "invalid_status", "Only draft orders can be edited");
  // Quoted rates are editable; HSN, UOM and GST always come from the item master.
  const lines = [];
  for (const [i, l] of input.lines.entries()) {
    const it = await u.item(l.itemId);
    if (!it.active) throw new ApiError(422, "validation", `${it.name} is inactive`);
    if (l.uom !== it.baseUom) throw new ApiError(422, "validation", `${it.name}: use the base unit ${it.baseUom}`);
    lines.push({ ...l, itemName: it.name, hsn: it.hsn, uom: it.baseUom, gstRate: it.gstRate, id: newId(`sol${i}`), deliveredQty: 0 });
  }
  const t = computeTotals(lines, supplyType(u.ctx.orgStateCode, cust.stateCode));
  const o: SalesOrder = {
    id: existing?.id ?? newId("so"), number: null, date: input.date, customerId: cust.id, customerName: cust.name,
    placeOfSupplyCode: cust.stateCode, placeOfSupplyName: cust.stateName, godownId: input.godownId, status: "draft", notes: input.notes,
    lines, grandTotal: t.grandTotal, linked: existing?.linked ?? [],
  };
  u.put("salesOrders", o);
  return o;
}));
salesRouter.post("/sales-orders", saveSo);
salesRouter.put("/sales-orders/:id", saveSo);

salesRouter.post("/sales-orders/:id/confirm", h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "salesOrders", "Your role cannot change sales orders");
  const override = z.object({ override: z.object({ reason: z.string().trim().min(3).max(500) }).strict().optional().nullable() }).strict().parse(req.body ?? {}).override;
  const o = await u.doc("salesOrders", String(req.params["id"]));
  if (!o) throw new ApiError(404, "not_found", "Sales order not found");
  if (o.status !== "draft") throw new ApiError(409, "invalid_status", "Only draft orders can be confirmed");
  const cust = await u.party(o.customerId);
  if (!cust || !orderCustomerEligible(cust.kind, !!cust.blocked)) throw new ApiError(422, "blocked", "Customer is unavailable or blocked");
  const confirmGodown = await u.godown(o.godownId);
  if (!confirmGodown?.active) throw new ApiError(422, "validation", "The dispatch godown is inactive");
  const errors = orderDraftProblems(o);
  if (errors.length) throw new ApiError(422, "validation", errors[0]!, errors);
  // Consistent row-lock order limits deadlocks under concurrent confirmations.
  const items = [];
  for (const id of [...new Set(o.lines.map((l) => l.itemId))].sort()) items.push(await u.item(id));
  const shortages = stockHoldProblems(o.lines, o.godownId, items);
  if (shortages.length) throw new ApiError(409, "insufficient_stock", "Not enough free stock", shortages);
  for (const line of o.lines) {
    const item = items.find((it) => it.id === line.itemId)!;
    if (line.uom !== item.baseUom) throw new ApiError(422, "validation", `${item.name}: unit is no longer valid`);
  }
  const cc = creditCheck(cust.creditLimit, cust.outstanding, o.grandTotal);
  if (cc.exceeds) {
    if (!override) throw new ApiError(409, "credit_limit", "Credit limit exceeded", cc);
    if (!canOverrideCredit(u.ctx.role)) throw new ApiError(403, "forbidden", "Only an Owner can override the credit limit");
    o.creditOverride = { by: u.ctx.userName, reason: override.reason, at: today() };
  }
  for (const l of o.lines) {
    const it = await u.item(l.itemId);
    let g = it.stock.find((x) => x.godownId === o.godownId);
    if (!g) { g = { godownId: o.godownId, onHand: 0, held: 0, reorderLevel: 0, maxLevel: 0 }; it.stock.push(g); }
    g.held += l.qty;
  }
  o.number = (await u.next("SO", o.date)).number;
  o.status = "confirmed";
  u.put("salesOrders", o);
  return o;
})));

salesRouter.post("/sales-orders/:id/cancel", h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "salesOrders", "Your role cannot change sales orders");
  const o = await u.doc("salesOrders", String(req.params["id"]));
  if (!o) throw new ApiError(404, "not_found", "Sales order not found");
  if (o.status !== "draft" && o.status !== "confirmed") throw new ApiError(409, "invalid_status", "This order can no longer be cancelled");
  if (o.status === "confirmed") for (const l of o.lines) {
    const g = (await u.item(l.itemId)).stock.find((x) => x.godownId === o.godownId);
    if (g) g.held = Math.max(0, g.held - l.qty);
  }
  o.status = "cancelled";
  u.put("salesOrders", o);
  return o;
})));

// ---------- Delivery challans ----------
salesRouter.get("/challans", h((req) => read(req, async (u) => {
  const [w, p] = statusFilter(str(req.query["status"]));
  const rows = await u.docs_("challans", w, [...p], "number DESC");
  return u.ctx.role === "Driver" ? rows.filter((c) => c.driverName.toLowerCase() === u.ctx.userName.toLowerCase()) : rows;
})));
salesRouter.get("/challans/:id", h((req) => read(req, async (u) => {
  const c = await u.doc("challans", String(req.params["id"]));
  if (!c || (u.ctx.role === "Driver" && c.driverName.toLowerCase() !== u.ctx.userName.toLowerCase()))
    throw new ApiError(404, "not_found", "Challan not found");
  return c;
})));

function soStatusAfterDelivery(o: SalesOrder) {
  const sent = o.lines.reduce((a, l) => a + l.deliveredQty, 0);
  o.status = sent === 0 ? "confirmed" : o.lines.every((l) => l.deliveredQty >= l.qty) ? "delivered" : "partially_delivered";
}

async function postChallan(u: Uow, c: Challan, sign: 1 | -1) {
  const o = (await u.doc("salesOrders", c.soId))!;
  const at = nowIso().slice(0, 16);
  for (const l of c.lines) {
    const it = await u.item(l.itemId);
    const g = it.stock.find((x) => x.godownId === c.godownId);
    if (g) { g.onHand -= sign * l.qty; g.held = Math.max(0, g.held - sign * l.qty); }
    for (const a of l.allocations) {
      const b = a.batchNo ? it.batches.find((x) => x.batchNo === a.batchNo && x.godownId === c.godownId) : undefined;
      if (b) b.qty -= sign * a.qty;
      u.ledger({ at, docNo: c.number, docType: "challan", soId: c.soId, type: sign === 1 ? "DC_ISSUE" : "DC_REVERSE", itemId: it.id, itemName: it.name,
        godownId: c.godownId, godownName: c.godownName, ...(a.batchNo ? { batchNo: a.batchNo } : {}), qty: -sign * a.qty, unitCost: it.costPrice, user: u.ctx.userName });
    }
    const sl = o.lines.find((x) => x.id === l.soLineId);
    if (sl) sl.deliveredQty += sign * l.qty;
  }
  soStatusAfterDelivery(o);
  u.put("salesOrders", o);
}

async function syncSoLink(u: Uow, c: Challan) {
  const o = await u.doc("salesOrders", c.soId);
  if (!o) return;
  const label = { in_transit: "In transit", delivered: "Delivered", cancelled: "Cancelled" }[c.status];
  const ex = o.linked.find((d) => d.number === c.number);
  if (ex) ex.status = label;
  else o.linked.push({ type: "delivery_challan", number: c.number, date: c.date, status: label, amount: c.value });
  u.put("salesOrders", o);
}

const dispatchInput = z.object({
  soId: z.string().trim().min(1),
  lines: z.array(z.object({ soLineId: z.string().min(1), qty: z.number(), allocations: z.array(z.object({ batchNo: z.string().optional(), qty: z.number() }).strict()) }).strict()).min(1).max(200),
  vehicleNo: z.string(), driverName: z.string(), driverPhone: z.string().default(""), transporter: z.string().default(""),
  distanceKm: z.number(), overrideReason: z.string().optional(),
}).strict();

salesRouter.post("/challans", h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "dispatch", "Your role cannot dispatch challans");
  const input = dispatchInput.parse(req.body);
  const o = await u.doc("salesOrders", input.soId);
  if (!o) throw new ApiError(404, "not_found", "Sales order not found");
  if (o.status !== "confirmed" && o.status !== "partially_delivered") throw new ApiError(409, "invalid_status", "Only confirmed or partly delivered orders can be dispatched");
  const dispatchGodown = await u.godown(o.godownId);
  if (!dispatchGodown?.active) throw new ApiError(422, "validation", "The order's godown is unavailable or inactive");
  // Load and row-lock each item once in a deterministic order; validate all lines as a whole.
  const dispatchItems = [];
  for (const id of [...new Set(o.lines.map((l) => l.itemId))].sort()) dispatchItems.push(await u.item(id));
  const planned = dispatchPlanProblems(input.lines, o.lines, dispatchItems, o.godownId, input.overrideReason);
  if (planned.length) throw new ApiError(422, "dispatch_validation", planned[0]!, planned);
  const lines: ChallanLine[] = [];
  for (const il of input.lines.filter((l) => l.qty > 0)) {
    const sl = o.lines.find((x) => x.id === il.soLineId);
    if (!sl) throw new ApiError(422, "validation", "Unknown order line");
    const pending = sl.qty - sl.deliveredQty;
    if (il.qty > pending) throw new ApiError(422, "over_delivery", `${sl.itemName}: only ${pending} pending`);
    const allocated = il.allocations.reduce((a, x) => a + x.qty, 0);
    if (allocated !== il.qty) throw new ApiError(422, "allocation", `${sl.itemName}: batches add up to ${allocated}, need ${il.qty}`);
    const it = await u.item(sl.itemId);
    for (const a of il.allocations) {
      if (!a.batchNo) continue;
      const b = it.batches.find((x) => x.batchNo === a.batchNo && x.godownId === o.godownId);
      if (!b || b.qty < a.qty) throw new ApiError(409, "insufficient_batch", `Batch ${a.batchNo} has only ${b?.qty ?? 0} left`);
    }
    const onHand = it.stock.find((x) => x.godownId === o.godownId)?.onHand ?? 0;
    if (!it.allowNegative && il.qty > onHand) throw new ApiError(409, "insufficient_stock", `${sl.itemName}: only ${onHand} on hand`);
    lines.push({ soLineId: sl.id, itemId: sl.itemId, itemName: sl.itemName, hsn: sl.hsn, uom: sl.uom, qty: il.qty, rate: sl.rate, discountPct: sl.discountPct, gstRate: sl.gstRate,
      allocations: il.allocations.filter((a) => a.qty > 0).map((a) => (a.batchNo ? { batchNo: a.batchNo, qty: a.qty } : { qty: a.qty })) });
  }
  if (!lines.length) throw new ApiError(422, "validation", "Send at least one line");
  const t = computeTotals(lines, supplyType(u.ctx.orgStateCode, o.placeOfSupplyCode));
  const vehicleNo = normaliseVehicle(input.vehicleNo);
  const needEwb = ewayBillRequired(t.grandTotal);
  const transportIssues = dispatchTransportProblems(input, t.grandTotal);
  if (transportIssues.length) throw new ApiError(422, "transport_validation", transportIssues[0]!, transportIssues);
  const at = nowIso();
  const by = u.ctx.userName;
  const id = newId("dc");
  const { number } = await u.next("DC", at.slice(0, 10));
  const godown = await u.godown(o.godownId);
  const c: Challan = {
    id, number, date: at.slice(0, 10), soId: o.id, soNumber: o.number ?? "", customerId: o.customerId, customerName: o.customerName,
    placeOfSupplyCode: o.placeOfSupplyCode, placeOfSupplyName: o.placeOfSupplyName, godownId: o.godownId, godownName: godown?.name ?? "", status: "in_transit", lines,
    taxable: t.taxable, tax: t.cgst + t.sgst + t.igst, value: t.grandTotal, vehicleNo, driverName: input.driverName.trim(), driverPhone: input.driverPhone,
    transporter: input.transporter, distanceKm: input.distanceKm, overrideReason: input.overrideReason || undefined,
    events: [{ at, label: "Stock posted", by, note: input.overrideReason ? `FIFO override: ${input.overrideReason}` : undefined }],
  };
  if (needEwb) {
    const ewbNo = await generateEwb(u, c); // idempotency key dc-{id}-ewb
    c.ewb = { number: ewbNo, generatedAt: at, validUntil: ewbValidUntil(at, input.distanceKm), vehicleNo, distanceKm: input.distanceKm, status: "active", history: [{ at, action: "Generated", by }] };
    c.events.push({ at, label: "E-way bill generated", by });
  }
  c.events.push({ at, label: "Vehicle departed", by, note: vehicleNo });
  await postChallan(u, c, 1);
  u.put("challans", c);
  await syncSoLink(u, c);
  return c;
})));

salesRouter.post("/challans/:id/deliver", h((req) => write(req, async (u) => {
  const pod = z.object({ receivedBy: z.string(), remarks: z.string().default("") }).parse(req.body);
  const c = await u.doc("challans", String(req.params["id"]));
  if (!c) throw new ApiError(404, "not_found", "Challan not found");
  if (u.ctx.role === "Driver" && c.driverName.toLowerCase() !== u.ctx.userName.toLowerCase()) throw new ApiError(403, "forbidden", "This challan isn't assigned to you");
  if (u.ctx.role !== "Driver") requirePerm(u.ctx, "dispatch", "Your role cannot mark challans delivered");
  if (c.status !== "in_transit") throw new ApiError(409, "invalid_status", "Only challans in transit can be marked delivered");
  if (!pod.receivedBy.trim()) throw new ApiError(422, "validation", "Enter who received the goods");
  const at = nowIso();
  c.pod = { at, receivedBy: pod.receivedBy.trim(), remarks: pod.remarks.trim(), by: u.ctx.userName };
  c.status = "delivered";
  c.events.push({ at, label: "POD received", by: u.ctx.userName, note: `Received by ${c.pod.receivedBy}` });
  u.put("challans", c);
  await syncSoLink(u, c);
  return c;
})));

salesRouter.post("/challans/:id/cancel", h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "dispatch", "Your role cannot cancel challans");
  const reason = z.object({ reason: z.string() }).strict().parse(req.body).reason.trim();
  const c = await u.doc("challans", String(req.params["id"]));
  if (!c) throw new ApiError(404, "not_found", "Challan not found");
  if (c.status !== "in_transit") throw new ApiError(409, "invalid_status", "Only challans not yet delivered can be cancelled");
  if (reason.length < 5 || reason.length > 500) throw new ApiError(422, "validation", "Give a cancellation reason (5–500 characters)");
  const at = nowIso();
  if (c.ewb?.status === "active" && !canCancelTestEwb(c.ewb.generatedAt, at))
    throw new ApiError(409, "ewb_window", "The 24-hour e-way bill cancellation window has passed; reconcile the bill before reversing this challan");
  await postChallan(u, c, -1);
  if (c.ewb?.status === "active") { c.ewb.status = "cancelled"; c.ewb.history.push({ at, action: "Cancelled with challan", by: u.ctx.userName }); }
  c.status = "cancelled";
  c.events.push({ at, label: "Cancelled · stock reversed", by: u.ctx.userName, note: reason });
  u.put("challans", c);
  await syncSoLink(u, c);
  return c;
})));

salesRouter.post("/challans/:id/eway/:action", h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "dispatch", "Your role cannot change e-way bills");
  const a = z.discriminatedUnion("action", [
    z.object({ action: z.literal("extend"), extraKm: z.number(), reason: z.string() }),
    z.object({ action: z.literal("part-b"), vehicleNo: z.string(), reason: z.string() }),
    z.object({ action: z.literal("cancel"), reason: z.string() }),
  ]).parse({ ...req.body, action: req.params["action"] });
  const c = await u.doc("challans", String(req.params["id"]));
  if (!c?.ewb) throw new ApiError(404, "not_found", "No e-way bill on this challan");
  const e = c.ewb;
  if (e.status !== "active") throw new ApiError(409, "invalid_status", "This e-way bill is cancelled");
  if (c.status !== "in_transit") throw new ApiError(409, "invalid_status", "E-way bill can only be changed while goods are in transit");
  if (a.reason.trim().length < 3) throw new ApiError(422, "validation", "Give a reason");
  const at = nowIso();
  const by = u.ctx.userName;
  if (a.action === "extend") {
    if (!(a.extraKm > 0)) throw new ApiError(422, "validation", "Enter remaining distance");
    const d = new Date(e.validUntil);
    d.setDate(d.getDate() + ewbValidityDays(a.extraKm));
    e.validUntil = d.toISOString();
    e.history.push({ at, action: `Extended ${ewbValidityDays(a.extraKm)} day(s) · ${a.reason}`, by });
  } else if (a.action === "part-b") {
    const v = normaliseVehicle(a.vehicleNo);
    if (!VEHICLE_PATTERN.test(v)) throw new ApiError(422, "validation", "Enter a valid replacement vehicle number");
    e.vehicleNo = v; c.vehicleNo = v;
    e.history.push({ at, action: `Part-B updated to ${v} · ${a.reason}`, by });
  } else {
    if (!canCancelTestEwb(e.generatedAt, at)) throw new ApiError(409, "ewb_window", "E-way bills can only be cancelled within 24 hours of generation");
    e.status = "cancelled";
    e.history.push({ at, action: `Cancelled · ${a.reason}`, by });
  }
  u.put("challans", c);
  return c;
})));

// ---------- Tax invoices ----------
export function refreshInvoice(inv: Invoice) {
  const settled = inv.paid + inv.advances.reduce((a, b) => a + b.amount, 0);
  inv.balance = Math.max(0, Math.round((inv.grandTotal - settled) * 100) / 100);
  if (inv.status !== "cancelled") inv.status = invoiceStatus(inv.grandTotal, settled, inv.dueDate, today());
  return inv;
}

salesRouter.get("/invoices", h((req) => read(req, async (u) => {
  requirePerm(u.ctx, "issueInvoice", "Your role cannot view tax invoices");
  const customerId = str(req.query["customerId"]);
  const list = (customerId ? await u.docs_("invoices", "party_id = ?", [customerId], "doc_date, number") : await u.docs_("invoices", "1=1", [], "number DESC")).map(refreshInvoice);
  if (req.query["open"] === "1") return list.filter((i) => i.balance > 0 && i.status !== "cancelled");
  const s = str(req.query["status"]);
  return list.filter((i) => !s || s === "all" || i.status === s);
})));
salesRouter.get("/invoices/:id", h((req) => read(req, async (u) => {
  requirePerm(u.ctx, "issueInvoice", "Your role cannot view tax invoices");
  const i = await u.doc("invoices", String(req.params["id"]));
  if (!i) throw new ApiError(404, "not_found", "Invoice not found");
  return refreshInvoice(i);
})));

salesRouter.post("/invoices", h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "issueInvoice", "Only Owner, Manager or Accountant can issue invoices");
  const input = z.object({ challanIds: z.array(z.string().trim().min(1)).min(1).max(100), date: z.string(), applyAdvances: z.boolean() }).strict().parse(req.body);
  const cs: Challan[] = [];
  for (const id of input.challanIds) { const c = await u.doc("challans", id); if (c) cs.push(c); }
  const problems = invoiceIssueProblems(cs, input.challanIds, input.date, today());
  if (problems.length) throw new ApiError(409, "invalid_challans", problems[0]!);
  const c0 = cs[0]!;
  const cust = await u.party(c0.customerId);
  if (!cust) throw new ApiError(422, "invalid_customer", "The challan customer is not available in this organisation");
  const lines = cs.flatMap((c) => c.lines);
  const supply = supplyType(u.ctx.orgStateCode, c0.placeOfSupplyCode);
  const t = computeTotals(lines, supply);
  // Gapless: the counter row is locked in this same transaction; a failure rolls the number back too.
  const { number } = await u.next("INV", input.date);
  const inv: Invoice = {
    id: newId("inv"), number, date: input.date, dueDate: dueDateFor(input.date, cust.creditDays ?? 30), customerId: cust.id, customerName: cust.name, gstin: cust.gstin,
    placeOfSupplyCode: c0.placeOfSupplyCode, placeOfSupplyName: c0.placeOfSupplyName, supply,
    challans: cs.map((c) => ({ id: c.id, number: c.number, soId: c.soId, soNumber: c.soNumber })), lines,
    taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, roundOff: t.roundOff, grandTotal: t.grandTotal, byRate: t.byRate,
    advances: [], paid: 0, balance: t.grandTotal, status: "awaiting_payment", createdBy: u.ctx.userName,
  };
  if (input.applyAdvances) {
    const advs = (await u.docs_("advances", "party_id = ? AND status = 'open'", [cust.id], "doc_date, id"));
    for (const al of applyAdvancesOldestFirst(advs, inv.grandTotal)) {
      const a = advs.find((x) => x.id === al.advanceId)!;
      a.remaining -= al.amount;
      u.put("advances", a);
      inv.advances.push({ advanceId: a.id, receiptNo: a.receiptNo, amount: al.amount });
    }
  }
  refreshInvoice(inv);
  u.put("invoices", inv);
  cust.outstanding += inv.balance;
  u.touchParty(cust);
  const at = nowIso();
  for (const c of cs) {
    c.invoiceNo = inv.number;
    c.events.push({ at, label: `Invoiced on ${inv.number}`, by: u.ctx.userName });
    u.put("challans", c);
    const o = await u.doc("salesOrders", c.soId);
    if (o && !o.linked.some((l) => l.number === inv.number)) {
      o.linked.push({ type: "tax_invoice", number: inv.number, date: inv.date, status: "Awaiting payment", amount: inv.grandTotal });
      u.put("salesOrders", o);
    }
  }
  return inv;
})));

salesRouter.post("/invoices/:id/cancel", h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "issueInvoice", "Your role cannot cancel tax invoices");
  const { reason } = z.object({ reason: z.string() }).strict().parse(req.body);
  const inv = await u.doc("invoices", String(req.params["id"]));
  if (!inv) throw new ApiError(404, "not_found", "Invoice not found");
  const problems = invoiceCancelProblems(inv, reason, today());
  if (problems.length) throw new ApiError(409, "cannot_cancel", problems[0]!, problems);

  // All modifications participate in the same locked MySQL transaction, including
  // advance credits, receivables, sales-order links and released challans.
  const cust = await u.party(inv.customerId);
  if (!cust) throw new ApiError(409, "invalid_customer", "Invoice customer is missing");
  const at = nowIso();
  for (const applied of inv.advances) {
    const advance = await u.doc("advances", applied.advanceId);
    if (!advance || advance.customerId !== inv.customerId)
      throw new ApiError(409, "invalid_advance", "Applied advance is missing; cancellation was not posted");
    advance.remaining = Math.round((advance.remaining + applied.amount) * 100) / 100;
    if (advance.remaining > advance.amount + 0.01)
      throw new ApiError(409, "invalid_advance", "Advance restoration exceeds the original receipt");
    u.put("advances", advance);
  }
  for (const ref of inv.challans) {
    const challan = await u.doc("challans", ref.id);
    if (!challan || challan.invoiceNo !== inv.number)
      throw new ApiError(409, "invalid_challan", "Linked challan changed; cancellation was not posted");
    challan.invoiceNo = "";
    challan.events.push({ at, label: `Invoice ${inv.number} cancelled`, by: u.ctx.userName });
    u.put("challans", challan);
    const so = await u.doc("salesOrders", ref.soId);
    if (so) {
      const link = so.linked.find((d) => d.number === inv.number);
      if (link) link.status = "Cancelled";
      u.put("salesOrders", so);
    }
  }
  cust.outstanding = Math.max(0, Math.round((cust.outstanding - inv.balance) * 100) / 100);
  u.touchParty(cust);
  inv.status = "cancelled";
  inv.balance = 0;
  inv.cancelled = { at, by: u.ctx.userName, reason: reason.trim() };
  u.put("invoices", inv);
  return inv;
})));

// ---------- Receipts & advances ----------
salesRouter.get("/receipts", h((req) => read(req, (u) => {
  requirePerm(u.ctx, "recordReceipt", "Your role cannot view receipts");
  return u.docs_("receipts", "1=1", [], "doc_date DESC, number DESC");
})));
salesRouter.get("/receipts/advances", h((req) => read(req, async (u) => {
  requirePerm(u.ctx, "recordReceipt", "Your role cannot view customer advances");
  const customerId = str(req.query["customerId"]);
  if (customerId) {
    const party = await u.party(customerId);
    if (!party) throw new ApiError(404, "not_found", "Customer not found");
    return u.docs_("advances", "party_id = ? AND status = 'open'", [customerId], "doc_date, id");
  }
  const advs = await u.docs_("advances", "1=1", [], "doc_date, id");
  const out = [];
  for (const a of advs) out.push({ ...a, customerName: (await u.party(a.customerId))?.name ?? "" });
  return out;
})));

// Read-only receipt detail for acceptance reconciliation and audit. Uow.doc scopes
// the lookup to req.ctx.orgId, so document IDs cannot cross tenant boundaries.
salesRouter.get("/receipts/:id", h((req) => read(req, async (u) => {
  requirePerm(u.ctx, "recordReceipt", "Your role cannot view receipts");
  const receipt = await u.doc("receipts", String(req.params["id"]));
  if (!receipt) throw new ApiError(404, "not_found", "Receipt not found");
  return receipt;
})));

salesRouter.post("/receipts", h((req) => write(req, async (u) => {
  requirePerm(u.ctx, "recordReceipt", "Only Owner, Manager or Accountant can record receipts");
  const input = z.object({
    customerId: z.string().trim().min(1), date: z.string(), amount: z.number(),
    mode: z.enum(["cash", "upi", "neft", "cheque"]), reference: z.string().default(""),
    allocations: z.array(z.object({ invoiceId: z.string().min(1), amount: z.number() }).strict()).max(500).optional().nullable(),
  }).strict().parse(req.body);
  const cust = await u.party(input.customerId);
  if (!cust) throw new ApiError(404, "not_found", "Customer not found");
  if (cust.kind !== "customer" && cust.kind !== "both") throw new ApiError(422, "invalid_customer", "Select a customer, not a supplier or transporter");
  const open = (await u.docs_("invoices", "party_id = ? AND status <> 'cancelled'", [cust.id], "doc_date, number"))
    .map(refreshInvoice).filter((i) => i.balance > 0);
  const problems = receiptProblems(input, open, today());
  if (problems.length) throw new ApiError(422, "invalid_receipt", problems[0]!, problems);
  const result = input.allocations == null ? receiptAllocation(open, input.amount) : {
    allocations: input.allocations.filter((a) => a.amount > 0),
    advance: ((receiptPaise(input.amount) ?? 0) - input.allocations.reduce((total, a) => total + (receiptPaise(a.amount) ?? 0), 0)) / 100,
  };
  const allocations = result.allocations;
  const advance = result.advance;
  const allocationProblems = receiptProblems({ ...input, allocations }, open, today());
  if (allocationProblems.length) throw new ApiError(422, "invalid_receipt", allocationProblems[0]!, allocationProblems);
  const { number } = await u.next("RCT", input.date);
  const rc: Receipt = {
    id: newId("r"), number, date: input.date, customerId: cust.id, customerName: cust.name, amount: input.amount, mode: input.mode,
    reference: input.reference, advance, createdBy: u.ctx.userName, allocations: [],
  };
  for (const a of allocations) {
    const inv = open.find((i) => i.id === a.invoiceId)!;
    inv.paid = Math.round((inv.paid + a.amount) * 100) / 100;
    refreshInvoice(inv);
    u.put("invoices", inv);
    for (const c of inv.challans) {
      const o = await u.doc("salesOrders", c.soId);
      if (!o) continue;
      const l = o.linked.find((d) => d.number === inv.number);
      if (l) l.status = inv.status === "paid" ? "Paid" : "Partially paid";
      if (!o.linked.some((d) => d.number === number)) o.linked.push({ type: "receipt", number, date: input.date, status: "Cleared", amount: a.amount });
      u.put("salesOrders", o);
    }
    rc.allocations.push({ invoiceId: inv.id, invoiceNo: inv.number, amount: a.amount });
  }
  u.put("receipts", rc);
  if (advance > 0) u.put("advances", { id: `adv-${rc.id}`, receiptNo: number, date: input.date, customerId: cust.id, amount: advance, remaining: advance });
  cust.outstanding = Math.max(0, Math.round((cust.outstanding - (input.amount - advance)) * 100) / 100);
  u.touchParty(cust);
  return rc;
})));
