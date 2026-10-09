import { useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Building2, ChevronRight, Loader2 } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { api, usingMock } from "@/api/client";
import type { LoginResponse } from "@/api/types";
import { getSession, setSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  ssr: false,
  validateSearch: z.object({ redirect: z.string().optional(), reset: z.string().optional() }),
  beforeLoad: ({ search }) => {
    const s = getSession();
    if (s?.orgId && !search.reset) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "Sign in — Girder" },
      { name: "description", content: "Sign in to Girder to manage stock, sales orders and GST invoices." },
      { property: "og:title", content: "Sign in — Girder" },
      { property: "og:description", content: "Sign in to Girder to manage stock, sales orders and GST invoices." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect: back, reset: resetToken } = Route.useSearch();
  const [recover, setRecover] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetComplete, setResetComplete] = useState(false);
  const [email, setEmail] = useState(usingMock ? "owner@svt.in" : "");
  const [password, setPassword] = useState(usingMock ? "girder" : "");
  const [auth, setAuth] = useState<LoginResponse | null>(null);

  const login = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess: (res) => {
      if (res.orgs.length === 1 && res.orgs[0]) choose(res, res.orgs[0].id);
      else setAuth(res);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const forgot = useMutation({
    mutationFn: () => api.forgotPassword(email),
    onSuccess: () => setRecoverySent(true),
    onError: (e: Error) => toast.error(e.message),
  });
  const resetPassword = useMutation({
    mutationFn: () => api.resetPassword(resetToken || "", newPassword),
    onSuccess: () => { setSession(null); setResetComplete(true); toast.success("Password updated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  function choose(res: LoginResponse, orgId: string) {
    setSession({ token: res.token, user: res.user, orgs: res.orgs, orgId, godownId: "all" });
    toast.success(`Welcome, ${res.user.name}`);
    if (back && back.startsWith("/") && !back.startsWith("/login")) navigate({ to: back, replace: true });
    else navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="relative hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-md bg-sidebar-primary font-mono font-bold text-sidebar-primary-foreground">G</div>
          <span className="text-lg font-semibold text-sidebar-accent-foreground">Girder</span>
        </div>
        <div>
          <p className="max-w-md text-3xl font-semibold leading-tight tracking-tight text-sidebar-accent-foreground">
            Every bag, rod and sheet — across every godown — billed right the first time.
          </p>
          <div className="num mt-8 grid max-w-md grid-cols-3 gap-4 text-sm">
            {[["₹1.42 Cr", "stock tracked"], ["3", "godowns"], ["GSTR-1", "ready"]].map(([a, b]) => (
              <div key={b} className="border-l border-sidebar-primary pl-3">
                <div className="text-lg text-sidebar-accent-foreground">{a}</div>
                <div className="font-sans text-xs opacity-60">{b}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="text-xs opacity-50">Made for Indian traders · CGST · SGST · IGST · E-way bill</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {resetToken ? (
            resetComplete ? (
              <div className="space-y-5">
                <h1 className="text-2xl font-semibold tracking-tight">Password updated</h1>
                <p className="text-sm text-muted-foreground">Your password has been changed and earlier sessions were signed out.</p>
                <Button className="w-full" onClick={() => navigate({ to: "/login", search: {}, replace: true })}>Back to sign in</Button>
              </div>
            ) : (
              <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (newPassword === confirmPassword) resetPassword.mutate(); }}>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">Reset password</h1>
                  <p className="mt-1 text-sm text-muted-foreground">Choose a new password for your Girder account.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input id="new-password" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
                  <p className="text-xs text-muted-foreground">At least 10 characters.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
                  {confirmPassword && confirmPassword !== newPassword && <p className="text-xs text-destructive">Passwords do not match.</p>}
                </div>
                <Button type="submit" className="w-full" disabled={resetPassword.isPending || newPassword.length < 10 || newPassword !== confirmPassword}>
                  {resetPassword.isPending && <Loader2 className="animate-spin" />} Update password
                </Button>
                <button type="button" className="text-sm text-primary hover:underline" onClick={() => navigate({ to: "/login", search: {}, replace: true })}>Back to sign in</button>
              </form>
            )
          ) : recover ? (
            <div className="space-y-5">
              {recoverySent ? (
                <>
                  <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
                  <p className="text-sm text-muted-foreground">If an active account exists for that address, a password reset link is on its way. It expires in one hour.</p>
                </>
              ) : (
                <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); forgot.mutate(); }}>
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Forgot password?</h1>
                    <p className="mt-1 text-sm text-muted-foreground">Enter your Girder account email to receive a reset link.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="recovery-email">Email</Label>
                    <Input id="recovery-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  <Button type="submit" className="w-full" disabled={forgot.isPending}>
                    {forgot.isPending && <Loader2 className="animate-spin" />} Send reset link
                  </Button>
                </form>
              )}
              <button type="button" className="text-sm text-primary hover:underline" onClick={() => { setRecover(false); setRecoverySent(false); }}>Back to sign in</button>
            </div>
          ) : !auth ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                login.mutate();
              }}
              className="space-y-5"
            >
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
                <p className="mt-1 text-sm text-muted-foreground">Use your Girder account.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <div className="flex justify-end">
                  <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setRecover(true)}>Forgot password?</button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={login.isPending}>
                {login.isPending && <Loader2 className="animate-spin" />} Sign in
              </Button>
              {usingMock && (
                <div className="rounded-md border bg-card p-3 text-xs text-muted-foreground">
                  <div className="mb-1 font-medium text-foreground">Demo accounts · password “girder”</div>
                  {["owner", "manager", "store", "driver"].map((r) => (
                    <button key={r} type="button" className="num mr-3 text-primary hover:underline" onClick={() => setEmail(`${r}@svt.in`)}>
                      {r}@svt.in
                    </button>
                  ))}
                </div>
              )}
            </form>
          ) : (
            <div className="space-y-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Choose organisation</h1>
                <p className="mt-1 text-sm text-muted-foreground">Signed in as {auth.user.name} · {auth.user.role}</p>
              </div>
              {auth.orgs.map((o) => (
                <button
                  key={o.id}
                  onClick={() => choose(auth, o.id)}
                  className="flex w-full items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary"
                >
                  <Building2 className="size-5 text-primary" />
                  <div className="flex-1">
                    <div className="font-medium">{o.name}</div>
                    <div className="num text-xs text-muted-foreground">{o.gstin} · {o.stateName}</div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
