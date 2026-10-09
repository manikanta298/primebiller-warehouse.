/** Godowns, notifications, dashboard, items, parties and simple masters. */
import { Router } from "express";
import { z } from "zod";
import { exec, newId, one, rows, withTransaction, bool } from "../db.js";
import { ApiError } from "../errors.js";
import { h, read, str } from "../http.js";
import { requirePerm } from "../auth.js";
import { today } from "../config.js";
import { hydrateItems, rowToGodown, rowToParty, saveItem } from "../uow.js";
import { stateName } from "../states.js";
import { HSN_PATTERN } from "../shared/gst.js";
import { godownProblems, normaliseGodown } from "../shared/godown-rules.js";
import { partyProblems, normaliseParty } from "../shared/party-rules.js";
import { computeAlerts } from "../shared/stock-rules.js";
import { dashboardInventory, dashboardPipeline, indiaBusinessDayBoundsUtc, indiaDateOfUtcSqlTimestamp } from "../shared/dashboard-rules.js";
import { itemEditProblems, normaliseItemDraft } from "../shared/item-detail-rules.js";
import { masterProblems, normaliseMaster } from "../shared/master-rules.js";
import type { Dashboard, Item, MasterKind, Party, LedgerEntry, WarehouseActivity } from "../shared/types.js";

export const coreRouter = Router();

// ---------- Godowns ----------
async function godownValues(conn: Parameters<typeof rows>[0], orgId: string) {
  const result = await rows(conn, `SELECT s.godown_id,
    COALESCE(SUM(s.on_hand), 0) qty,
    COALESCE(SUM(s.held), 0) held,
    COALESCE(SUM(s.on_hand * i.cost_price), 0) value,
    SUM(CASE WHEN s.on_hand <> 0 OR s.held <> 0 THEN 1 ELSE 0 END) item_count
    FROM item_stock s JOIN items i ON i.id = s.item_id AND i.org_id = s.org_id
    WHERE s.org_id = ? GROUP BY s.godown_id`, [orgId]);
  return new Map(result.map((x) => [String(x["godown_id"]), {
    stockQty: Number(x["qty"]), heldQty: Number(x["held"]),
    stockValue: Math.round(Number(x["value"]) * 100) / 100, itemCount: Number(x["item_count"]),
  }]));
}

coreRouter.get("/orgs/:orgId/godowns", h((req) => read(req, async (u) => {
  if (req.params["orgId"] !== u.ctx.orgId) throw new ApiError(403, "forbidden", "Wrong organisation");
  const gs = (await rows(u.conn, "SELECT * FROM godowns WHERE org_id = ? ORDER BY name", [u.ctx.orgId])).map(rowToGodown);
  if (req.query["detail"] !== "1") return gs;
  const values = await godownValues(u.conn, u.ctx.orgId);
  return gs.map((g) => ({ ...g, ...(values.get(g.id) ?? { stockQty: 0, heldQty: 0, stockValue: 0, itemCount: 0 }) }));
})));

/** A per-warehouse activity dashboard. Every query is tenant-scoped and read-only.
 * Values (INR) may be combined; unlike KG/BAG/PCS quantities, they share units.
 * Stock leaves on DC dispatch. Issuing an invoice for that DC must not post a second deduction.
 */
coreRouter.get("/orgs/:orgId/godowns/:id/activity", h((req) => read(req, async (u) => {
  if (req.params["orgId"] !== u.ctx.orgId) throw new ApiError(403, "forbidden", "Wrong organisation");
  if (!["Owner", "Manager", "Storekeeper"].includes(u.ctx.role))
    throw new ApiError(403, "forbidden", "Your role cannot view warehouse activity");
  const godownId = String(req.params["id"]);
  if (!await u.godown(godownId)) throw new ApiError(404, "not_found", "Warehouse not found");
  const toDate = today();
  const fromDate = new Date(Date.parse(`${toDate}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  // Ledger timestamps are UTC DATETIME; align the window to India business days.
  const args = [u.ctx.orgId, godownId, indiaBusinessDayBoundsUtc(fromDate).todayStart, indiaBusinessDayBoundsUtc(toDate).tomorrowStart];
  const period = `org_id = ? AND godown_id = ? AND at >= ? AND at < ? AND qty <> 0`;
  const [summary] = await rows(u.conn, `SELECT
    COALESCE(SUM(CASE WHEN qty > 0 THEN qty * unit_cost ELSE 0 END), 0) incoming_value,
    COALESCE(SUM(CASE WHEN qty < 0 THEN -qty * unit_cost ELSE 0 END), 0) outgoing_value,
    SUM(CASE WHEN qty > 0 THEN 1 ELSE 0 END) incoming_movements,
    SUM(CASE WHEN qty < 0 THEN 1 ELSE 0 END) outgoing_movements
    FROM stock_ledger WHERE ${period}`, args);
  const days = await rows(u.conn, `SELECT DATE_FORMAT(DATE_ADD(at, INTERVAL 330 MINUTE), '%Y-%m-%d') activity_day,
    SUM(CASE WHEN qty > 0 THEN qty * unit_cost ELSE 0 END) incoming_value,
    SUM(CASE WHEN qty < 0 THEN -qty * unit_cost ELSE 0 END) outgoing_value
    FROM stock_ledger WHERE ${period} GROUP BY activity_day ORDER BY activity_day`, args);
  const recent = await rows(u.conn, `SELECT * FROM stock_ledger WHERE ${period} ORDER BY at DESC, id DESC LIMIT 20`, args);
  const value = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;
  const output: WarehouseActivity = {
    godownId, fromDate, toDate,
    incomingValue: value(summary?.["incoming_value"]), outgoingValue: value(summary?.["outgoing_value"]),
    incomingMovements: Number(summary?.["incoming_movements"] ?? 0),
    outgoingMovements: Number(summary?.["outgoing_movements"] ?? 0),
    daily: days.map((r) => ({ date: String(r["activity_day"]), incomingValue: value(r["incoming_value"]), outgoingValue: value(r["outgoing_value"]) })),
    recent: recent.map((r): LedgerEntry => ({
      id: String(r["id"]), at: new Date(Date.parse(String(r["at"]).replace(" ", "T") + "Z") + 330 * 60_000).toISOString().slice(0, 16), docNo: String(r["doc_no"]),
      docType: r["doc_type"], ...(r["so_id"] ? { soId: r["so_id"] } : {}),
      type: r["type"], itemId: r["item_id"], itemName: r["item_name"], godownId, godownName: r["godown_name"],
      ...(r["batch_no"] ? { batchNo: r["batch_no"] } : {}), qty: Number(r["qty"]), unitCost: Number(r["unit_cost"]),
      user: r["user_name"], ...(r["reason"] ? { reason: r["reason"] } : {}),
    })),
  };
  return output;
})));

const godownInput = z.object({
  id: z.string().optional(), code: z.string(), name: z.string(), type: z.enum(["godown", "yard", "shop_counter", "transit"]),
  address: z.string().default(""), stateCode: z.string().default(""), gstin: z.string().optional(), manager: z.string().default(""),
  allowNegative: z.boolean(), defaultForSales: z.boolean(), active: z.boolean(),
}).strict();
async function saveGodown(req: Parameters<Parameters<typeof h>[0]>[0]) {
  requirePerm(req.ctx, "editMasters", "Only Owner or Manager can edit warehouses");
  if (req.params["orgId"] !== req.ctx.orgId) throw new ApiError(403, "forbidden", "Wrong organisation");
  const routeId = req.params["id"];
  if ((routeId && req.body?.id && routeId !== req.body.id) || (!routeId && req.body?.id)) {
    throw new ApiError(422, "validation", "Warehouse ID cannot be changed or supplied during creation");
  }
  const input = normaliseGodown(godownInput.parse({ ...req.body, id: routeId }));
  const issues = godownProblems(input);
  if (issues.length) throw new ApiError(422, "validation", issues.join(". "));
  const orgId = req.ctx.orgId;
  return withTransaction(async (conn) => {
    // Serialize concurrent changes to the default sales warehouse within this organisation.
    const org = await one(conn, "SELECT id FROM orgs WHERE id = ? FOR UPDATE", [orgId]);
    if (!org) throw new ApiError(404, "not_found", "Organisation not found");
    const existing = routeId
      ? await one(conn, "SELECT * FROM godowns WHERE org_id = ? AND id = ? FOR UPDATE", [orgId, routeId])
      : undefined;
    if (routeId && !existing) throw new ApiError(404, "not_found", "Warehouse not found in this organisation");
    const duplicate = await one(conn, "SELECT id FROM godowns WHERE org_id = ? AND code = ? AND id <> ?", [orgId, input.code, routeId ?? ""]);
    if (duplicate) throw new ApiError(409, "duplicate_code", `Code ${input.code} is already used`);
    if (existing && bool(existing["active"]) && !input.active) {
      // A net zero across all SKUs can still hide inventory or held reservations.
      const remaining = await one(conn, `SELECT item_id FROM item_stock
        WHERE org_id = ? AND godown_id = ? AND (on_hand <> 0 OR held <> 0) LIMIT 1 FOR UPDATE`, [orgId, routeId]);
      if (remaining) throw new ApiError(409, "has_stock", `${existing["name"]} has stock or held reservations. Clear both before deactivating.`);
    }
    if (input.defaultForSales) await exec(conn, "UPDATE godowns SET default_for_sales = 0 WHERE org_id = ?", [orgId]);
    const id = routeId ?? newId("g");
    const args = [input.code, input.name, input.type, input.address, input.stateCode, input.gstin ?? null,
      input.manager, +input.allowNegative, +input.defaultForSales, +input.active];
    if (routeId) {
      await exec(conn, `UPDATE godowns SET code=?, name=?, type=?, address=?, state_code=?, gstin=?, manager=?,
        allow_negative=?, default_for_sales=?, active=? WHERE org_id=? AND id=?`, [...args, orgId, routeId]);
    } else {
      await exec(conn, `INSERT INTO godowns (code, name, type, address, state_code, gstin, manager,
        allow_negative, default_for_sales, active, org_id, id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [...args, orgId, id]);
    }
    return rowToGodown((await one(conn, "SELECT * FROM godowns WHERE org_id = ? AND id = ?", [orgId, id]))!);
  });
}
coreRouter.post("/orgs/:orgId/godowns", h(saveGodown));
coreRouter.put("/orgs/:orgId/godowns/:id", h(saveGodown));

// ---------- Notifications ----------
coreRouter.get("/notifications", h((req) => read(req, async (u) => {
  const r = await rows(u.conn, "SELECT id, title, created_at, is_read FROM notifications WHERE org_id = ? ORDER BY created_at DESC LIMIT 30", [u.ctx.orgId]);
  return r.map((n) => ({ id: n["id"], title: n["title"], time: relTime(n["created_at"]), read: bool(n["is_read"]) }));
})));
function relTime(at: string) {
  const mins = Math.floor((Date.now() - Date.parse(at.replace(" ", "T") + "Z")) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h ago`;
  return mins < 2880 ? "Yesterday" : `${Math.floor(mins / 1440)} days ago`;
}

// ---------- Items ----------
export async function loadItems(conn: Parameters<typeof rows>[0], orgId: string, q = "", lock = false): Promise<Item[]> {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const where = words.map(() => "LOWER(CONCAT_WS(' ', name, sku, hsn, brand)) LIKE ?").join(" AND ");
  const r = await rows(conn, `SELECT * FROM items WHERE org_id = ?${where ? ` AND ${where}` : ""} ORDER BY name`, [orgId, ...words.map((w) => `%${w}%`)]);
  return hydrateItems(conn as never, r, lock);
}

coreRouter.get("/items", h((req) => read(req, (u) => loadItems(u.conn, u.ctx.orgId, str(req.query["q"]) ?? ""))));
coreRouter.get("/items/:id", h((req) => read(req, (u) => u.item(String(req.params["id"])))));

const itemFields = z.object({
  sku: z.string().min(1), name: z.string().min(1), category: z.string().default(""), brand: z.string().default(""),
  hsn: z.string().regex(HSN_PATTERN, "HSN must be 4, 6 or 8 digits"), gstRate: z.number().min(0).max(28), baseUom: z.string().min(1),
  conversions: z.array(z.object({ uom: z.string(), factor: z.number().positive() })), salePrice: z.number().min(0), costPrice: z.number().min(0),
  allowNegative: z.boolean(), trackBatches: z.boolean(), active: z.boolean(),
});

coreRouter.post("/items", h(async (req) => {
  requirePerm(req.ctx, "editMasters", "Only Owner or Manager can edit masters");
  const input = itemFields.parse(req.body);
  return withTransaction(async (conn) => {
    if (await one(conn, "SELECT id FROM items WHERE org_id = ? AND sku = ?", [req.ctx.orgId, input.sku])) throw new ApiError(409, "duplicate_sku", `SKU ${input.sku} already exists`);
    const it: Item = { ...input, id: newId("i"), stock: [], batches: [] };
    await saveItem(conn, req.ctx.orgId, it);
    return it;
  });
}));

coreRouter.patch("/items/:id", h(async (req) => {
  requirePerm(req.ctx, "editItems", "Your role cannot edit items");
  // Strict PATCH: reject client attempts to change on-hand, held, batches or ids.
  // Inventory balances may only move through posted stock documents.
  const patch = itemFields.partial().extend({
    stock: z.array(z.object({
      godownId: z.string().min(1), reorderLevel: z.number().finite().min(0), maxLevel: z.number().finite().min(0),
    }).strict()).optional(),
  }).strict().parse(req.body);
  return withTransaction(async (conn) => {
    const r = await one(conn, "SELECT * FROM items WHERE org_id = ? AND id = ? FOR UPDATE", [req.ctx.orgId, req.params["id"]]);
    if (!r) throw new ApiError(404, "not_found", "Item not found");
    const original = (await hydrateItems(conn, [r], true))[0]!;
    const { stock, ...rest } = patch;
    const it: Item = { ...original, ...rest, stock: original.stock.map((s) => ({ ...s })) };
    const orgGodowns = (await rows(conn, "SELECT id FROM godowns WHERE org_id = ?", [req.ctx.orgId])).map((g) => String(g["id"]));
    if (stock) for (const s of stock) {
      if (!orgGodowns.includes(s.godownId)) throw new ApiError(422, "invalid_godown", "Godown does not belong to this organisation");
      const cur = it.stock.find((x) => x.godownId === s.godownId);
      if (cur) { cur.reorderLevel = s.reorderLevel; cur.maxLevel = s.maxLevel; }
      else it.stock.push({ godownId: s.godownId, onHand: 0, held: 0, reorderLevel: s.reorderLevel, maxLevel: s.maxLevel });
    }
    const errors = itemEditProblems(it, original, orgGodowns);
    if (errors.length) throw new ApiError(422, "validation", errors.join(" "));
    // Also cover products that once moved stock but now have zero balance.
    if ((it.baseUom !== original.baseUom || it.trackBatches !== original.trackBatches)) {
      const history = await one(conn, "SELECT id FROM stock_ledger WHERE org_id = ? AND item_id = ? LIMIT 1", [req.ctx.orgId, it.id]);
      if (history) throw new ApiError(409, "stock_history", "Base unit and batch tracking cannot change after stock movements");
    }
    const sku = it.sku.trim();
    if (sku !== original.sku && await one(conn, "SELECT id FROM items WHERE org_id = ? AND sku = ? AND id <> ?", [req.ctx.orgId, sku, it.id])) {
      throw new ApiError(409, "duplicate_sku", `SKU ${sku} already exists in this organisation`);
    }
    const normalised = normaliseItemDraft(it);
    await saveItem(conn, req.ctx.orgId, normalised);
    return normalised;
  });
}));

// ---------- Parties ----------
coreRouter.get("/parties", h((req) => read(req, async (u) => {
  const kind = str(req.query["kind"]);
  const words = (str(req.query["q"]) ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const conds = ["org_id = ?"];
  const params: unknown[] = [u.ctx.orgId];
  if (kind) {
    conds.push(kind === "customer" || kind === "supplier" ? "(kind = ? OR kind = 'both')" : "kind = ?");
    params.push(kind);
  }
  for (const w of words) {
    conds.push("LOWER(CONCAT_WS(' ', name, trade_name, gstin, city, phone)) LIKE ?");
    params.push(`%${w}%`);
  }
  return (await rows(u.conn, `SELECT * FROM parties WHERE ${conds.join(" AND ")} ORDER BY name`, params)).map(rowToParty);
})));

coreRouter.get("/parties/:id", h((req) => read(req, async (u) => {
  const p = await u.party(String(req.params["id"]));
  if (!p) throw new ApiError(404, "not_found", "Party not found");
  return p;
})));

const partyInput = z.object({
  id: z.string().optional(), kind: z.enum(["customer", "supplier", "both", "transporter"]), name: z.string(), tradeName: z.string().optional(),
  gstin: z.string().optional(), pan: z.string().optional(), email: z.string().optional(), phone: z.string().default(""), address: z.string().optional(),
  city: z.string().default(""), pin: z.string().optional(), stateCode: z.string(), creditLimit: z.number(),
  creditDays: z.number(), blocked: z.boolean(),
}).strict();
async function saveParty(req: Parameters<Parameters<typeof h>[0]>[0]): Promise<Party> {
  requirePerm(req.ctx, "editParties", "Your role cannot edit parties");
  const routeId = req.params["id"];
  if ((routeId && req.body?.id && routeId !== req.body.id) || (!routeId && req.body?.id)) {
    throw new ApiError(422, "validation", "Party ID cannot be changed or supplied during creation");
  }
  // Strict schema excludes orgId, outstanding and stateName (ledger-derived/protected fields).
  const input = normaliseParty(partyInput.parse({ ...req.body, id: routeId }));
  const problems = partyProblems(input);
  if (problems.length) throw new ApiError(422, "validation", problems.join(". "));
  const orgId = req.ctx.orgId;
  return withTransaction(async (conn) => {
    // Editing is limited to parties that belong to the current authenticated organisation.
    const existing = routeId ? await one(conn, "SELECT id FROM parties WHERE org_id = ? AND id = ? FOR UPDATE", [orgId, routeId]) : undefined;
    if (routeId && !existing) throw new ApiError(404, "not_found", "Party not found in this organisation");
    if (input.gstin) {
      const dup = await one(conn, "SELECT name FROM parties WHERE org_id = ? AND gstin = ? AND id <> ?", [orgId, input.gstin, routeId ?? ""]);
      if (dup) throw new ApiError(409, "duplicate_gstin", `GSTIN already used by ${dup["name"]}`);
    }
    const values = [input.kind, input.name, input.tradeName ?? null, input.gstin ?? null, input.pan ?? null, input.email ?? null,
      input.phone, input.address ?? null, input.city, input.pin ?? null, input.stateCode, stateName(input.stateCode),
      input.creditLimit, input.creditDays, +input.blocked];
    const id = routeId ?? newId("p");
    if (routeId) {
      await exec(conn, `UPDATE parties SET kind=?, name=?, trade_name=?, gstin=?, pan=?, email=?, phone=?, address=?,
        city=?, pin=?, state_code=?, state_name=?, credit_limit=?, credit_days=?, blocked=? WHERE org_id=? AND id=?`, [...values, orgId, id]);
    } else {
      await exec(conn, `INSERT INTO parties (kind, name, trade_name, gstin, pan, email, phone, address, city, pin,
        state_code, state_name, credit_limit, credit_days, blocked, org_id, id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [...values, orgId, id]);
    }
    return rowToParty((await one(conn, "SELECT * FROM parties WHERE org_id = ? AND id = ?", [orgId, id]))!);
  });
}
coreRouter.post("/parties", h(saveParty));
coreRouter.put("/parties/:id", h(saveParty));

// ---------- Simple masters ----------
const MASTERS: Record<MasterKind, { table: string; key: "code" | "name"; cols: Record<string, string> }> = {
  uoms: { table: "uoms", key: "code", cols: { code: "code", name: "name", category: "category", decimals: "decimals", active: "active" } },
  categories: { table: "categories", key: "name", cols: { name: "name", parentId: "parent_id", defaultHsn: "default_hsn", defaultGst: "default_gst", active: "active" } },
  brands: { table: "brands", key: "name", cols: { name: "name", active: "active" } },
  hsn: { table: "hsn_rates", key: "code", cols: { code: "code", description: "description", gstRate: "gst_rate", cessPct: "cess_pct", effectiveFrom: "effective_from", active: "active" } },
};
const masterKind = (k: unknown): MasterKind => {
  if (typeof k !== "string" || !(k in MASTERS)) throw new ApiError(404, "not_found", "Unknown master");
  return k as MasterKind;
};
const fromRow = (kind: MasterKind, r: Record<string, unknown>) => {
  const o: Record<string, unknown> = { id: r["id"] };
  for (const [js, col] of Object.entries(MASTERS[kind].cols)) {
    if (js === "active") o[js] = bool(r[col]);
    else if (["decimals", "defaultGst", "gstRate", "cessPct"].includes(js)) o[js] = Number(r[col]);
    else if (js === "effectiveFrom") o[js] = String(r[col] ?? "").slice(0, 10);
    else o[js] = r[col] ?? null;
  }
  return o;
};

// DATE_FORMAT avoids mysql2 converting DATE into JS Date objects in server-local time.
const masterColumns = (kind: MasterKind) => kind === "hsn" ? "*, DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from" : "*";

coreRouter.get("/masters/:kind", h((req) => read(req, async (u) => {
  const kind = masterKind(req.params["kind"]);
  const m = MASTERS[kind];
  return (await rows(u.conn, `SELECT ${masterColumns(kind)} FROM ${m.table} WHERE org_id = ? ORDER BY ${m.key}`, [u.ctx.orgId])).map((r) => fromRow(kind, r));
})));

async function saveMaster(req: Parameters<Parameters<typeof h>[0]>[0]) {
  requirePerm(req.ctx, "editMasters", "Only Owner or Manager can edit masters");
  const kind = masterKind(req.params["kind"]);
  const m = MASTERS[kind];
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw new ApiError(422, "validation", "Invalid master form");
  const body = req.body as Record<string, unknown>;
  const allowed = new Set(["id", ...Object.keys(m.cols)]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new ApiError(422, "validation", "Unexpected master fields");
  const routeId = req.params["id"];
  if (routeId && body["id"] && routeId !== body["id"]) throw new ApiError(422, "validation", "Master ID does not match the URL");
  if (!routeId && body["id"]) throw new ApiError(422, "validation", "Create a master without an existing ID");
  const input = normaliseMaster(kind, { ...body, ...(routeId ? { id: routeId } : {}) } as never) as Record<string, unknown>;
  return withTransaction(async (conn) => {
    const existing = routeId
      ? await one(conn, `SELECT ${masterColumns(kind)} FROM ${m.table} WHERE org_id = ? AND id = ? FOR UPDATE`, [req.ctx.orgId, routeId])
      : undefined;
    if (routeId && !existing) throw new ApiError(404, "not_found", "Master record was not found in this organisation");
    const categories = kind === "categories"
      ? (await rows(conn, "SELECT * FROM categories WHERE org_id = ?", [req.ctx.orgId])).map((r) => fromRow("categories", r))
      : [];
    const previous = existing ? fromRow(kind, existing) : undefined;
    const issues = masterProblems(kind, input, categories as never, previous);
    if (issues.length) throw new ApiError(422, "validation", issues.join(" "));
    const val = String(input[m.key]);
    const extra = kind === "hsn" ? " AND effective_from = ?" : "";
    const dup = await one(conn, `SELECT id FROM ${m.table} WHERE org_id = ? AND LOWER(${m.key}) = LOWER(?) AND id <> ?${extra}`, [req.ctx.orgId, val, routeId ?? "", ...(kind === "hsn" ? [input["effectiveFrom"]] : [])]);
    if (dup) throw new ApiError(409, "duplicate", `${val} already exists in this organisation`);
    const id = routeId ?? newId(kind.slice(0, 3));
    const entries = Object.entries(m.cols);
    const vals = entries.map(([js]) => js === "active" ? (input[js] === false ? 0 : 1) : input[js] ?? null);
    // Insert and update by known, scoped ID. No ON DUPLICATE KEY UPDATE:
    // that pattern could overwrite a record owned by another organisation.
    if (existing) {
      await exec(conn, `UPDATE ${m.table} SET ${entries.map(([, c]) => `${c} = ?`).join(", ")} WHERE id = ? AND org_id = ?`, [...vals, id, req.ctx.orgId]);
    } else {
      await exec(conn, `INSERT INTO ${m.table} (id, org_id, ${entries.map(([, c]) => c).join(", ")}) VALUES (?, ?, ${entries.map(() => "?").join(", ")})`, [id, req.ctx.orgId, ...vals]);
    }
    const saved = await one(conn, `SELECT ${masterColumns(kind)} FROM ${m.table} WHERE id = ? AND org_id = ?`, [id, req.ctx.orgId]);
    if (!saved) throw new ApiError(500, "save_failed", "Could not load saved master");
    return fromRow(kind, saved);
  });
}
coreRouter.post("/masters/:kind", h(saveMaster));
coreRouter.put("/masters/:kind/:id", h(saveMaster));

// ---------- Dashboard ----------
coreRouter.get("/dashboard", h((req) => read(req, async (u): Promise<Dashboard> => {
  const scope = str(req.query["godownId"]) ?? "all";
  const godowns = (await rows(u.conn, "SELECT * FROM godowns WHERE org_id = ? ORDER BY name", [u.ctx.orgId])).map(rowToGodown);
  if (scope !== "all" && !godowns.some((g) => g.id === scope)) {
    throw new ApiError(404, "godown_not_found", "Godown not found in this organisation");
  }
  const inScope = (g: string) => scope === "all" || g === scope;
  const t = today();
  const { todayStart, tomorrowStart, lastSevenDaysStart } = indiaBusinessDayBoundsUtc(t);
  const items = await loadItems(u.conn, u.ctx.orgId);
  const alerts = computeAlerts(items, godowns.filter((g) => inScope(g.id)), t, new Set());
  const inventory = dashboardInventory(items, godowns, scope, alerts);

  // Half-open IST business-day boundaries, converted to the UTC DATETIME used
  // by the ledger, include movements after midnight India time correctly.
  const gParam = scope === "all" ? [] : [scope];
  const gWhere = scope === "all" ? "" : " AND godown_id = ?";
  const today_ = await one(u.conn,
    `SELECT COUNT(*) n FROM stock_ledger WHERE org_id = ? AND type <> 'OPENING' AND at >= ? AND at < ?${gWhere}`,
    [u.ctx.orgId, todayStart, tomorrowStart, ...gParam]);
  const moves = await rows(u.conn,
    `SELECT id, at, doc_no, doc_type, item_name, godown_name, qty, ABS(qty * unit_cost) value FROM stock_ledger
     WHERE org_id = ? AND type <> 'OPENING' AND at >= ? AND at < ?${gWhere}
     ORDER BY value DESC, at DESC, id DESC LIMIT 5`, [u.ctx.orgId, lastSevenDaysStart, tomorrowStart, ...gParam]);
  const typeOf = { grn: "Purchase", challan: "Sale", transfer: "Transfer", adjustment: "Adjustment", opening: "Adjustment" } as const;

  const sos = await u.docs_("salesOrders");
  const overdue = (await u.docs_("invoices", "status <> 'cancelled' AND status <> 'paid'"))
    .filter((invoice) => invoice.balance > 0 && invoice.dueDate < t);
  // Invoices contain linked challans rather than a direct godown id.
  // Only show invoices linked to this godown when the dashboard is filtered.
  const relatedChallans = scope === "all" ? null : new Set(
    (await u.docs_("challans")).filter((c) => c.godownId === scope).map((c) => c.id),
  );
  const scopedOverdue = relatedChallans
    ? overdue.filter((invoice) => invoice.challans.some((c) => relatedChallans.has(c.id)))
    : overdue;

  const attention: Dashboard["attention"] = [
    ...alerts.filter((a) => a.kind === "out_of_stock" || a.kind === "near_expiry" || a.kind === "below_reorder" || a.kind === "over_aged")
      .slice(0, 4).map((a) => ({
        id: a.id,
        kind: (a.kind === "below_reorder" ? "low_stock" : a.kind) as Dashboard["attention"][number]["kind"],
        title: a.itemName + (a.batchNo ? ` · ${a.batchNo}` : ""),
        detail: `${a.qty} ${a.uom} at ${a.godownName}`,
      })),
    ...scopedOverdue.slice(0, 3).map((invoice) => ({
      id: invoice.id, kind: "overdue" as const, title: `Invoice ${invoice.number}`,
      detail: `${invoice.customerName} · ₹${invoice.balance.toLocaleString("en-IN")} overdue`,
    })),
  ];

  return {
    asOfDate: t,
    ...inventory,
    movementsToday: Number(today_?.["n"] ?? 0),
    highValueMovements: moves.map((m) => ({
      id: String(m["id"]),
      date: indiaDateOfUtcSqlTimestamp(String(m["at"])),
      docNo: String(m["doc_no"]),
      type: typeOf[m["doc_type"] as keyof typeof typeOf],
      itemName: String(m["item_name"]),
      godownName: String(m["godown_name"]),
      qty: Number(m["qty"]),
      value: Math.round(Number(m["value"])),
    })),
    attention,
    pipeline: dashboardPipeline(sos, scope),
  };
})));
