import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseImportBytes } from "@/lib/import-parse";

const enc = (s: string) => new TextEncoder().encode(s);

describe("bulk import parsing", () => {
  it("reads Excel files", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["SKU", "Name"], ["A1", "Bag"]]), "S");
    expect(parseImportBytes(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })))).toEqual({ grid: [["SKU", "Name"], ["A1", "Bag"]] });
  });
  it("reads JSON arrays of objects", () => {
    expect(parseImportBytes(enc('[{"SKU":"A1","Name":"Bag"}]'))).toEqual({ grid: [["SKU", "Name"], ["A1", "Bag"]] });
  });
  it("turns a Google Sheets link into its export address", () => {
    expect(parseImportBytes(enc("https://docs.google.com/spreadsheets/d/abc123/edit#gid=7"))).toEqual({ sheetUrl: "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=7" });
  });
});
