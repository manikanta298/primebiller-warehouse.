import { describe, it, expect } from "vitest";
import { adjustmentProblems, needsApproval, adjustmentValue, canApproveAdjustment } from "@/lib/adjustment-rules";

const line = { itemName: "Cement", direction: "down" as const, qty: 5, onHand: 10, unitCost: 340, trackBatches: false };

describe("adjustment rules", () => {
  it("requires a reason", () => expect(adjustmentProblems("", [line])).toContain("Choose a reason"));
  it("blocks reducing more than on hand", () => expect(adjustmentProblems("damage", [{ ...line, qty: 11 }])[0]).toMatch(/only 10 on hand/));
  it("found stock cannot reduce stock", () => expect(adjustmentProblems("found", [line]).length).toBe(1));
  it("increase needs a unit cost", () => expect(adjustmentProblems("found", [{ ...line, direction: "up", unitCost: 0 }])[0]).toMatch(/unit cost/));
  it("batch-tracked items need a batch", () => expect(adjustmentProblems("damage", [{ ...line, trackBatches: true }])[0]).toMatch(/batch/));
  it("valid damage passes", () => expect(adjustmentProblems("damage", [line])).toEqual([]));
  it("storekeeper above ₹25,000 needs approval", () => {
    expect(needsApproval("Storekeeper", 25001)).toBe(true);
    expect(needsApproval("Storekeeper", 25000)).toBe(false);
    expect(needsApproval("Manager", 900000)).toBe(false);
  });
  it("only Owner/Manager approve", () => {
    expect(canApproveAdjustment("Owner")).toBe(true);
    expect(canApproveAdjustment("Storekeeper")).toBe(false);
  });
  it("values up and down separately", () =>
    expect(adjustmentValue([{ direction: "up", qty: 2, unitCost: 100 }, { direction: "down", qty: 1, unitCost: 50 }])).toEqual({ up: 200, down: 50, net: 150, gross: 250 }));
});
