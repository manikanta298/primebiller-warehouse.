import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { OrgSettings, PrintProfile } from "@/api/types";
import { useSession } from "@/lib/session";
import { normalisePrintProfile, printProfileProblems } from "@/lib/print-rules";
import { PageHeader, ErrorState, LoadingRows } from "@/components/app/states";
import { Field } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/print-profiles")({
  head: () => ({
    meta: [
      { title: "Print profiles — Girder" },
      { name: "description", content: "Configure 80 mm gate passes and A4 tax invoice printing." },
    ],
  }),
  component: PrintProfiles,
});

function PrintProfiles() {
  const session = useSession();
  const orgId = session?.orgId;
  const q = useQuery({ queryKey: ["print-profiles", orgId], queryFn: api.listPrintProfiles, enabled: !!orgId });
  const settings = useQuery({ queryKey: ["settings", orgId], queryFn: api.getSettings, enabled: !!orgId });
  return (
    <div>
      <PageHeader title="Print profiles" eyebrow="Operations" />
      <p className="mb-5 max-w-2xl text-sm text-muted-foreground">Profile A prints 80 mm gate passes, Profile B prints A4 tax invoices. Saved changes apply to subsequent prints; previously issued document data remains unchanged. The preview is illustrative, not an issued tax document.</p>
      {q.isLoading || settings.isLoading ? <LoadingRows /> : q.error || settings.error ? <ErrorState error={q.error || settings.error} onRetry={() => { q.refetch(); settings.refetch(); }} /> : !q.data?.length || !settings.data ? <p className="text-sm text-muted-foreground">No print profiles are configured for this organisation.</p> : (
        <div className="space-y-6">{q.data.map((p) => <Profile key={`${orgId}:${p.id}`} p={p} orgId={orgId!} settings={settings.data!} />)}</div>
      )}
    </div>
  );
}

const TOGGLES: [keyof PrintProfile, string][] = [
  ["showLogo", "Business initials mark"], ["showBank", "Bank details (invoices)"],
  ["showHsnSummary", "HSN tax summary"], ["showSignature", "Authorised signatory"],
  ["showQr", "QR code (not yet supported)"],
];

function Profile({ p, orgId, settings }: { p: PrintProfile; orgId: string; settings: OrgSettings }) {
  const qc = useQueryClient();
  const [f, setF] = useState(p);
  const problems = printProfileProblems(f, p.id);
  const dirty = JSON.stringify(normalisePrintProfile(f)) !== JSON.stringify(p);
  const m = useMutation({
    mutationFn: () => api.savePrintProfile(normalisePrintProfile(f)),
    onSuccess: (saved) => {
      setF(saved);
      toast.success(`Profile ${p.id} saved`);
      qc.invalidateQueries({ queryKey: ["print-profiles", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section className="grid gap-6 rounded-lg border bg-card p-5 lg:grid-cols-[1fr_auto]">
      <div className="space-y-4">
        <div><p className="eyebrow">Profile {p.id} · {p.paper}</p><h2 className="text-lg font-semibold">{p.name}</h2></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {TOGGLES.map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
              {label}
              <Switch aria-label={label} checked={!!f[k]} disabled={k === "showQr"} onCheckedChange={(v) => setF({ ...f, [k]: v })} />
            </label>
          ))}
        </div>
        {f.showQr && <p className="text-xs text-amber-700">QR printing is disabled until a verified UPI or e-invoice QR source is integrated; no placeholder QR is printed.</p>}
        {f.showLogo && <p className="text-xs text-muted-foreground">The organisation's initials are used as a brand mark; logo-image uploads are not supported yet.</p>}
        <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
          <Field label="Copies"><Input className="num" type="number" min={1} max={5} step={1} value={f.copies} onChange={(e) => setF({ ...f, copies: Number(e.target.value) })} /></Field>
          <Field label="Footer line"><Input maxLength={160} value={f.footer} onChange={(e) => setF({ ...f, footer: e.target.value })} /></Field>
        </div>
        {problems.map((message) => <p key={message} role="alert" className="text-xs text-destructive">{message}</p>)}
        <div className="flex gap-2">
          <Button disabled={m.isPending || !dirty || problems.length > 0} onClick={() => m.mutate()}>{m.isPending ? "Saving…" : `Save profile ${p.id}`}</Button>
          <Button variant="outline" disabled={!dirty || m.isPending} onClick={() => setF(p)}>Discard</Button>
        </div>
        {dirty && <p className="text-xs text-muted-foreground">Unsaved changes — printing an actual document will use the last saved profile.</p>}
      </div>
      <Preview f={f} settings={settings} />
    </section>
  );
}

function Preview({ f, settings }: { f: PrintProfile; settings: OrgSettings }) {
  const thermal = f.paper === "80mm";
  return (
    <div className={cn("num mx-auto h-fit rounded border bg-background p-3 text-[10px] leading-tight shadow-sm", thermal ? "w-[200px]" : "w-[280px]")} aria-label="Illustrative print preview">
      <p className="mb-2 border-b pb-1 text-center font-bold">SAMPLE PREVIEW · NOT ISSUED</p>
      {f.showLogo && <div className="mx-auto mb-1 flex h-7 w-10 items-center justify-center border text-[9px] font-bold">{(settings.tradeName || settings.legalName).split(/\s+/).map((s) => s[0]).slice(0, 3).join("")}</div>}
      <p className="text-center font-bold">{settings.legalName || "Your organisation"}</p>
      <p className="text-center">GSTIN: {settings.gstin || "Not configured"}</p>
      <p className="my-1 text-center font-semibold">{thermal ? "GATE PASS" : "TAX INVOICE"}</p>
      <div className="border-y border-dashed py-1">
        <div className="flex justify-between"><span>Sample item × 1</span><span>₹100.00</span></div>
        <div className="flex justify-between"><span>GST 18%</span><span>₹18.00</span></div>
      </div>
      {f.showHsnSummary && <p className="mt-1">Sample HSN 0000 @18%</p>}
      <div className="mt-1 flex justify-between font-bold"><span>Total (sample)</span><span>₹118.00</span></div>
      {!thermal && f.showBank && settings.bankName && settings.bankAccount && settings.ifsc && <p className="mt-1">{settings.bankName} · A/c {settings.bankAccount} · IFSC {settings.ifsc}</p>}
      {f.showSignature && <p className="mt-5 text-right">Authorised signatory</p>}
      <p className="mt-2 text-center">{f.footer}</p>
      <p className="mt-1 text-center text-muted-foreground">{f.copies} {f.copies === 1 ? "sheet" : "sheets"} printed</p>
    </div>
  );
}
