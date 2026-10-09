import test from "node:test";
import assert from "node:assert/strict";
import {
  filterItemList, itemListCsv, itemListSummary, itemStock,
  itemStockStatus, paginateItemList,
} from "../src/lib/item-list-rules.ts";

const S = (godownId, onHand, held, reorderLevel) => ({ godownId, onHand, held, reorderLevel, maxLevel: 500 });
const item = (id, name, category, stock, extra = {}) => ({
  id, name, category, stock, sku: `SKU-${id}`, brand: "JSW", hsn: "7214",
  gstRate: 18, baseUom: "KG", salePrice: 100, costPrice: 40,
  active: true, batches: [], conversions: [], allowNegative: false,
  trackBatches: false, ...extra,
});
const data = [
  item("1", "Iron rods", "Steel", [S("g1", 20, 15, 10), S("g2", 30, 0, 10)]),
  item("2", "Steel mesh", "Steel", [S("g1", 0, 0, 5), S("g2", 2, 0, 1)]),
  item("3", "Cement bags", "Cement", [S("g1", 15, 0, 5), S("g2", 0, 0, 10)]),
  item("4", "Old cement", "Cement", [S("g1", 100, 0, 10)], { active: false }),
  item("5", "New product", "Misc", [], { costPrice: 900 }),
];
const opts = { query: "", category: "all", activity: "active", stock: "all", sort: "name_asc", godownId: "g1" };

test("scoped stock calculations consider held reservations and different godowns", () => {
  assert.deepEqual(itemStock(data[0], "g1"), { onHand: 20, held: 15, free: 5, reorder: 10 });
  assert.deepEqual(itemStock(data[0], "all"), { onHand: 50, held: 15, free: 35, reorder: 20 });
  assert.equal(itemStockStatus(data[0], "g1"), "low");
  assert.equal(itemStockStatus(data[0], "all"), "available");
  assert.equal(itemStockStatus(data[1], "g1"), "out");
  assert.equal(itemStockStatus(data[1], "g2"), "available");
  assert.equal(itemStockStatus(data[4], "all"), "out");
});

test("active-only KPIs ignore searches and inactive records", () => {
  assert.deepEqual(itemListSummary(data, "g1"), { active: 4, value: 1400, low: 1, out: 2 });
  assert.deepEqual(itemListSummary([], "g1"), { active: 0, value: 0, low: 0, out: 0 });
  assert.deepEqual(itemListSummary(data, "g2"), { active: 4, value: 1280, low: 0, out: 2 });
});

test("case-insensitive multi-token search, categories, activity and stock filtering combine", () => {
  assert.deepEqual(filterItemList(data, { ...opts, query: "steel 7214", stock: "out" }).map((x) => x.id), ["2"]);
  assert.deepEqual(filterItemList(data, { ...opts, query: "sKU-1 iron" }).map((x) => x.id), ["1"]);
  assert.deepEqual(filterItemList(data, { ...opts, category: "Cement" }).map((x) => x.id), ["3"]);
  assert.deepEqual(filterItemList(data, { ...opts, activity: "inactive" }).map((x) => x.id), ["4"]);
  assert.deepEqual(filterItemList(data, { ...opts, activity: "all", category: "Cement" }).map((x) => x.id), ["3", "4"]);
  assert.deepEqual(filterItemList(data, { ...opts, stock: "low" }).map((x) => x.id), ["1"]);
  assert.deepEqual(filterItemList(data, { ...opts, stock: "out", godownId: "g2" }).map((x) => x.id), ["3", "5"]);
});

test("all sorts use scoped values and consistent tie breaking", () => {
  assert.deepEqual(filterItemList(data, { ...opts, sort: "stock_desc" }).map((x) => x.id), ["1", "3", "5", "2"]);
  assert.deepEqual(filterItemList(data, { ...opts, sort: "free_asc" }).map((x) => x.id), ["5", "2", "1", "3"]);
  assert.deepEqual(filterItemList(data, { ...opts, sort: "value_desc" }).map((x) => x.id), ["1", "3", "5", "2"]);
  assert.deepEqual(filterItemList(data, { ...opts, sort: "name_desc" }).map((x) => x.id), ["2", "5", "1", "3"]);
});

test("paging bounds, last partial page and empty data", () => {
  assert.deepEqual(paginateItemList([1, 2, 3, 4, 5], 2, 2), { page: 2, totalPages: 3, start: 2, rows: [3, 4] });
  assert.deepEqual(paginateItemList([1, 2, 3, 4, 5], 100, 2), { page: 3, totalPages: 3, start: 4, rows: [5] });
  assert.deepEqual(paginateItemList([], 99, 2), { page: 1, totalPages: 1, start: 0, rows: [] });
});

test("CSV includes only supplied rows, escapes special characters, and neutralises formula cells", () => {
  const malicious = item("42", '=HYPERLINK("https://bad.example", "Click")', "General,Steel", [S("g1", 1, 0, 1)], { sku: "-2+3" });
  const csv = itemListCsv([malicious], "g1");
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=HYPERLINK(""https://bad.example"", ""Click"")"'));
  assert.ok(csv.includes('"General,Steel"'));
  assert.ok(csv.includes('"\'-2+3"'));
  assert.equal(csv.split("\r\n").length, 3); // header + row + final newline
  assert.ok(!csv.includes("Iron rods"));
});
