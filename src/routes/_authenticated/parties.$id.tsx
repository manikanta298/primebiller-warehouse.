import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Party, PartyInput, PartyKind } from "@/api/types";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { creditCheck, isValidGstin, stateFromGstin } from "@/lib/gst";
import { normaliseParty, partyProblems, partyStateName } from "@/lib/party-rules";
import { formatINR } from "@/lib/format";
import { PageHeader, ErrorState, LoadingRows } from "@/components/app/states";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/parties/$id")({
  head: () => ({
    meta: [
      { title: "Party — Girder" },
      { name: "description", content: "Party details, GSTIN, credit terms and outstanding." },
      { property: "og:title", content: "Party — Girder" },
      { property: "og:description", content: "Party details, GSTIN, credit terms and outstanding." },
    ],
  }),
  component: PartyPage,
});

const BLANK: PartyInput = {
  kind: "customer", name: "", tradeName: "", gstin: "", pan: "", phone: "", email: "", address: "", city: "", pin: "",
  stateCode: "36", creditLimit: 0, creditDays: 30, blocked: false,
};

/** Deliberately excludes outstanding/stateName, which are not editable master fields. */
function toInput(p: Party): PartyInput {
  return { id: p.id, kind: p.kind, name: p.name, tradeName: p.tradeName ?? "", gstin: p.gstin ?? "", pan: p.pan ?? "",
    phone: p.phone, email: p.email ?? "", address: p.address ?? "", city: p.city, pin: p.pin ?? "", stateCode: p.stateCode,
    creditLimit: p.creditLimit, creditDays: p.creditDays ?? 30, blocked: !!p.blocked };
}

function PartyPage() {
  const { id } = Route.useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useSession();
  const orgId = session?.orgId ?? "";
  const canEdit = can(session?.user.role, "editParties");
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["party", orgId, id], queryFn: () => api.getParty(id), enabled: !isNew && !!orgId });
  const [initial, setInitial] = useState<PartyInput>({ ...BLANK });
  const [d, setD] = useState<PartyInput>({ ...BLANK });
  const [serverError, setServerError] = useState("");
  useEffect(() => { setD({ ...BLANK }); setInitial({ ...BLANK }); setServerError(""); }, [orgId, id]);
  useEffect(() => { if (data) { const next = toInput(data); setD(next); setInitial(next); } }, [data]);
  const set = <K extends keyof PartyInput>(k: K, v: PartyInput[K]) => { setD((x) => ({ ...x, [k]: v })); setServerError(""); };
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const issues = partyProblems(d);
  const gstin = d.gstin ?? "";
  const gstinErr = issues.find((i) => i.includes("GSTIN")) ?? null;
  const isCustomer = d.kind === "customer" || d.kind === "both";
  const cc = data ? creditCheck(data.creditLimit, data.outstanding, 0) : null;
  const confirmDiscard = () => !dirty || window.confirm("Discard unsaved party changes?");
  const goBack = () => { if (confirmDiscard()) navigate({ to: "/parties" }); };

  const m = useMutation({
    mutationFn: () => api.saveParty(normaliseParty(d)),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["parties", orgId] });
      qc.setQueryData(["party", orgId, p.id], p);
      const saved = toInput(p);
      setD(saved); setInitial(saved); setServerError("");
      toast.success("Party saved");
      if (isNew) navigate({ to: "/parties/$id", params: { id: p.id }, replace: true });
    },
    onError: (e: Error) => { setServerError(e.message); toast.error(e.message); },
  });
  const doSave = () => { if (canEdit && !issues.length && !m.isPending && (dirty || isNew)) m.mutate(); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); doSave(); }
    };
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("beforeunload", onUnload); };
  });

  if (!isNew && isLoading) return <LoadingRows />;
  if (!isNew && error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isNew && !canEdit) return <ErrorState error={new Error("Your role cannot create parties")} />;

  return (
    <div className="pb-20">
      <Link to="/parties" onClick={(e) => { if (!confirmDiscard()) e.preventDefault(); }} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Parties</Link>
      <PageHeader title={isNew ? "New party" : data?.name ?? ""} eyebrow="Masters · Party">
        {data && <div className="mt-1 text-sm text-muted-foreground">{data.stateName}{data.gstin && <> · <span className="num">{data.gstin}</span></>}</div>}
      </PageHeader>
      {cc && isCustomer && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Outstanding" value={formatINR(cc.outstanding, 0)} />
          <Stat label="Credit limit" value={cc.limit ? formatINR(cc.limit, 0) : "No limit"} />
          <Stat label="Headroom" value={cc.limit ? formatINR(cc.available, 0) : "–"} tone={cc.limit > 0 && cc.available < cc.limit * 0.25} />
          <Stat label="Terms" value={`Net ${data?.creditDays ?? 0}`} />
        </div>
      )}
      {data && d.kind === "supplier" && (
        <div className="mb-6 grid grid-cols-2 gap-3">
          <Stat label="Outstanding payable" value={formatINR(data.outstanding, 0)} />
          <Stat label="Payment terms" value={`Net ${data.creditDays ?? 0}`} />
        </div>
      )}
      {!canEdit && <p className="mb-4 text-sm text-muted-foreground">Read-only party details. Only Owner, Manager, and Sales roles can edit.</p>}
      {serverError && <p role="alert" className="mb-4 text-sm text-destructive">{serverError}</p>}
      <form className="grid gap-6 lg:grid-cols-2" onSubmit={(e) => { e.preventDefault(); doSave(); }}>
        <fieldset disabled={!canEdit} className="contents">
        <section className="space-y-3 rounded-lg border bg-card p-5">
          <h2 className="eyebrow">Identity</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <NativeSelect value={d.kind} onChange={(e) => set("kind", e.target.value as PartyKind)}>
                <option value="customer">Customer</option><option value="supplier">Supplier</option>
                <option value="both">Customer & supplier</option><option value="transporter">Transporter</option>
              </NativeSelect>
            </Field>
            <Field label="Name" error={issues.find((i) => i.startsWith("Party name"))}><Input autoFocus={isNew} value={d.name} maxLength={200} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Trade name"><Input value={d.tradeName ?? ""} maxLength={200} onChange={(e) => set("tradeName", e.target.value)} /></Field>
            <Field label="PAN" error={issues.find((i) => i.startsWith("PAN"))}><Input value={d.pan ?? ""} maxLength={10} onChange={(e) => set("pan", e.target.value.toUpperCase())} className="num" /></Field>
            <Field label="GSTIN" hint="Leave blank for unregistered" error={gstinErr} className="col-span-2">
              <Input
                value={gstin} maxLength={15} className="num"
                onChange={(e) => {
                  const g = e.target.value.toUpperCase();
                  setD((x) => ({ ...x, gstin: g, ...(g.length >= 12 ? { pan: g.slice(2, 12) } : {}), ...(g.length >= 2 && isValidGstin(g) ? { stateCode: stateFromGstin(g) } : {}) }));
                  setServerError("");
                }}
              />
            </Field>
          </div>
        </section>
        <section className="space-y-3 rounded-lg border bg-card p-5">
          <h2 className="eyebrow">Contact & address</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mobile" error={issues.find((i) => i.startsWith("Enter a valid contact"))}><Input value={d.phone} maxLength={40} onChange={(e) => set("phone", e.target.value)} className="num" /></Field>
            <Field label="Email" error={issues.find((i) => i.startsWith("Enter a valid email"))}><Input type="email" value={d.email ?? ""} maxLength={190} onChange={(e) => set("email", e.target.value)} /></Field>
            <Field label="Billing address" className="col-span-2"><Input value={d.address ?? ""} maxLength={400} onChange={(e) => set("address", e.target.value)} /></Field>
            <Field label="City"><Input value={d.city} maxLength={120} onChange={(e) => set("city", e.target.value)} /></Field>
            <Field label="PIN" error={issues.find((i) => i.startsWith("PIN"))}><Input value={d.pin ?? ""} maxLength={6} onChange={(e) => set("pin", e.target.value.replace(/\D/g, ""))} className="num" /></Field>
            <Field label="State code" hint={gstin ? "Must match GSTIN" : "Decides CGST+SGST or IGST"} error={issues.find((i) => i.includes("state code"))}>
              <Input value={d.stateCode} maxLength={2} disabled={!!gstin && isValidGstin(gstin)} onChange={(e) => set("stateCode", e.target.value.replace(/\D/g, ""))} className="num" />
            </Field>
            <p className="col-span-2 text-xs text-muted-foreground">{partyStateName(d.stateCode)}</p>
          </div>
        </section>
        {isCustomer && (
          <section className="space-y-3 rounded-lg border bg-card p-5">
            <h2 className="eyebrow">Credit</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Credit limit (₹)" hint="0 means no limit" error={issues.find((i) => i.startsWith("Credit limit"))}><Input type="number" min={0} step="0.01" value={d.creditLimit} onChange={(e) => set("creditLimit", Number(e.target.value))} className="num" /></Field>
              <Field label="Credit days" error={issues.find((i) => i.startsWith("Credit days"))}><Input type="number" min={0} step="1" value={d.creditDays ?? 0} onChange={(e) => set("creditDays", Number(e.target.value))} className="num" /></Field>
            </div>
            <p className="text-xs text-muted-foreground">Outstanding is updated by invoices and receipts, not through this form.</p>
          </section>
        )}
        {d.kind === "supplier" && (
          <section className="space-y-3 rounded-lg border bg-card p-5">
            <h2 className="eyebrow">Supplier terms</h2>
            <Field label="Payment terms (days)" error={issues.find((i) => i.startsWith("Credit days"))}>
              <Input type="number" min={0} step="1" value={d.creditDays ?? 0} onChange={(e) => set("creditDays", Number(e.target.value))} className="num" />
            </Field>
            <p className="text-xs text-muted-foreground">Supplier payables are updated by posted purchases and payments, not here.</p>
          </section>
        )}
        <section className="space-y-3 rounded-lg border bg-card p-5">
          <h2 className="eyebrow">Status</h2>
          <label className="flex items-center justify-between text-sm">
            <span>Blocked<span className="block text-xs text-muted-foreground">Blocked parties can't be picked on new documents</span></span>
            <Switch checked={!!d.blocked} onCheckedChange={(v) => set("blocked", v)} />
          </label>
        </section>
        </fieldset>
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-6 py-3 backdrop-blur md:left-60">
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-muted-foreground">{issues.length && canEdit ? issues[0] : canEdit ? <><span className="kbd">Ctrl + S</span> to save</> : "Read-only"}</span>
            <Button type="button" variant="ghost" onClick={goBack}>{canEdit ? "Cancel" : "Back"}</Button>
            {canEdit && <Button type="submit" disabled={m.isPending || issues.length > 0 || (!dirty && !isNew)}>{m.isPending ? "Saving…" : "Save party"}</Button>}
          </div>
        </div>
      </form>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: boolean }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className={`num mt-1 text-lg font-semibold ${tone ? "text-ember" : ""}`}>{value}</div>
    </div>
  );
}
