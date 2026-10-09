import test from "node:test";
import assert from "node:assert/strict";
import {
  itemEditProblems, itemEditPatch, hasItemInventory, normaliseItemDraft,
  indiaItemDate, calendarDaysBetween,
} from "../src/lib/item-detail-rules.ts";

const makeItem = (overrides = {}) => ({
  id: "i1", sku: "TMT-12", name: "TMT Rod", category: "Steel", brand: "JSW", hsn: "7214", gstRate: 18,
  baseUom: "KG", conversions: [{ uom: "KG", factor: 1 }, { uom: "MT", factor: 1000 }],
  salePrice: 62.5, costPrice: 52.5, allowNegative: false, trackBatches: true, active: true,
  stock: [{ godownId: "g1", onHand: 100, held: 20, reorderLevel: 30, maxLevel: 1000 }],
  batches: [{ id: "b1", batchNo: "HEAT-1", godownId: "g1", qty: 100, mfgDate: "2026-08-01", receivedDate: "2026-08-02" }],
  ...overrides,
});

test("valid unchanged item and a regular price edit", () => {
  const item = makeItem();
  assert.deepEqual(itemEditProblems(item, item, ["g1"]), []);
  assert.deepEqual(itemEditPatch(item, { ...item, salePrice: 65 }), { salePrice: 65 });
  assert.deepEqual(itemEditPatch(item, item), {});
});

test("patch includes only changed master fields and threshold values", () => {
  const item = makeItem();
  const edited = { ...item, name: "New Rod", stock: [{ ...item.stock[0], reorderLevel: 55, onHand: 999, held: 0 }], batches: [] };
  const patch = itemEditPatch(item, edited);
  assert.deepEqual(patch, { name: "New Rod", stock: [{ godownId: "g1", reorderLevel: 55, maxLevel: 1000 }] });
  assert.ok(!JSON.stringify(patch).includes("onHand"));
  assert.ok(!JSON.stringify(patch).includes("batches"));
  assert.ok(!JSON.stringify(patch).includes("held"));
});

test("normalisation trims fields and unit names", () => {
  const item = makeItem({ name: " Rod ", sku: " TMT-12 ", hsn: " 7214 ", baseUom: "kg", conversions: [{ uom: "kg", factor: 1 }] });
  const d = normaliseItemDraft(item);
  assert.equal(d.name, "Rod");
  assert.equal(d.sku, "TMT-12");
  assert.equal(d.hsn, "7214");
  assert.equal(d.baseUom, "KG");
  assert.equal(d.conversions[0].uom, "KG");
});

test("invalid HSN, GST, negative prices and nonfinite values are blocked", () => {
  const item = makeItem();
  const result = itemEditProblems({ ...item, hsn: "72AB", gstRate: 17, salePrice: NaN, costPrice: -10 }, item, ["g1"]);
  assert.ok(result.some((x) => x.includes("HSN")));
  assert.ok(result.some((x) => x.includes("GST")));
  assert.ok(result.some((x) => x.includes("Sale price")));
  assert.ok(result.some((x) => x.includes("Cost price")));
});

test("conversion units must be unique, positive and include base factor 1", () => {
  const item = makeItem();
  const invalid = { ...item, conversions: [{ uom: "KG", factor: 2 }, { uom: "KG", factor: -1 }] };
  const issues = itemEditProblems(invalid, item, ["g1"]);
  assert.ok(issues.some((x) => x.includes("listed more than once")));
  assert.ok(issues.some((x) => x.includes("positive")));
  assert.ok(issues.some((x) => x.includes("factor 1")));
});

test("base UOM, batch tracking, and deactivation are locked when stock exists", () => {
  const item = makeItem();
  assert.equal(hasItemInventory(item), true);
  const invalid = { ...item, baseUom: "BAG", trackBatches: false, active: false, conversions: [{ uom: "BAG", factor: 1 }] };
  const issues = itemEditProblems(invalid, item, ["g1"]);
  assert.ok(issues.some((x) => x.includes("Base unit cannot change")));
  assert.ok(issues.some((x) => x.includes("Batch tracking cannot change")));
  assert.ok(issues.some((x) => x.includes("deactivating")));
});

test("zero-stock items can change tracking and deactivate", () => {
  const item = makeItem({ stock: [], batches: [] });
  assert.equal(hasItemInventory(item), false);
  assert.deepEqual(itemEditProblems({ ...item, trackBatches: false, active: false }, item), []);
});

test("thresholds must be numeric, unique, scoped, and max >= reorder", () => {
  const item = makeItem();
  const invalid = { ...item, stock: [
    { godownId: "g1", reorderLevel: 40, maxLevel: 10, onHand: 0, held: 0 },
    { godownId: "g1", reorderLevel: -1, maxLevel: 0, onHand: 0, held: 0 },
    { godownId: "foreign", reorderLevel: 10, maxLevel: Number.POSITIVE_INFINITY, onHand: 0, held: 0 },
  ] };
  const errors = itemEditProblems(invalid, item, ["g1"]);
  assert.ok(errors.some((x) => x.includes("once")));
  assert.ok(errors.some((x) => x.includes("Maximum stock")));
  assert.ok(errors.some((x) => x.includes("non-negative")));
  assert.ok(errors.some((x) => x.includes("outside this organisation")));
});

test("new godown threshold is sent without any quantity", () => {
  const item = makeItem();
  const draft = { ...item, stock: [...item.stock, { godownId: "g2", onHand: 0, held: 0, reorderLevel: 5, maxLevel: 10 }] };
  assert.deepEqual(itemEditProblems(draft, item, ["g1", "g2"]), []);
  assert.deepEqual(itemEditPatch(item, draft), { stock: [{ godownId: "g2", reorderLevel: 5, maxLevel: 10 }] });
});

test("India date and day ageing use business calendar days across midnight", () => {
  assert.equal(indiaItemDate(new Date("2026-10-08T18:29:00Z")), "2026-10-08");
  assert.equal(indiaItemDate(new Date("2026-10-08T18:31:00Z")), "2026-10-09");
  assert.equal(calendarDaysBetween("2026-09-30", "2026-10-09"), 9);
  assert.equal(calendarDaysBetween("2026-10-09", "2026-10-08"), -1);
});
