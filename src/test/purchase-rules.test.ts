import { describe, it, expect } from "vitest";
import { apportionFreight, weightedAverageCost, grnLineProblems, poStatus } from "@/lib/purchase-rules";

const base = { itemName: "TMT", received: 100, rejected: 0, trackBatches: true, batchNo: "H1", rate: 60 };
describe("purchase rules", () => {
  it("apportions freight by value and sums exactly", () => {
    const s = apportionFreight([3000, 1000], 1000);
    expect(s).toEqual([750, 250]);
    expect(apportionFreight([1, 1, 1], 100).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("weighted average cost", () => expect(weightedAverageCost(100, 50, 100, 70)).toBe(60));
  it("batch required for tracked items", () => expect(grnLineProblems({ ...base, batchNo: "" })).toContain("TMT: batch / heat no. is required"));
  it("rejected needs reason and cannot exceed received", () => {
    expect(grnLineProblems({ ...base, rejected: 5 })).toContain("TMT: give a rejection reason");
    expect(grnLineProblems({ ...base, rejected: 101, rejectionReason: "x" })).toContain("TMT: rejected cannot exceed received");
  });
  it("cannot receive more than pending", () => expect(grnLineProblems({ ...base, pending: 50 })).toHaveLength(1));
  it("PO status", () => {
    expect(poStatus([{ qty: 10, receivedQty: 0 }])).toBe("open");
    expect(poStatus([{ qty: 10, receivedQty: 4 }])).toBe("partially_received");
    expect(poStatus([{ qty: 10, receivedQty: 10 }])).toBe("received");
  });
});
