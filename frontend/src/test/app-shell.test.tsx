import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app/AppShell";
import type { Session } from "@/lib/session";

const router = vi.hoisted(() => ({ pathname: "/dashboard", navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => router.navigate,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { pathname: router.pathname } }),
  Link: ({ to, params, search, onClick, ...props }: any) => <a {...props} href={to} onClick={(event) => { event.preventDefault(); onClick?.(event); router.navigate({ to, params, search }); }} />,
}));
vi.mock("@/api/client", () => ({ usingMock: false, api: {
  listGodowns: async () => [], listNotifications: async () => [], getAlerts: async () => [],
  listItems: async () => [{ id: "item1", name: "Test item", sku: "TEST" }], listSalesOrders: async () => [],
} }));

const session: Session = { token: "test", orgId: "org1", godownId: "all", orgs: [{ id: "org1", name: "A very long organisation name for responsive headers", gstin: "", stateCode: "", stateName: "" }], user: { id: "u1", name: "Test Owner", email: "owner@example.com", role: "Owner" } };
let desktop = false;
let change: (() => void) | undefined;
function shell(role = session.user.role) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const app = <QueryClientProvider client={client}><AppShell session={{ ...session, user: { ...session.user, role } }}><h1>Dashboard content</h1></AppShell></QueryClientProvider>;
  return { ...render(app), app };
}
function tap(element: HTMLElement) {
  fireEvent.pointerDown(element, { pointerType: "touch", button: 0 });
  fireEvent.pointerUp(element, { pointerType: "touch", button: 0 });
  fireEvent.click(element); // Browsers synthesize click after a completed tap.
}

beforeEach(() => {
  router.pathname = "/dashboard"; router.navigate.mockClear(); desktop = false;
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    get matches() { return desktop; }, media: query, onchange: null,
    addEventListener: (_event, listener) => { change = listener as () => void; }, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true,
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Responsive app navigation", () => {
  it("opens on a touch tap and closes after tapping a navigation link", async () => {
    shell();
    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    tap(trigger);
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(drawer).getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    tap(within(drawer).getByRole("link", { name: "Items" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument());
    expect(router.navigate).toHaveBeenCalledWith(expect.objectContaining({ to: "/items" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("can close and reopen using the close button and Escape", async () => {
    shell();
    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    tap(trigger);
    tap(within(await screen.findByRole("dialog", { name: "Navigation" })).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    tap(trigger);
    await screen.findByRole("dialog", { name: "Navigation" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument());
  });

  it("dismisses on backdrop tap", async () => {
    shell();
    tap(screen.getByRole("button", { name: "Open navigation menu" }));
    await screen.findByRole("dialog", { name: "Navigation" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlay = document.querySelector<HTMLElement>('[data-state="open"].inset-0')!;
    fireEvent.pointerDown(overlay, { pointerType: "touch", button: 0 });
    fireEvent.click(overlay);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument());
  });

  it("closes on route changes and when resized to desktop", async () => {
    const view = shell();
    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    tap(trigger);
    await screen.findByRole("dialog", { name: "Navigation" });
    router.pathname = "/items";
    view.rerender(<QueryClientProvider client={new QueryClient()}><AppShell session={session}><h1>Items</h1></AppShell></QueryClientProvider>);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument());
    tap(trigger);
    await screen.findByRole("dialog", { name: "Navigation" });
    desktop = true; change?.();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument());
  });

  it("applies the same role restrictions to mobile navigation", async () => {
    shell("Driver");
    tap(screen.getByRole("button", { name: "Open navigation menu" }));
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    expect(within(drawer).getByRole("link", { name: "Delivery challans" })).toBeInTheDocument();
    expect(within(drawer).queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole("link", { name: "Users & roles" })).not.toBeInTheDocument();
  });

  it("search results respond to click activation used by touch and keyboard", async () => {
    shell();
    const search = screen.getByRole("textbox", { name: "Search items, orders, customers" });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "test" } });
    const result = await screen.findByRole("button", { name: /Test item/ });
    fireEvent.blur(search, { relatedTarget: result });
    expect(fireEvent.pointerDown(result, { pointerType: "touch", button: 0 })).toBe(false);
    tap(result);
    expect(router.navigate).toHaveBeenCalledWith({ to: "/items/$id", params: { id: "item1" } });
  });
});
