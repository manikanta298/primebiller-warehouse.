import { describe, expect, it } from "vitest";
import { canDeactivateGodown, isValidGstin, rateOn, stateFromGstin } from "@/lib/gst";

describe("master rules", () => {
  it("accepts a GSTIN with a correct checksum", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
  });
  it("rejects a GSTIN with a wrong checksum", () => {
    expect(isValidGstin("27AAPFU0939F1ZA")).toBe(false);
  });
  it("reads state code from GSTIN", () => {
    expect(stateFromGstin("36AAJFR5521M1Z8")).toBe("36");
  });
  it("picks the HSN rate effective on the document date", () => {
    const rows = [
      { code: "2523", effectiveFrom: "2017-07-01", gstRate: 28 },
      { code: "2523", effectiveFrom: "2026-09-22", gstRate: 18 },
    ];
    expect(rateOn(rows, "2523", "2026-09-21")).toBe(28);
    expect(rateOn(rows, "2523", "2026-09-22")).toBe(18);
  });
  it("blocks deactivating a godown that holds stock", () => {
    expect(canDeactivateGodown(5)).toBe(false);
    expect(canDeactivateGodown(0)).toBe(true);
  });
});
