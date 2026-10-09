import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardInventory, dashboardPipeline } from "../src/lib/dashboard-rules.ts";

const godowns = [
  { id: "g1", name: "Main" },
  { id: "g2", name: "Secondary" },
];
const items = [{
  id: "i1", costPrice: 50,
  stock: [
    { godownId: "g1", onHand: 5, held: 4, reorderLevel: 3 },
    { godownId: "g2", onHand: 2, held: 0, reorderLevel: 3 },
    { godownId: "different-org", onHand: 9999, held: 0, reorderLevel: 10 },
  ],
}];
const alerts = [
  { id: "a1", godownId: "g1", kind: "below_reorder" },
  { id: "a2", godownId: "g1", kind: "near_expiry" },
  { id: "a3", godownId: "g2", kind: "out_of_stock" },
  { id: "a4", godownId: "g2", kind: "over_aged" },
  { id: "a5", godownId: "different-org", kind: "below_reorder" },
];
const orders = [
  { id: "o1", godownId: "g1", status: "draft", grandTotal: 125 },
  { id: "o2", godownId: "g2", status: "confirmed", grandTotal: 300 },
  { id: "o3", godownId: "g1", status: "partially_delivered", grandTotal: 450 },
  { id: "o4", godownId: "g1", status: "cancelled", grandTotal: 999 },
  { id: "o5", godownId: "different-org", status: "confirmed", grandTotal: 5000 },
];

test("all-godown stock and alert metrics only consider the provided org godowns", () => {
  const result = dashboardInventory(items, godowns, "all", alerts);
  assert.equal(result.stockValue, 350);
  assert.deepEqual(result.valueByGodown.map(({ value }) => value), [250, 100]);
  assert.equal(result.lowStock, 1);
  assert.equal(result.outOfStock, 1);
  assert.equal(result.nearExpiry, 1);
  assert.equal(result.overAged, 1);
});

test("filtering to one godown changes values and alerts together", () => {
  const result = dashboardInventory(items, godowns, "g1", alerts);
  assert.equal(result.stockValue, 250);
  assert.deepEqual(result.valueByGodown, [{ godownId: "g1", name: "Main", value: 250 }]);
  assert.equal(result.lowStock, 1);
  assert.equal(result.outOfStock, 0);
  assert.equal(result.overAged, 0);
});

test("empty godowns and zero-value stock are valid states", () => {
  const empty = dashboardInventory(items, [], "all", alerts);
  assert.equal(empty.stockValue, 0);
  assert.deepEqual(empty.valueByGodown, []);
  assert.equal(empty.lowStock, 0);
  const zero = dashboardInventory([], godowns, "all", []);
  assert.deepEqual(zero.valueByGodown.map(({ value }) => value), [0, 0]);
});

test("sales pipeline respects selected godown and excludes cancelled orders", () => {
  const g1 = dashboardPipeline(orders, "g1");
  assert.deepEqual(g1.map(({ count, value }) => [count, value]), [
    [1, 125], [0, 0], [1, 450], [0, 0],
  ]);
  const all = dashboardPipeline(orders, "all");
  assert.deepEqual(all.map(({ count, value }) => [count, value]), [
    [1, 125], [2, 5300], [1, 450], [0, 0],
  ]);
});

test("India business-day ranges include after-midnight IST ledger entries", async () => {
  const { indiaBusinessDayBoundsUtc, indiaDateOfUtcSqlTimestamp } = await import("../src/lib/dashboard-rules.ts");
  assert.deepEqual(indiaBusinessDayBoundsUtc("2026-10-09"), {
    todayStart: "2026-10-08 18:30:00",
    tomorrowStart: "2026-10-09 18:30:00",
    lastSevenDaysStart: "2026-10-02 18:30:00",
  });
  assert.equal(indiaDateOfUtcSqlTimestamp("2026-10-08 20:30:00"), "2026-10-09");
  assert.equal(indiaDateOfUtcSqlTimestamp("2026-10-08 17:30:00"), "2026-10-08");
});
