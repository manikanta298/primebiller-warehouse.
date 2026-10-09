import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/api/client";
import { setSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/form-bits";

export const Route = createFileRoute("/accept-invite")({
  ssr: false,
  validateSearch: z.object({ token: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Set your password — Girder" },
      { name: "description", content: "Accept your Girder invite and choose a password." },
      { property: "og:title", content: "Set your password — Girder" },
      { property: "og:description", content: "Accept your Girder invite and choose a password." },
    ],
  }),
  component: AcceptInvite,
});

function AcceptInvite() {
  const { token = "" } = Route.useSearch();
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const m = useMutation({
    mutationFn: () => api.acceptInvite(token, pw),
    onSuccess: (res) => {
      setSession({ token: res.token, user: res.user, orgs: res.orgs, orgId: res.orgs[0]?.id ?? null, godownId: "all" });
      toast.success(`Welcome, ${res.user.name}`);
      navigate({ to: "/dashboard", replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const err = pw && pw.length < 8 ? "Use at least 8 characters" : pw2 && pw !== pw2 ? "Passwords don't match" : null;
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6" onSubmit={(e) => { e.preventDefault(); if (!err) m.mutate(); }}>
        <h1 className="text-xl font-semibold">Set your password</h1>
        {!token && <p className="text-sm text-destructive">This link is missing its invite code. Ask the owner to send it again.</p>}
        <Field label="New password"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Repeat password" error={err}><Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        <Button type="submit" className="w-full" disabled={!token || !pw || !!err || m.isPending}>Save and sign in</Button>
      </form>
    </div>
  );
}
