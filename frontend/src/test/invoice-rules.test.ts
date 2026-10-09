import { describe, it, expect } from "vitest";
import { applyAdvancesOldestFirst, dueDateFor, invoiceStatus, invoiceNumber, invoiceProblems } from "@/lib/invoice-rules";

describe("invoice rules", () => {
  it("applies advances oldest first", () => {
    const r = applyAdvancesOldestFirst([{ id: "b", date: "2026-10-05", remaining: 100000 }, { id: "a", date: "2026-09-28", remaining: 50000 }], 120000);
    expect(r).toEqual([{ advanceId: "a", amount: 50000 }, { advanceId: "b", amount: 70000 }]);
  });
  it("due date adds credit days", () => expect(dueDateFor("2026-10-08", 30)).toBe("2026-11-07"));
  it("status", () => {
    expect(invoiceStatus(100, 100, "2026-01-01", "2026-10-08")).toBe("paid");
    expect(invoiceStatus(100, 0, "2026-10-01", "2026-10-08")).toBe("overdue");
    expect(invoiceStatus(100, 40, "2026-11-01", "2026-10-08")).toBe("partially_paid");
  });
  it("gapless number", () => expect(invoiceNumber("SVT", "26-27", 288)).toBe("SVT/26-27/0288"));
  it("rejects undelivered or mixed challans", () => {
    expect(invoiceProblems([{ status: "in_transit", customerId: "p1", number: "DC1" }])).toContain("DC1 is not delivered yet");
    expect(invoiceProblems([{ status: "delivered", customerId: "p1", number: "A" }, { status: "delivered", customerId: "p2", number: "B" }])).toContain("All challans must be for the same customer");
  });
});

import { allocateReceipt } from "@/lib/invoice-rules";
describe("receipts", () => {
  it("pays oldest invoice first, excess becomes advance", () => {
    const r = allocateReceipt([{ id: "b", date: "2026-10-04", balance: 100 }, { id: "a", date: "2026-09-01", balance: 50 }], 200);
    expect(r.allocations).toEqual([{ invoiceId: "a", amount: 50 }, { invoiceId: "b", amount: 100 }]);
    expect(r.advance).toBe(50);
  });
  it("partial payment leaves no advance", () => {
    expect(allocateReceipt([{ id: "a", date: "2026-09-01", balance: 500 }], 200)).toEqual({ allocations: [{ invoiceId: "a", amount: 200 }], advance: 0 });
  });
});
