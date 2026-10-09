import { describe, it, expect } from "vitest";
import { transferProblems, receiveProblems, receivedStatus, isStuck } from "@/lib/transfer-rules";

const l = { itemName: "Cement", qty: 10, free: 50, trackBatches: false };
describe("transfer rules", () => {
  it("same godown blocked", () => expect(transferProblems("g1", "g1", [l])).toContain("From and to godown must be different"));
  it("cannot send more than free stock", () => expect(transferProblems("g1", "g2", [{ ...l, qty: 60 }])).toContain("Cement: only 50 free at the source godown"));
  it("batch required for tracked items", () => expect(transferProblems("g1", "g2", [{ ...l, trackBatches: true }])).toContain("Cement: choose a batch"));
  it("shortage needs a reason", () => {
    expect(receiveProblems([{ itemName: "Cement", sent: 10, received: 8 }])).toContain("Cement: give a reason for the shortage");
    expect(receiveProblems([{ itemName: "Cement", sent: 10, received: 8, reason: "Torn bags" }])).toEqual([]);
  });
  it("status", () => {
    expect(receivedStatus([{ sent: 10, received: 10 }])).toBe("received");
    expect(receivedStatus([{ sent: 10, received: 9 }])).toBe("partially_received");
  });
  it("stuck after 2 days", () => {
    expect(isStuck("2026-10-05", "2026-10-08")).toBe(true);
    expect(isStuck("2026-10-07", "2026-10-08")).toBe(false);
  });
});
