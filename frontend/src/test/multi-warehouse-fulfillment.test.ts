import { describe, it, expect, vi } from "vitest";
import { fulfillmentPlan, pipelineStatus } from "@/lib/fulfillment-plan";
import type { Item, Godown } from "@/api/types";
import { setSession } from "@/lib/session";
import * as mock from "@/api/mock";

const warehouses = [{ id: "a", name: "Dispatch", active: true }, { id: "b", name: "Remote", active: true }, { id: "c", name: "Closed", active: false }] as Godown[];
const item = { id: "i", name: "Steel", active: true, baseUom: "KG", stock: [{ godownId: "a", onHand: 3, held: 1 }, { godownId: "b", onHand: 8, held: 3 }, { godownId: "c", onHand: 100, held: 0 }] } as Item;

describe("multi-warehouse fulfillment", () => {
  it("maps every dashboard stage to the correct order filter", () => {
    expect(["Draft", "Confirmed", "Part delivered", "Delivered"].map(pipelineStatus)).toEqual(["draft", "confirmed", "partially_delivered", "delivered"]);
  });
  it("aggregates duplicate item lines, subtracts reservations and excludes inactive locations", () => {
    const [p] = fulfillmentPlan([{ itemId: "i", qty: 4 }, { itemId: "i", qty: 5 }], [item], warehouses, "a");
    expect(p?.localFree).toBe(2);
    expect(p?.locations.map(l => l.name)).toEqual(["Dispatch", "Remote"]);
    expect(p?.transfers).toEqual([{ fromId: "b", fromName: "Remote", qty: 5 }]);
    expect(p?.shortage).toBe(2);
  });
  it("does not suggest another transfer for this order's in-transit units", () => {
    const [p] = fulfillmentPlan([{ itemId: "i", qty: 6 }], [item], warehouses, "a", { i: 4 });
    expect(p?.localFree).toBe(2);
    expect(p?.inTransit).toBe(4);
    expect(p?.transfers).toEqual([]);
  });
  it("completes an order with local cement and remote plywood through transfer, receipt, delivery, invoice and payment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const seed = mock.__seedSnapshot();
    setSession({ token: "test-only", user: { id: "u1", name: "QA Owner", email: "qa@example.test", role: "Owner" }, orgs: seed.orgs, orgId: "org1", godownId: "all" });
    try {
      const before = await mock.listItems();
      const cement = before.find(i => i.id === "i1")!;
      const plywood = before.find(i => i.id === "i3")!;
      const lines = [cement, plywood].map(i => ({ itemId: i.id, itemName: i.name, hsn: i.hsn, uom: i.baseUom, qty: 1, rate: i.salePrice, discountPct: 0, gstRate: i.gstRate }));
      const plan = fulfillmentPlan(lines, before, await mock.listGodowns("org1"), "g1");
      expect(plan[0]?.transfers).toEqual([]);
      expect(plan[1]?.transfers).toEqual([{ fromId: "g2", fromName: "Jeedimetla", qty: 1 }]);
      const date = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
      const order = await mock.saveSalesOrder({ customerId: "p5", godownId: "g1", date, notes: "QA split-location fulfillment", lines });
      await expect(mock.confirmSalesOrder(order.id)).rejects.toMatchObject({ code: "insufficient_stock" });
      const t = await mock.dispatchTransfer({ fromId: "g2", toId: "g1", date, vehicleNo: "", reason: `Fulfillment for sales order ${order.id}`, lines: [{ itemId: plywood.id, qty: 1 }] });
      await expect(mock.confirmSalesOrder(order.id)).rejects.toMatchObject({ code: "insufficient_stock" });
      await mock.receiveTransfer(t.id, { lines: [{ received: 1 }] });
      const confirmed = await mock.confirmSalesOrder(order.id);
      expect(confirmed.status).toBe("confirmed");
      const dc = await mock.dispatchChallan({ soId: order.id, vehicleNo: "TS09EA1234", driverName: "QA Driver", driverPhone: "", transporter: "Own vehicle", distanceKm: 1, lines: confirmed.lines.map(l => ({ soLineId: l.id, qty: 1, allocations: [{ batchNo: l.itemId === cement.id ? "UT-2608-A" : "", qty: 1 }] })) });
      await mock.deliverChallan(dc.id, { receivedBy: "QA Receiver", remarks: "Automated test" });
      const invoice = await mock.issueInvoice({ challanIds: [dc.id], date, applyAdvances: false });
      const stockAfterInvoice = await mock.listItems();
      expect(stockAfterInvoice.find(i => i.id === plywood.id)?.stock.find(s => s.godownId === "g1")?.onHand).toBe(0);
      expect(stockAfterInvoice.find(i => i.id === plywood.id)?.stock.find(s => s.godownId === "g2")?.onHand).toBe(plywood.stock.find(s => s.godownId === "g2")!.onHand - 1);
      expect(stockAfterInvoice.find(i => i.id === cement.id)?.stock.find(s => s.godownId === "g1")?.onHand).toBe(cement.stock.find(s => s.godownId === "g1")!.onHand - 1);
      await mock.recordReceipt({ customerId: "p5", date, amount: invoice.grandTotal, mode: "cash", reference: "QA simulated", allocations: [{ invoiceId: invoice.id, amount: invoice.grandTotal }] });
      expect(await mock.getInvoice(invoice.id)).toMatchObject({ status: "paid", balance: 0 });
      expect((await mock.getSalesOrder(order.id)).status).toBe("delivered");
    } finally { setSession(null); vi.useRealTimers(); }
  }, 15000);
});
