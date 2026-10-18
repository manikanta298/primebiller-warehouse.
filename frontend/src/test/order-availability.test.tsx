import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrderAvailability } from "@/components/app/OrderAvailability";
const m = vi.hoisted(() => ({ items: vi.fn(), transfers: vi.fn(), role: "Owner" }));
vi.mock("@/api/client", () => ({ api: { listItems: m.items, listTransfers: m.transfers } }));
vi.mock("@/lib/session", () => ({ useSession: () => ({ orgId: "org1", user: { role: m.role } }) }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ to, params, search, children, ...props }: any) => <a href={`${to.replace("$id", params?.id ?? "")}?${new URLSearchParams(search).toString()}`} {...props}>{children}</a> }));
const godowns = [{ id: "a", orgId: "org1", code: "A", name: "Dispatch", active: true }, { id: "b", orgId: "org1", code: "B", name: "Remote", active: true }];
function setup(unsaved = false) { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OrderAvailability orderId="so1" godownId="a" godowns={godowns} lines={[{ itemId: "i", qty: 2 }]} unsaved={unsaved} /></QueryClientProvider>); }
beforeEach(() => {
  m.role = "Owner";
  m.items.mockResolvedValue([{ id: "i", name: "Steel", baseUom: "KG", active: true, stock: [{ godownId: "a", onHand: 1, held: 1 }, { godownId: "b", onHand: 3, held: 0 }] }]);
  m.transfers.mockResolvedValue([]);
});
afterEach(cleanup);
it("shows local reservations and prepares the precise remote-to-dispatch transfer", async () => {
  setup(); const link = await screen.findByRole("link", { name: "Prepare transfer" });
  expect(link).toHaveAttribute("href", "/transfers/new?fromId=b&toId=a&itemId=i&qty=2&orderId=so1");
  expect(screen.getByText("Dispatch (dispatch)")).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Reserved" })).toBeInTheDocument();
});
it("preserves unsaved order edits by requiring a saved draft before transfer", async () => {
  setup(true); await screen.findByText("Save draft to prepare transfer"); expect(screen.queryByRole("link", { name: "Prepare transfer" })).not.toBeInTheDocument();
});
it("routes to receipt rather than dispatching duplicate incoming stock", async () => {
  m.transfers.mockResolvedValue([{ id: "tr1", number: "TRF1", toId: "a", fromName: "Remote", toName: "Dispatch", status: "in_transit", reason: "Fulfillment for sales order so1", lines: [{ itemId: "i", qty: 2 }] }]);
  setup(); const link = await screen.findByRole("link", { name: "Receive TRF1" }); expect(link).toHaveAttribute("href", "/transfers/tr1?orderId=so1"); expect(screen.queryByRole("link", { name: "Prepare transfer" })).not.toBeInTheDocument();
});
it("does not offer warehouse actions to Sales role", async () => {
  m.role = "Sales"; setup(); await screen.findByText("Ask a warehouse manager to transfer stock"); expect(screen.queryByRole("link", { name: "Prepare transfer" })).not.toBeInTheDocument();
});
