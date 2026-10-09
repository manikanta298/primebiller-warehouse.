import { describe, expect, it } from "vitest";
import { buildLedger, computeAlerts } from "@/lib/stock-rules";
import type { Item, LedgerEntry } from "@/api/types";

const e = (id: string, at: string, qty: number): LedgerEntry => ({
  id, at, qty, docNo: id, docType: "grn", type: qty > 0 ? "PURCHASE_IN" : "DC_ISSUE",
  itemId: "i1", itemName: "X", godownId: "g1", godownName: "G", unitCost: 10, user: "u",
});

describe("stock ledger", () => {
  const rows = [e("a", "2026-09-01T10:00", 100), e("b", "2026-09-10T10:00", -30), e("c", "2026-09-20T10:00", 50)];
  it("rolls movements before the range into the opening balance", () => {
    const v = buildLedger(rows, { from: "2026-09-05" });
    expect(v.opening).toBe(100);
    expect(v.rows.map((r) => r.running)).toEqual([70, 120]);
    expect(v.closing).toBe(120);
  });
  it("totals in and out within the range", () => {
    const v = buildLedger(rows, { to: "2026-09-15" });
    expect(v.totalIn).toBe(100);
    expect(v.totalOut).toBe(30);
  });
});

const item = (over: Partial<Item>): Item => ({
  id: "i1", sku: "S", name: "N", category: "", brand: "", hsn: "", gstRate: 18, baseUom: "BAG", conversions: [],
  salePrice: 0, costPrice: 100, allowNegative: false, trackBatches: true, active: true, stock: [], batches: [], ...over,
});
const G = [{ id: "g1", name: "Balanagar" }];

describe("alerts", () => {
  it("flags a batch expiring within 45 days but not one 46 days away", () => {
    const a = computeAlerts([item({ batches: [
      { id: "b1", batchNo: "A", godownId: "g1", qty: 5, mfgDate: "2026-01-01", receivedDate: "2026-09-01", expiryDate: "2026-11-22" },
      { id: "b2", batchNo: "B", godownId: "g1", qty: 5, mfgDate: "2026-01-01", receivedDate: "2026-09-01", expiryDate: "2026-11-23" },
    ] })], G, "2026-10-08", new Set());
    expect(a.filter((x) => x.kind === "near_expiry").map((x) => x.batchNo)).toEqual(["A"]);
  });
  it("flags batches received more than 180 days ago as over-aged", () => {
    const a = computeAlerts([item({ batches: [
      { id: "b1", batchNo: "OLD", godownId: "g1", qty: 5, mfgDate: "2026-01-01", receivedDate: "2026-04-10" },
      { id: "b2", batchNo: "OK", godownId: "g1", qty: 5, mfgDate: "2026-01-01", receivedDate: "2026-04-11" },
    ] })], G, "2026-10-08", new Set());
    expect(a.filter((x) => x.kind === "over_aged").map((x) => x.batchNo)).toEqual(["OLD"]);
  });
  it("classifies zero free stock as out of stock and values the shortfall", () => {
    const a = computeAlerts([item({ stock: [{ godownId: "g1", onHand: 10, held: 10, reorderLevel: 40, maxLevel: 100 }] })], G, "2026-10-08", new Set());
    expect(a[0]?.kind).toBe("out_of_stock");
    expect(a[0]?.valueAtRisk).toBe(4000);
  });
});
