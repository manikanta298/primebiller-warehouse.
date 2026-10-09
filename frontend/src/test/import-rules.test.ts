import { describe, expect, it } from "vitest";
import { autoMap, parseCsv, validateRows } from "@/lib/import-rules";

describe("bulk import rules", () => {
  it("parses quoted CSV cells", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
  it("auto-maps headers by alias", () => {
    expect(autoMap("items", ["Item Code", "Item Name", "HSN Code", "GST", "UOM"])).toMatchObject({ sku: 0, name: 1, hsn: 2, gstRate: 3, baseUom: 4 });
  });
  it("rejects SKU already in the system and repeated in the file", () => {
    const row = { sku: "A1", name: "x", hsn: "2523", gstRate: "28", baseUom: "BAG" };
    const e = validateRows("items", [row, { ...row, sku: "B1" }, { ...row, sku: "B1" }], { skus: ["a1"] });
    expect(e[0]!["sku"]).toMatch(/already exists/);
    expect(e[1]).toEqual({});
    expect(e[2]!["sku"]).toMatch(/repeated/);
  });
  it("rejects invalid GST rate and HSN", () => {
    const e = validateRows("items", [{ sku: "A", name: "x", hsn: "25", gstRate: "15", baseUom: "BAG" }]);
    expect(Object.keys(e[0]!).sort()).toEqual(["gstRate", "hsn"]);
  });
  it("requires state code for parties without GSTIN", () => {
    expect(validateRows("parties", [{ name: "x", kind: "customer" }])[0]!["stateCode"]).toBeTruthy();
    expect(validateRows("parties", [{ name: "x", kind: "customer", stateCode: "36" }])[0]).toEqual({});
  });
  it("rejects duplicate warehouse code", () => {
    expect(validateRows("warehouses", [{ code: "BLN", name: "x", stateCode: "36" }], { codes: ["BLN"] })[0]!["code"]).toBeTruthy();
  });
});
