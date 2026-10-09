/**
 * Unit of work: loads rows inside one MySQL transaction (locked with FOR UPDATE when
 * writing), lets services mutate plain objects shaped exactly like the API types, then
 * writes every change back in flush(). Keeps the business code close to the frontend
 * demo layer so both behave the same.
 */
import type { Conn, Row } from "./db.js";
import { bool, exec, newId, one, rows } from "./db.js";
import type { Ctx } from "./auth.js";
import { ApiError } from "./errors.js";
import { docNumber, fyLabel } from "./shared/numbering.js";
import type {
  Adjustment, Advance, Batch, Challan, DocType, Godown, Grn, Invoice, Item, LedgerEntry, Party, PurchaseOrder, Receipt, SalesOrder, Transfer,
} from "./shared/types.js";

export const DOC_TABLES = {
  salesOrders: "sales_orders", challans: "challans", invoices: "invoices", receipts: "receipts", advances: "advances",
  pos: "purchase_orders", grns: "grns", transfers: "transfers", adjustments: "adjustments",
} as const;
export type DocKey = keyof typeof DOC_TABLES;
export interface DocMap {
  salesOrders: SalesOrder; challans: Challan; invoices: Invoice; receipts: Receipt; advances: Advance;
  pos: PurchaseOrder; grns: Grn; transfers: Transfer; adjustments: Adjustment;
}

function head(key: DocKey, d: any) {
  return {
    number: key === "advances" ? null : d.number ?? null,
    date: d.date,
    party: d.customerId ?? d.supplierId ?? null,
    status: key === "advances" ? (d.remaining > 0 ? "open" : "used") : d.status ?? null,
    total: d.grandTotal ?? d.value ?? d.amount ?? 0,
  };
}

export function rowToGodown(r: Row): Godown {
  return {
    id: r["id"], orgId: r["org_id"], code: r["code"], name: r["name"], type: r["type"], address: r["address"] ?? "", stateCode: r["state_code"] ?? "",
    gstin: r["gstin"] ?? undefined, manager: r["manager"] ?? "", allowNegative: bool(r["allow_negative"]), defaultForSales: bool(r["default_for_sales"]), active: bool(r["active"]),
  };
}

export function rowToParty(r: Row): Party {
  const p: Party = {
    id: r["id"], kind: r["kind"], name: r["name"], gstin: r["gstin"] ?? undefined, stateCode: r["state_code"], stateName: r["state_name"], city: r["city"],
    phone: r["phone"], creditLimit: Number(r["credit_limit"]), outstanding: Number(r["outstanding"]), creditDays: r["credit_days"], blocked: bool(r["blocked"]),
  };
  if (r["trade_name"]) p.tradeName = r["trade_name"];
  if (r["pan"]) p.pan = r["pan"];
  if (r["email"]) p.email = r["email"];
  if (r["address"]) p.address = r["address"];
  if (r["pin"]) p.pin = r["pin"];
  return p;
}

/** Loads complete Item objects (with stock and batches) for the given rows. */
export async function hydrateItems(conn: Conn, itemRows: Row[], lock = false): Promise<Item[]> {
  if (!itemRows.length) return [];
  const ids = itemRows.map((r) => r["id"]);
  const sfx = lock ? " FOR UPDATE" : "";
  const st = await rows(conn, `SELECT * FROM item_stock WHERE item_id IN (?)${sfx}`, [ids]);
  const bt = await rows(conn, `SELECT * FROM batches WHERE item_id IN (?) ORDER BY received_date, batch_no${sfx}`, [ids]);
  return itemRows.map((r) => ({
    id: r["id"], sku: r["sku"], name: r["name"], category: r["category"], brand: r["brand"], hsn: r["hsn"], gstRate: Number(r["gst_rate"]),
    baseUom: r["base_uom"], conversions: typeof r["conversions"] === "string" ? JSON.parse(r["conversions"]) : r["conversions"],
    salePrice: Number(r["sale_price"]), costPrice: Number(r["cost_price"]), allowNegative: bool(r["allow_negative"]), trackBatches: bool(r["track_batches"]), active: bool(r["active"]),
    stock: st.filter((s) => s["item_id"] === r["id"]).map((s) => ({ godownId: s["godown_id"], onHand: Number(s["on_hand"]), held: Number(s["held"]), reorderLevel: Number(s["reorder_level"]), maxLevel: Number(s["max_level"]) })),
    batches: bt.filter((b) => b["item_id"] === r["id"]).map((b) => {
      const x: Batch = { id: b["id"], batchNo: b["batch_no"], godownId: b["godown_id"], qty: Number(b["qty"]), mfgDate: b["mfg_date"], receivedDate: b["received_date"] };
      if (b["expiry_date"]) x.expiryDate = b["expiry_date"];
      if (b["heat_no"]) x.heatNo = b["heat_no"];
      return x;
    }),
  }));
}

export async function saveItem(conn: Conn, orgId: string, it: Item) {
  await exec(conn,
    `INSERT INTO items (id, org_id, sku, name, category, brand, hsn, gst_rate, base_uom, conversions, sale_price, cost_price, allow_negative, track_batches, active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE sku=VALUES(sku), name=VALUES(name), category=VALUES(category), brand=VALUES(brand), hsn=VALUES(hsn), gst_rate=VALUES(gst_rate),
       base_uom=VALUES(base_uom), conversions=VALUES(conversions), sale_price=VALUES(sale_price), cost_price=VALUES(cost_price),
       allow_negative=VALUES(allow_negative), track_batches=VALUES(track_batches), active=VALUES(active)`,
    [it.id, orgId, it.sku, it.name, it.category, it.brand, it.hsn, it.gstRate, it.baseUom, JSON.stringify(it.conversions), it.salePrice, it.costPrice, it.allowNegative ? 1 : 0, it.trackBatches ? 1 : 0, it.active ? 1 : 0]);
  for (const s of it.stock) {
    await exec(conn,
      `INSERT INTO item_stock (org_id, item_id, godown_id, on_hand, held, reorder_level, max_level) VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE on_hand=VALUES(on_hand), held=VALUES(held), reorder_level=VALUES(reorder_level), max_level=VALUES(max_level)`,
      [orgId, it.id, s.godownId, s.onHand, s.held, s.reorderLevel, s.maxLevel]);
  }
  for (const b of it.batches) {
    await exec(conn,
      `INSERT INTO batches (id, org_id, item_id, godown_id, batch_no, heat_no, qty, mfg_date, expiry_date, received_date) VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE qty=VALUES(qty), heat_no=VALUES(heat_no), expiry_date=VALUES(expiry_date)`,
      [b.id, orgId, it.id, b.godownId, b.batchNo, b.heatNo ?? null, b.qty, b.mfgDate, b.expiryDate ?? null, b.receivedDate]);
  }
}

export class Uow {
  private items = new Map<string, Item>();
  private parties = new Map<string, Party>();
  private dirtyParties = new Set<string>();
  private docs = new Map<string, { key: DocKey; doc: any; dirty: boolean }>();
  private ledgerRows: Omit<LedgerEntry, "id">[] = [];

  constructor(public conn: Conn, public ctx: Ctx, private lock = true) {}

  private get sfx() {
    return this.lock ? " FOR UPDATE" : "";
  }

  async item(id: string): Promise<Item> {
    const c = this.items.get(id);
    if (c) return c;
    const r = await one(this.conn, `SELECT * FROM items WHERE org_id = ? AND id = ?${this.sfx}`, [this.ctx.orgId, id]);
    if (!r) throw new ApiError(404, "not_found", "Item not found");
    const it = (await hydrateItems(this.conn, [r], this.lock))[0]!;
    this.items.set(id, it);
    return it;
  }

  async party(id: string): Promise<Party | undefined> {
    const c = this.parties.get(id);
    if (c) return c;
    const r = await one(this.conn, `SELECT * FROM parties WHERE org_id = ? AND id = ?${this.sfx}`, [this.ctx.orgId, id]);
    if (!r) return undefined;
    const p = rowToParty(r);
    this.parties.set(id, p);
    return p;
  }
  touchParty(p: Party) {
    this.parties.set(p.id, p);
    this.dirtyParties.add(p.id);
  }

  async godown(id: string): Promise<Godown | undefined> {
    const r = await one(this.conn, "SELECT * FROM godowns WHERE org_id = ? AND id = ?", [this.ctx.orgId, id]);
    return r ? rowToGodown(r) : undefined;
  }

  async doc<K extends DocKey>(key: K, id: string): Promise<DocMap[K] | undefined> {
    const c = this.docs.get(`${key}:${id}`);
    if (c) return c.doc;
    const r = await one(this.conn, `SELECT body FROM ${DOC_TABLES[key]} WHERE org_id = ? AND id = ?${this.sfx}`, [this.ctx.orgId, id]);
    if (!r) return undefined;
    const doc = typeof r["body"] === "string" ? JSON.parse(r["body"]) : r["body"];
    this.docs.set(`${key}:${id}`, { key, doc, dirty: false });
    return doc;
  }

  /** Loads documents matching a WHERE fragment on the header columns (org filter added). */
  async docs_<K extends DocKey>(key: K, where = "1=1", params: unknown[] = [], order = "doc_date DESC, id DESC"): Promise<DocMap[K][]> {
    const rs = await rows(this.conn, `SELECT id, body FROM ${DOC_TABLES[key]} WHERE org_id = ? AND (${where}) ORDER BY ${order}${this.sfx}`, [this.ctx.orgId, ...params]);
    return rs.map((r) => {
      const k = `${key}:${r["id"]}`;
      const c = this.docs.get(k);
      if (c) return c.doc;
      const doc = typeof r["body"] === "string" ? JSON.parse(r["body"]) : r["body"];
      this.docs.set(k, { key, doc, dirty: false });
      return doc;
    });
  }

  put<K extends DocKey>(key: K, doc: DocMap[K]) {
    this.docs.set(`${key}:${(doc as { id: string }).id}`, { key, doc, dirty: true });
  }

  ledger(e: Omit<LedgerEntry, "id">) {
    this.ledgerRows.push(e);
  }

  /** Next document number. Row-locks the counter so concurrent posts can never share or skip a number. */
  async next(docType: DocType, date: string): Promise<{ seq: number; number: string }> {
    const s = await one(this.conn, "SELECT prefix, padding, reset_per_fy FROM doc_series WHERE org_id = ? AND doc_type = ? FOR UPDATE", [this.ctx.orgId, docType]);
    if (!s) throw new ApiError(500, "no_series", `Numbering for ${docType} is not set up`);
    const fy = fyLabel(date);
    const key = bool(s["reset_per_fy"]) ? fy : "ALL";
    await exec(this.conn, "INSERT IGNORE INTO doc_counters (org_id, doc_type, fy, last_number) VALUES (?,?,?,0)", [this.ctx.orgId, docType, key]);
    const c = await one(this.conn, "SELECT last_number FROM doc_counters WHERE org_id = ? AND doc_type = ? AND fy = ? FOR UPDATE", [this.ctx.orgId, docType, key]);
    const seq = Number(c!["last_number"]) + 1;
    await exec(this.conn, "UPDATE doc_counters SET last_number = ? WHERE org_id = ? AND doc_type = ? AND fy = ?", [seq, this.ctx.orgId, docType, key]);
    return { seq, number: docNumber(s["prefix"], fy, seq, Number(s["padding"])) };
  }

  async flush() {
    if (!this.lock) throw new Error("read-only unit of work");
    for (const it of this.items.values()) await saveItem(this.conn, this.ctx.orgId, it);
    for (const id of this.dirtyParties) {
      const p = this.parties.get(id)!;
      await exec(this.conn, "UPDATE parties SET outstanding = ? WHERE org_id = ? AND id = ?", [Math.round(p.outstanding * 100) / 100, this.ctx.orgId, id]);
    }
    for (const { key, doc, dirty } of this.docs.values()) {
      if (!dirty) continue;
      const h = head(key, doc);
      await exec(this.conn,
        `INSERT INTO ${DOC_TABLES[key]} (id, org_id, number, doc_date, party_id, status, total, body) VALUES (?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE number=VALUES(number), doc_date=VALUES(doc_date), party_id=VALUES(party_id), status=VALUES(status), total=VALUES(total), body=VALUES(body)`,
        [doc.id, this.ctx.orgId, h.number, h.date, h.party, h.status, h.total, JSON.stringify(doc)]);
    }
    for (const e of this.ledgerRows) {
      await exec(this.conn,
        `INSERT INTO stock_ledger (org_id, at, doc_no, doc_type, so_id, type, item_id, item_name, godown_id, godown_name, batch_no, qty, unit_cost, user_name, reason)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [this.ctx.orgId, e.at.replace("T", " ").slice(0, 19), e.docNo, e.docType, e.soId ?? null, e.type, e.itemId, e.itemName, e.godownId, e.godownName, e.batchNo ?? null, e.qty, e.unitCost, e.user, e.reason ?? null]);
    }
  }
}

export { newId };
