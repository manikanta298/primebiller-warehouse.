import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const m = vi.hoisted(() => ({ dashboard: vi.fn() }));
vi.mock("@/api/client", () => ({ api: { getDashboard: m.dashboard } }));
vi.mock("@/lib/session", () => ({ useSession: () => ({ orgId: "org1", godownId: "g2", user: { role: "Owner" } }), canAccess: () => true }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options, Link: ({ to, search, children }: any) => <a href={`${to}?${new URLSearchParams(search).toString()}`}>{children}</a> }));
import { Route } from "@/routes/_authenticated/dashboard";
afterEach(cleanup);
it("dashboard pipeline links carry both the selected status and warehouse", async () => {
  m.dashboard.mockResolvedValue({ asOfDate: "2026-10-18", stockValue: 0, movementsToday: 0, nearExpiry: 0, overAged: 0, lowStock: 0, outOfStock: 0, valueByGodown: [], highValueMovements: [], attention: [], pipeline: ["Draft", "Confirmed", "Part delivered", "Delivered"].map(stage => ({ stage, count: 1, value: 100 })) });
  const Page = (Route as unknown as { component: React.ComponentType }).component;
  render(<QueryClientProvider client={new QueryClient()}><Page /></QueryClientProvider>);
  for (const [stage, status] of [["Draft", "draft"], ["Confirmed", "confirmed"], ["Part delivered", "partially_delivered"], ["Delivered", "delivered"]]) {
    expect(await screen.findByRole("link", { name: new RegExp(`^${stage}`) })).toHaveAttribute("href", `/sales-orders?status=${status}&godownId=g2`);
  }
});
