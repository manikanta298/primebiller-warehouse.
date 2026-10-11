import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QuotationsPage } from "@/routes/_authenticated/quotations";
const mock = vi.hoisted(() => ({ role: "Owner", quote: null as any, navigate: vi.fn(), print: vi.fn(), api: { listQuotations: vi.fn(), getQuotation: vi.fn(), listParties: vi.fn(), listGodowns: vi.fn(), listItems: vi.fn(), saveQuotation: vi.fn(), quotationAction: vi.fn(), convertQuotation: vi.fn(), recordReceipt: vi.fn() } }));
vi.mock("@/api/client", () => ({ api: mock.api }));
vi.mock("@/lib/session", () => ({ useSession: () => ({ orgId: "org1", godownId: "all", user: { id: "u1", role: mock.role }, orgs: [{ id: "org1", name: "Test Business", gstin: "", stateCode: "36" }] }) }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options, useNavigate: () => mock.navigate, Link: ({ children }: any) => <a>{children}</a> }));
function setup() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><QuotationsPage /></QueryClientProvider>); }
beforeEach(() => {
  vi.clearAllMocks(); mock.role = "Owner";
  const date = new Date(Date.now() + 330 * 60_000).toISOString().slice(0,10);
  mock.quote = { id: "q1", number: "QT/26-27/00001", date, validUntil: "2099-12-31", customerId: "c1", customerName: "Test Customer", godownId: "g1", placeOfSupplyCode: "36", placeOfSupplyName: "Telangana", status: "issued", lines: [{ id: "l1", itemId: "i1", itemName: "Item", hsn: "1234", uom: "PCS", qty: 1, deliveredQty: 0, rate: 100, discountPct: 0, gstRate: 18 }], grandTotal: 118, supply: "intra", notes: "", terms: "Valid prices", linked: [], payments: [], createdAt: date, createdBy: "Owner" };
  mock.api.listQuotations.mockImplementation(async () => [mock.quote]);
  mock.api.getQuotation.mockImplementation(async () => mock.quote);
  mock.api.listParties.mockResolvedValue([{ id: "c1", name: "Test Customer", stateCode: "36" }]);
  mock.api.listGodowns.mockResolvedValue([{ id: "g1", name: "Warehouse One", code: "W1", active: true }]);
  mock.api.listItems.mockResolvedValue([{ id: "i1", name: "Item", sku: "I1", hsn: "1234", baseUom: "PCS", gstRate: 18, salePrice: 100, active: true }]);
  mock.api.quotationAction.mockImplementation(async (_id, action) => ({ ...mock.quote, status: action === "accept" ? "accepted" : action }));
  mock.api.convertQuotation.mockResolvedValue({ id: "so1" });
  vi.spyOn(window, "print").mockImplementation(mock.print);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("quotations UI", () => {
  it("records acceptance and converts without a mandatory payment", async () => {
    setup(); fireEvent.click(await screen.findByRole("button", { name: "QT/26-27/00001" }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(await screen.findByRole("button", { name: "Record acceptance" }));
    await waitFor(() => expect(mock.api.quotationAction).toHaveBeenCalledWith("q1", "accept"));
    fireEvent.click(await screen.findByRole("button", { name: "Convert to Sales Order" }));
    await waitFor(() => expect(mock.navigate).toHaveBeenCalledWith({ to: "/sales-orders/$id", params: { id: "so1" } }));
    expect(mock.api.recordReceipt).not.toHaveBeenCalled();
  });
  it("allows Accountant to view/print and record payments but hides acceptance and conversion", async () => {
    mock.role = "Accountant"; mock.quote.status = "accepted"; setup();
    fireEvent.click(await screen.findByRole("button", { name: "QT/26-27/00001" }));
    expect(await screen.findByRole("button", { name: "Record advance" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Convert to Sales Order" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Print / Save PDF" })); expect(mock.print).toHaveBeenCalledOnce();
    expect(document.getElementById("quotation-print")?.textContent).toContain("This quotation is not a tax invoice");
  });
  it("submits a new quotation with item master data and warehouse selection", async () => {
    mock.api.saveQuotation.mockResolvedValue({ ...mock.quote, status: "draft" }); setup();
    fireEvent.click(await screen.findByRole("button", { name: "New quotation" }));
    await screen.findByRole("option", { name: "Warehouse One (W1)" });
    fireEvent.change(screen.getByLabelText("Quotation customer"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("Quotation warehouse"), { target: { value: "g1" } });
    fireEvent.change(screen.getByLabelText("Item 1"), { target: { value: "i1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mock.api.saveQuotation).toHaveBeenCalled());
    const input = mock.api.saveQuotation.mock.calls[0]![0]; expect(input.customerId).toBe("c1"); expect(input.godownId).toBe("g1"); expect(input.lines[0]).toMatchObject({ itemId: "i1", hsn: "1234", gstRate: 18, rate: 100 });
  });
});
