import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SalesOrderEditor } from "@/routes/_authenticated/sales-orders.$id";
const mock = vi.hoisted(() => ({ api: { listParties: vi.fn(), listGodowns: vi.fn(), saveSalesOrder: vi.fn(), confirmSalesOrder: vi.fn() }, navigate: vi.fn() }));
vi.mock("@/api/client", () => ({ api: mock.api, ApiError: class extends Error {} }));
vi.mock("@/lib/session", () => ({ useSession: () => ({ orgId: "org1", godownId: "all", user: { id: "u1", role: "Owner" }, orgs: [{ id: "org1", name: "Business", stateCode: "36" }] }) }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options, useNavigate: () => mock.navigate, Link: ({ children }: any) => <a>{children}</a> }));
vi.mock("@/components/app/ItemPicker", () => ({ ItemPicker: () => <span>Item picker</span> }));
const line = { id: "persisted-line-id", itemId: "i1", itemName: "Item", hsn: "1234", uom: "PCS", qty: 2, deliveredQty: 0, rate: 100, discountPct: 5, gstRate: 18 };
const order = { id: "so1", number: null, date: "2026-10-13", customerId: "c1", customerName: "Customer", placeOfSupplyCode: "36", placeOfSupplyName: "Telangana", godownId: "g1", status: "draft" as const, notes: "", lines: [line], grandTotal: 224, linked: [] };
function setup() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SalesOrderEditor order={order} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.api.listParties.mockResolvedValue([{ id: "c1", name: "Customer", stateCode: "36", creditLimit: 0, outstanding: 0 }]);
  mock.api.listGodowns.mockResolvedValue([{ id: "g1", name: "Warehouse", active: true }]);
  mock.api.saveSalesOrder.mockResolvedValue(order);
  mock.api.confirmSalesOrder.mockResolvedValue({ ...order, number: "SO/26-27/00001", status: "confirmed" });
});
afterEach(cleanup);
function expectEditableLine() {
  const sent = mock.api.saveSalesOrder.mock.calls[0]![0];
  expect(sent.id).toBe("so1");
  expect(sent.lines).toEqual([{ itemId: "i1", itemName: "Item", hsn: "1234", uom: "PCS", qty: 2, rate: 100, discountPct: 5, gstRate: 18 }]);
  expect(sent.lines[0]).not.toHaveProperty("id");
  expect(sent.lines[0]).not.toHaveProperty("deliveredQty");
  expect(sent.lines[0]).not.toHaveProperty("key");
}
describe("saved Sales Order request lines", () => {
  it("saves a loaded draft using only editable line fields", async () => {
    setup(); fireEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    await waitFor(() => expect(mock.api.saveSalesOrder).toHaveBeenCalledOnce());
    expectEditableLine(); expect(mock.api.confirmSalesOrder).not.toHaveBeenCalled();
  });
  it("saves clean lines before Confirm & hold stock", async () => {
    setup(); fireEvent.click(screen.getByRole("button", { name: /Confirm & hold stock/ }));
    await waitFor(() => expect(mock.api.confirmSalesOrder).toHaveBeenCalledWith("so1", undefined));
    expectEditableLine();
  });
});
