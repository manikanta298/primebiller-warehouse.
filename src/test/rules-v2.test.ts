import { describe, expect, it } from "vitest";
import { docNumber, fyLabel, seriesProblems } from "@/lib/numbering";
import { buildGstr1, receivables, B2CL_THRESHOLD } from "@/lib/reports";
import { filterDocs } from "@/lib/search-rules";
import { can } from "@/lib/permissions";
import { canAccess } from "@/lib/session";
import type { Invoice } from "@/api/types";

const inv = (p: Partial<Invoice>): Invoice => ({
  id: "i", number: "SVT/26-27/0001", date: "2026-10-05", dueDate: "2026-11-04", customerId: "c", customerName: "C", placeOfSupplyCode: "36", placeOfSupplyName: "Telangana",
  supply: "intra", challans: [], lines: [{ soLineId: "s", itemId: "x", itemName: "X", hsn: "2523", uom: "BAG", qty: 10, rate: 1000, discountPct: 0, gstRate: 28, allocations: [] }],
  taxable: 10000, cgst: 1400, sgst: 1400, igst: 0, roundOff: 0, grandTotal: 12800, byRate: [{ rate: 28, taxable: 10000, tax: 2800 }], advances: [], paid: 0, balance: 12800, status: "awaiting_payment", createdBy: "x", ...p,
});

describe("numbering", () => {
  it("pads to the configured digits", () => expect(docNumber("SO", "26-27", 42, 5)).toBe("SO/26-27/00042"));
  it("FY starts in April", () => { expect(fyLabel("2026-10-08")).toBe("26-27"); expect(fyLabel("2027-03-31")).toBe("26-27"); expect(fyLabel("2027-04-01")).toBe("27-28"); });
  it("locks invoice series once used", () => expect(seriesProblems({ docType: "INV", prefix: "INV", padding: 4 }, { lastNumber: 287, prefix: "SVT", padding: 4 })).toHaveLength(1));
  it("allows editing an unused invoice series", () => expect(seriesProblems({ docType: "INV", prefix: "INV", padding: 5 }, { lastNumber: 0, prefix: "SVT", padding: 4 })).toEqual([]));
});

describe("GSTR-1", () => {
  it("registered customer goes to B2B", () => expect(buildGstr1([inv({ gstin: "36AAJFR5521M1Z8" })], "2026-10", "G").b2b).toHaveLength(1));
  it("unregistered inter-state above ₹1,00,000 goes to B2CL", () => {
    const g = buildGstr1([inv({ supply: "inter", grandTotal: B2CL_THRESHOLD + 1, placeOfSupplyCode: "29" })], "2026-10", "G");
    expect(g.b2cl).toHaveLength(1);
    expect(g.b2cs).toHaveLength(0);
  });
  it("unregistered inter-state at ₹1,00,000 stays in B2CS", () => expect(buildGstr1([inv({ supply: "inter", grandTotal: 100000 })], "2026-10", "G").b2cs).toHaveLength(1));
  it("cancelled invoices only count in documents issued", () => {
    const g = buildGstr1([inv({ status: "cancelled" })], "2026-10", "G");
    expect(g.b2cs).toHaveLength(0);
    expect(g.docs[0]!.cancelled).toBe(1);
  });
  it("splits intra-state tax into equal CGST and SGST", () => { const r = buildGstr1([inv({})], "2026-10", "G").b2cs[0]!; expect([r.cgst, r.sgst, r.igst]).toEqual([1400, 1400, 0]); });
});

describe("receivables ageing", () => {
  it("45 days past due lands in 31–60", () => expect(receivables([inv({ dueDate: "2026-08-24" })], "2026-10-08")[0]!.d60).toBe(12800));
});

describe("search", () => {
  const docs = [
    { type: "INV" as const, id: "1", number: "SVT/26-27/0287", date: "2026-10-04", party: "Rajesh Constructions", amount: 386400, status: "overdue" },
    { type: "SO" as const, id: "2", number: "SO/26-27/0041", date: "2026-10-07", party: "Rajesh Constructions", amount: 50000, status: "confirmed" },
  ];
  it("matches party text", () => expect(filterDocs(docs, { q: "rajesh" }, "2026-10-08")).toHaveLength(2));
  it("filters by type and amount", () => expect(filterDocs(docs, { types: ["INV"], min: 100000 }, "2026-10-08").map((d) => d.id)).toEqual(["1"]));
  it("today filter excludes older docs", () => expect(filterDocs(docs, { period: "today" }, "2026-10-08")).toHaveLength(0));
});

describe("roles", () => {
  it("Accountant can issue invoices and open reports", () => { expect(can("Accountant", "issueInvoice")).toBe(true); expect(canAccess("Accountant", "/reports")).toBe(true); });
  it("Accountant cannot post stock", () => { expect(can("Accountant", "adjust")).toBe(false); expect(canAccess("Accountant", "/adjustments")).toBe(false); });
  it("Sales can manage orders and parties but not dispatch", () => { expect(can("Sales", "salesOrders")).toBe(true); expect(can("Sales", "editParties")).toBe(true); expect(can("Sales", "dispatch")).toBe(false); });
  it("only Owner manages users and settings", () => { expect(can("Manager", "manageUsers")).toBe(false); expect(canAccess("Manager", "/settings")).toBe(false); });
});
