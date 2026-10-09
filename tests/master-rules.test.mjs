import test from "node:test";
import assert from "node:assert/strict";
import {
  normaliseMaster, masterProblems, categoryTree, filterMasters,
  isoCalendarDate, indiaMasterDate,
} from "../src/lib/master-rules.ts";

const unit = { id: "u1", code: "KG", name: "Kilogram", category: "weight", decimals: 2, active: true };
const brand = { id: "b1", name: "JSW", active: true };
const cat1 = { id: "c1", name: "Steel", parentId: null, defaultHsn: "7214", defaultGst: 18, active: true };
const cat2 = { id: "c2", name: "Rebar", parentId: "c1", defaultHsn: "7214", defaultGst: 18, active: true };
const cat3 = { id: "c3", name: "TMT", parentId: "c2", defaultHsn: "7214", defaultGst: 18, active: true };
const rate = { id: "h1", code: "7214", description: "Bars and rods", gstRate: 18, cessPct: 0, effectiveFrom: "2017-07-01", active: true };

test("master names are trimmed and UOM codes are canonicalised", () => {
  const r = normaliseMaster("uoms", { ...unit, code: " kg ", name: " Kilogram " });
  assert.deepEqual([r.code, r.name], ["KG", "Kilogram"]);
  assert.deepEqual(masterProblems("uoms", r), []);
});

test("units require known kind, code syntax and integral decimal precision", () => {
  const issues = masterProblems("uoms", { ...unit, code: "K G", category: "distance", decimals: 1.5 });
  assert.ok(issues.some((x) => x.includes("Unit code")));
  assert.ok(issues.some((x) => x.includes("kind")));
  assert.ok(issues.some((x) => x.includes("Decimal")));
});

test("category parent must exist in this organisation", () => {
  const bad = masterProblems("categories", { ...cat2, parentId: "foreign-org" }, [cat1, cat2]);
  assert.ok(bad.some((x) => x.includes("organisation")));
});

test("multi-level category cycles, including indirect cycles, are prevented", () => {
  const bad = masterProblems("categories", { ...cat1, parentId: "c3" }, [cat1, cat2, cat3]);
  assert.ok(bad.some((x) => x.includes("ancestor")));
  const self = masterProblems("categories", { ...cat2, parentId: "c2" }, [cat1, cat2, cat3]);
  assert.ok(self.some((x) => x.includes("ancestor")));
});

test("category nesting shows grandchildren and orphaned categories", () => {
  const orphan = { ...cat1, id: "orphan", name: "Missing parent", parentId: "not-found" };
  const tree = categoryTree([cat3, cat1, orphan, cat2]);
  assert.deepEqual(tree.map(({ row, depth }) => [row.id, depth]), [["orphan", 0], ["c1", 0], ["c2", 1], ["c3", 2]]);
});

test("category default HSN and GST must be valid", () => {
  const problems = masterProblems("categories", { ...cat1, defaultHsn: "72xx", defaultGst: 17 }, [cat1]);
  assert.ok(problems.some((x) => x.includes("HSN")));
  assert.ok(problems.some((x) => x.includes("GST")));
});

test("brands require a nonblank name", () => {
  assert.ok(masterProblems("brands", { ...brand, name: "  " }).some((x) => x.includes("Brand")));
  assert.deepEqual(masterProblems("brands", brand), []);
});

test("HSN effective dates reject invalid calendar days and bad cess", () => {
  assert.equal(isoCalendarDate("2026-02-29"), false);
  assert.equal(isoCalendarDate("2024-02-29"), true);
  const issues = masterProblems("hsn", { ...rate, effectiveFrom: "2026-02-29", code: "721", cessPct: 100.001 });
  assert.ok(issues.some((x) => x.includes("effective date")));
  assert.ok(issues.some((x) => x.includes("HSN")));
  assert.ok(issues.some((x) => x.includes("Cess")));
});

test("historical HSN rates cannot be modified in place, but descriptions can", () => {
  assert.deepEqual(masterProblems("hsn", { ...rate, description: "Iron and non-alloy steel rods" }, [], rate), []);
  const issues = masterProblems("hsn", { ...rate, gstRate: 28 }, [], rate);
  assert.ok(issues.some((x) => x.includes("immutable")));
  assert.deepEqual(masterProblems("hsn", { ...rate, id: undefined, effectiveFrom: "2026-10-09", gstRate: 28 }), []);
});

test("search and active-state filters are applied only to matching rows", () => {
  const rows = [brand, { id: "b2", name: "Asian Paints", active: false }];
  assert.deepEqual(filterMasters("brands", rows, "asian", "all").map((x) => x.id), ["b2"]);
  assert.deepEqual(filterMasters("brands", rows, "  ", "active").map((x) => x.id), ["b1"]);
  assert.deepEqual(filterMasters("brands", rows, "paint", "inactive").map((x) => x.id), ["b2"]);
});

test("India master dates change at 00:00 IST rather than UTC midnight", () => {
  assert.equal(indiaMasterDate(new Date("2026-10-08T18:29:59Z")), "2026-10-08");
  assert.equal(indiaMasterDate(new Date("2026-10-08T18:30:00Z")), "2026-10-09");
});
