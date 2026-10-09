import { describe, expect, it } from "vitest";
import { canCancelEwb, dispatchProblems, ewbValidityDays, fifoAllocate, isManualOverride } from "@/lib/challan-rules";

const batches = [
  { batchNo: "NEW", qty: 500, receivedDate: "2026-07-08" },
  { batchNo: "OLD", qty: 200, receivedDate: "2026-03-02" },
];
const t = { vehicleNo: "TS09EA1234", driverName: "Yadagiri", distanceKm: 20 };

describe("challan rules", () => {
  it("allocates oldest-received batch first", () => {
    expect(fifoAllocate(batches, 300)).toEqual({ allocations: [{ batchNo: "OLD", qty: 200 }, { batchNo: "NEW", qty: 100 }], short: 0 });
  });
  it("reports shortfall when batches run out", () => {
    expect(fifoAllocate(batches, 800).short).toBe(100);
  });
  it("detects manual batch override", () => {
    expect(isManualOverride([{ batchNo: "NEW", qty: 300 }], fifoAllocate(batches, 300).allocations)).toBe(true);
    expect(isManualOverride([{ batchNo: "NEW", qty: 100 }, { batchNo: "OLD", qty: 200 }], fifoAllocate(batches, 300).allocations)).toBe(false);
  });
  it("gives 1 day of EWB validity per 200 km", () => {
    expect(ewbValidityDays(18)).toBe(1);
    expect(ewbValidityDays(200)).toBe(1);
    expect(ewbValidityDays(201)).toBe(2);
  });
  it("allows EWB cancel only within 24 hours", () => {
    expect(canCancelEwb("2026-10-08T10:00:00Z", "2026-10-09T09:59:00Z")).toBe(true);
    expect(canCancelEwb("2026-10-08T10:00:00Z", "2026-10-09T10:00:00Z")).toBe(false);
  });
  it("requires distance for e-way bill above ₹50,000 only", () => {
    const line = [{ qty: 10, pending: 10, allocated: 10 }];
    expect(dispatchProblems(line, 50001, { ...t, distanceKm: 0 }, false, "")).toContain("Distance is needed for the e-way bill");
    expect(dispatchProblems(line, 50000, { ...t, distanceKm: 0 }, false, "")).toEqual([]);
  });
  it("blocks over-delivery and FIFO override without reason", () => {
    const p = dispatchProblems([{ qty: 12, pending: 10, allocated: 12 }], 1000, t, true, "");
    expect(p.some((x) => x.includes("only 10 pending"))).toBe(true);
    expect(p.some((x) => x.includes("FIFO"))).toBe(true);
  });
});
