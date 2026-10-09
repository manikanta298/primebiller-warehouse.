import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { OrgSettings, OrgSettingsInput, ReasonCode } from "@/api/types";
import { isValidGstin, stateFromGstin } from "@/lib/gst";
import { settingsProblems } from "@/lib/admin-rules";
import { useSession } from "@/lib/session";
import { PageHeader, ErrorState, LoadingRows } from "@/components/app/states";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Girder" },
      { name: "description", content: "Organisation details, financial year, tax rules, reason codes and e-way bill provider." },
      { property: "og:title", content: "Settings — Girder" },
      { property: "og:description", content: "Organisation details, financial year, tax rules, reason codes and e-way bill provider." },
    ],
  }),
  component: Settings,
});

function Settings() {
  const orgId = useSession()?.orgId;
  const q = useQuery({ queryKey: ["settings", orgId], queryFn: api.getSettings, enabled: !!orgId });
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <Form key={orgId} initial={q.data!} />;
}

function Form({ initial }: { initial: OrgSettings }) {
  const qc = useQueryClient();
  const { gsp, ...rest } = initial;
  const [f, setF] = useState<OrgSettingsInput>({ ...rest, gsp: { provider: gsp.provider, username: gsp.username, clientId: gsp.clientId, sandbox: gsp.sandbox, secret: "" } });
  const set = (p: Partial<OrgSettingsInput>) => setF((x) => ({ ...x, ...p }));
  const problems = settingsProblems(f);
  const m = useMutation({
    mutationFn: () => api.saveSettings(f),
    onSuccess: (saved) => { toast.success("Settings saved"); qc.invalidateQueries({ queryKey: ["settings"] });
      const { gsp: savedGsp, ...base } = saved;
      setF({ ...base, gsp: { provider: savedGsp.provider, username: savedGsp.username, clientId: savedGsp.clientId, sandbox: savedGsp.sandbox, secret: "" } }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const gstinOk = isValidGstin(f.gstin);
  const txt = (k: keyof OrgSettingsInput, label: string, cls = "") => (
    <Field label={label}><Input className={cls} value={String(f[k] ?? "")} onChange={(e) => set({ [k]: e.target.value } as Partial<OrgSettingsInput>)} /></Field>
  );
  const setCode = (i: number, p: Partial<ReasonCode>) => set({ reasonCodes: f.reasonCodes.map((r, n) => (n === i ? { ...r, ...p } : r)) });

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (problems.length) { toast.error(problems[0]); return; } m.mutate(); }}>
      <PageHeader title="Settings" eyebrow="Operations" actions={<Button type="submit" disabled={m.isPending || problems.length > 0}>Save settings</Button>} />
      {problems.length > 0 && <p className="mb-3 text-sm text-destructive" role="alert">{problems[0]}</p>}
      <Tabs defaultValue="org">
        <TabsList className="flex-wrap">
          <TabsTrigger value="org">Organisation</TabsTrigger><TabsTrigger value="fy">Financial year</TabsTrigger>
          <TabsTrigger value="tax">Tax</TabsTrigger><TabsTrigger value="reasons">Reason codes</TabsTrigger><TabsTrigger value="gsp">E-way bill provider</TabsTrigger>
        </TabsList>
        <TabsContent value="org" className="grid gap-4 rounded-lg border bg-card p-5 md:grid-cols-2">
          {txt("legalName", "Legal name")}{txt("tradeName", "Trade name")}
          <Field label="GSTIN" error={f.gstin && !gstinOk ? "GSTIN checksum doesn't match" : null} hint={gstinOk ? `State code ${stateFromGstin(f.gstin)}` : undefined}>
            <Input className="num uppercase" value={f.gstin} onChange={(e) => { const gstin = e.target.value.toUpperCase(); set({ gstin, stateCode: stateFromGstin(gstin) ?? f.stateCode }); }} />
          </Field>
          {txt("pan", "PAN", "num uppercase")}
          <Field label="Address" className="md:col-span-2"><Textarea value={f.address} onChange={(e) => set({ address: e.target.value })} /></Field>
          {txt("phone", "Phone", "num")}{txt("email", "Email")}
          {txt("bankName", "Bank and branch")}{txt("bankAccount", "Account number", "num")}{txt("ifsc", "IFSC", "num uppercase")}{txt("jurisdiction", "Jurisdiction")}
          <Field label="Invoice terms" className="md:col-span-2"><Textarea value={f.invoiceTerms} onChange={(e) => set({ invoiceTerms: e.target.value })} /></Field>
        </TabsContent>
        <TabsContent value="fy" className="grid gap-4 rounded-lg border bg-card p-5 md:grid-cols-4">
          {txt("fyName", "Name")}
          <Field label="Starts"><Input type="date" value={f.fyStart} onChange={(e) => set({ fyStart: e.target.value })} /></Field>
          <Field label="Ends"><Input type="date" value={f.fyEnd} onChange={(e) => set({ fyEnd: e.target.value })} /></Field>
          <Field label="Status" hint="Closing records the year status. Automatic blocking of all document postings is not yet supported."><NativeSelect value={f.fyStatus} onChange={(e) => set({ fyStatus: e.target.value as "open" | "closed" })}><option value="open">Open</option><option value="closed">Closed</option></NativeSelect></Field>
        </TabsContent>
        <TabsContent value="tax" className="grid gap-4 rounded-lg border bg-card p-5 md:grid-cols-2">
          <label className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">Composition scheme<Switch checked={f.composition} onCheckedChange={(v) => set({ composition: v })} /></label>
          <Field label="Round-off"><NativeSelect value={f.roundOff} onChange={(e) => set({ roundOff: e.target.value as OrgSettings["roundOff"] })}><option value="nearest_rupee">Nearest rupee</option><option value="none">No rounding</option></NativeSelect></Field>
          <Field label="E-way bill needed above (₹)" hint="Fixed at ₹50,000 by GST rules."><Input className="num" value={f.ewbThreshold} disabled /></Field>
          <Field label="E-invoice turnover threshold (₹)"><Input className="num" type="number" value={f.einvoiceThreshold} onChange={(e) => set({ einvoiceThreshold: Number(e.target.value) })} /></Field>
          <Field label="Storekeeper adjustments need approval above (₹)"><Input className="num" type="number" value={f.adjApprovalLimit} onChange={(e) => set({ adjApprovalLimit: Number(e.target.value) })} /></Field>
        </TabsContent>
        <TabsContent value="reasons" className="rounded-lg border bg-card p-5">
          <div className="space-y-2">
            {f.reasonCodes.map((r, i) => (
              <div key={r.id} className="grid grid-cols-[150px_100px_1fr_auto] items-center gap-2">
                <NativeSelect value={r.type} onChange={(e) => setCode(i, { type: e.target.value as ReasonCode["type"] })}>{["adjustment", "return", "override", "cancellation"].map((t) => <option key={t}>{t}</option>)}</NativeSelect>
                <Input className="num uppercase" value={r.code} onChange={(e) => setCode(i, { code: e.target.value })} aria-label="Code" />
                <Input value={r.label} onChange={(e) => setCode(i, { label: e.target.value })} aria-label="Label" />
                <Switch checked={r.active} onCheckedChange={(v) => setCode(i, { active: v })} aria-label="Active" />
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" className="mt-3" onClick={() => set({ reasonCodes: [...f.reasonCodes, { id: `rc${Date.now()}`, type: "adjustment", code: "", label: "", active: true }] })}><Plus /> Add reason</Button>
        </TabsContent>
        <TabsContent value="gsp" className="grid gap-4 rounded-lg border bg-card p-5 md:grid-cols-2">
          <Field label="Provider"><Input value={f.gsp.provider} onChange={(e) => set({ gsp: { ...f.gsp, provider: e.target.value } })} /></Field>
          <Field label="Username"><Input value={f.gsp.username} onChange={(e) => set({ gsp: { ...f.gsp, username: e.target.value } })} /></Field>
          <Field label="Client ID"><Input value={f.gsp.clientId} onChange={(e) => set({ gsp: { ...f.gsp, clientId: e.target.value } })} /></Field>
          <Field label="Client secret" hint={gsp.secretSet ? "A secret is saved. Leave blank to keep it." : "Stored encrypted on the server and never shown again."}>
            <Input type="password" value={f.gsp.secret ?? ""} onChange={(e) => set({ gsp: { ...f.gsp, secret: e.target.value } })} />
          </Field>
          <label className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">Sandbox (test mode)<Switch checked={f.gsp.sandbox} onCheckedChange={(v) => set({ gsp: { ...f.gsp, sandbox: v } })} /></label>
        </TabsContent>
      </Tabs>
    </form>
  );
}
