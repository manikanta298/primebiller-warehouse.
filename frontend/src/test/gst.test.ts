import { describe, expect, it } from "vitest";
import { canOverrideCredit, computeTotals, creditCheck, ewayBillRequired, supplyType } from "@/lib/gst";
import { formatCompactINR, formatDate, formatINR } from "@/lib/format";

describe("GST rules", () => {
  it("same state is CGST+SGST, different state is IGST", () => {
    expect(supplyType("36", "36")).toBe("intra");
    expect(supplyType("36", "37")).toBe("inter");
  });
  it("splits intra-state tax equally", () => {
    const t = computeTotals([{ qty: 10, rate: 385, discountPct: 0, gstRate: 28 }], "intra");
    expect(t.taxable).toBe(3850);
    expect(t.cgst).toBe(539);
    expect(t.sgst).toBe(539);
    expect(t.grandTotal).toBe(4928);
  });
  it("inter-state uses IGST only", () => {
    const t = computeTotals([{ qty: 1, rate: 1000, discountPct: 0, gstRate: 18 }], "inter");
    expect(t.igst).toBe(180);
    expect(t.cgst).toBe(0);
  });
  it("flags orders above available credit", () => {
    expect(creditCheck(1500000, 1185000, 400000).exceeds).toBe(true);
    expect(creditCheck(1500000, 1185000, 300000).exceeds).toBe(false);
  });
  it("only Owner overrides credit", () => {
    expect(canOverrideCredit("Owner")).toBe(true);
    expect(canOverrideCredit("Manager")).toBe(false);
  });
  it("e-way bill above ₹50,000", () => {
    expect(ewayBillRequired(50000)).toBe(false);
    expect(ewayBillRequired(50001)).toBe(true);
  });
});

describe("Indian formats", () => {
  it("formats rupees and dates", () => {
    expect(formatINR(14200000, 0)).toBe("₹1,42,00,000");
    expect(formatCompactINR(14200000)).toBe("₹1.42 Cr");
    expect(formatCompactINR(350000)).toBe("₹3.5 L");
    expect(formatDate("2026-09-22")).toBe("22 Sep 2026");
  });
});
