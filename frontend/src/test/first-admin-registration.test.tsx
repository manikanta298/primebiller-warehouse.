import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FirstAdminRegistration } from "@/components/first-admin-registration";
import { api } from "@/api/client";
import { toast } from "sonner";

vi.mock("@/api/client", () => ({ api: { registerFirstAdmin: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function form() {
  const onSuccess = vi.fn(), onCancel = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <FirstAdminRegistration onSuccess={onSuccess} onCancel={onCancel} />
  </QueryClientProvider>);
  return { onSuccess, onCancel };
}

function fill() {
  for (const [label, value] of [
    ["Business name", "Test Traders"], ["Business GSTIN", "36AAXFS1234K1ZP"], ["Your name", "Test Owner"],
    ["Email", "owner@example.com"], ["Password", "secure-password-123"], ["Confirm password", "secure-password-123"],
    ["Private setup code", "a".repeat(64)],
  ]) fireEvent.change(screen.getByLabelText(label!), { target: { value } });
}

describe("First master-admin registration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires matching passwords and submits the setup code without selecting a role", async () => {
    const auth = { token: "test-token", user: { id: "u1", name: "Test Owner", email: "owner@example.com", role: "Owner" as const }, orgs: [] };
    vi.mocked(api.registerFirstAdmin).mockResolvedValue(auth);
    const { onSuccess } = form();
    fill();
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "different-password" } });
    expect(screen.getByRole("button", { name: "Create master admin" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "secure-password-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Create master admin" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(auth));
    expect(api.registerFirstAdmin).toHaveBeenCalledWith({ orgName: "Test Traders", orgGstin: "36AAXFS1234K1ZP", name: "Test Owner", email: "owner@example.com", password: "secure-password-123", mobile: "", setupCode: "a".repeat(64) });
  });

  it("shows API errors without logging in and supports returning to sign in", async () => {
    vi.mocked(api.registerFirstAdmin).mockRejectedValue(new Error("The master admin is already registered"));
    const { onSuccess, onCancel } = form();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create master admin" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The master admin is already registered"));
    expect(onSuccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
