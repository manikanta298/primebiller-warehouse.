import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Brand, Category, HsnRate, MasterKind, MasterRows, Uom } from "@/api/types";
import { GST_RATES } from "@/lib/gst";
import { useSession } from "@/lib/session";
import { categoryTree, filterMasters, indiaMasterDate, masterProblems, normaliseMaster } from "@/lib/master-rules";
import { formatDate } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { ActiveDot, Field, NativeSelect } from "@/components/app/form-bits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/masters")({
  head: () => ({
    meta: [
      { title: "Units, categories & HSN — Girder" },
      { name: "description", content: "Units of measure, item categories, brands and date-effective HSN GST rates." },
      { property: "og:title", content: "Units, categories & HSN — Girder" },
      { property: "og:description", content: "Units of measure, item categories, brands and date-effective HSN GST rates." },
    ],
  }),
  component: MastersPage,
});

type Draft = Record<string, unknown> & { id?: string | undefined };

const EMPTY: { [K in MasterKind]: Omit<MasterRows[K], "id"> } = {
  uoms: { code: "", name: "", category: "count", decimals: 0, active: true },
  categories: { name: "", parentId: null, defaultHsn: "", defaultGst: 18, active: true },
  brands: { name: "", active: true },
  hsn: { code: "", description: "", gstRate: 18, cessPct: 0, effectiveFrom: indiaMasterDate(), active: true },
};

const LABEL: Record<MasterKind, string> = { uoms: "unit", categories: "category", brands: "brand", hsn: "HSN rate" };

function MastersPage() {
  const [tab, setTab] = useState<MasterKind>("uoms");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [editing, setEditing] = useState<{ kind: MasterKind; row: Draft } | null>(null);
  return (
    <div>
      <PageHeader
        title="Units, categories & HSN"
        eyebrow="Masters"
        actions={
          <Button onClick={() => setEditing({ kind: tab, row: { ...EMPTY[tab] } })}>
            <Plus /> New {LABEL[tab]}
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(v) => { setTab(v as MasterKind); setQuery(""); setStatus("all"); }}>
        <TabsList>
          <TabsTrigger value="uoms">Units</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="brands">Brands</TabsTrigger>
          <TabsTrigger value="hsn">HSN & GST rates</TabsTrigger>
        </TabsList>
        <div className="my-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search masters" placeholder={`Search ${tab === "hsn" ? "HSN codes" : LABEL[tab] + "s"}`} className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <NativeSelect aria-label="Filter master status" className="w-full sm:w-40" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
          </NativeSelect>
        </div>
        <TabsContent value="uoms"><UomTable query={query} status={status} onEdit={(row) => setEditing({ kind: "uoms", row })} /></TabsContent>
        <TabsContent value="categories"><CategoryTable query={query} status={status} onEdit={(row) => setEditing({ kind: "categories", row })} /></TabsContent>
        <TabsContent value="brands"><BrandTable query={query} status={status} onEdit={(row) => setEditing({ kind: "brands", row })} /></TabsContent>
        <TabsContent value="hsn"><HsnTable query={query} status={status} onEdit={(row) => setEditing({ kind: "hsn", row })} /></TabsContent>
      </Tabs>
      {editing && <EditDialog kind={editing.kind} initial={editing.row} onClose={() => setEditing(null)} />}
    </div>
  );
}

function useMaster<K extends MasterKind>(kind: K) {
  const session = useSession();
  return useQuery({ queryKey: ["masters", session?.orgId, kind], queryFn: () => api.listMaster(kind), enabled: !!session?.orgId });
}

function Shell<T>({ q, children, empty }: { q: { data?: T[] | undefined; isLoading: boolean; error: unknown; refetch: () => void }; children: (rows: T[]) => React.ReactNode; empty: string }) {
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data?.length) return <EmptyState title={empty} />;
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">{children(q.data)}</table>
    </div>
  );
}

type TableProps = { onEdit: (r: Draft) => void; query: string; status: "all" | "active" | "inactive" };
const th = "px-4 py-2.5 text-left font-semibold";
const td = "px-4 py-2.5";

function UomTable({ onEdit, query, status }: TableProps) {
  const q = useMaster("uoms");
  const filtered = q.data ? filterMasters("uoms", q.data, query, status) : undefined;
  return (
    <Shell q={{ ...q, data: filtered }} empty={q.data?.length ? "No matching units" : "No units yet"}>
      {(rows: Uom[]) => (
        <>
          <thead className="bg-muted/60"><tr className="eyebrow"><th className={th}>Code</th><th className={th}>Name</th><th className={th}>Kind</th><th className={th}>Decimals</th><th className={th}>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => onEdit({ ...r })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdit({ ...r }); } }} tabIndex={0} className="cursor-pointer border-t hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                <td className={`${td} num font-medium`}>{r.code}</td><td className={td}>{r.name}</td>
                <td className={`${td} capitalize text-muted-foreground`}>{r.category}</td><td className={`${td} num`}>{r.decimals}</td>
                <td className={td}><ActiveDot active={r.active} /></td>
              </tr>
            ))}
          </tbody>
        </>
      )}
    </Shell>
  );
}

function CategoryTable({ onEdit, query, status }: TableProps) {
  const q = useMaster("categories");
  const filtered = q.data ? filterMasters("categories", q.data, query, status) : undefined;
  return (
    <Shell q={{ ...q, data: filtered }} empty={q.data?.length ? "No matching categories" : "No categories yet"}>
      {(rows: Category[]) => {
        const ordered = categoryTree(rows).map(({ row, depth }) => ({ r: row, depth }));
        return (
          <>
            <thead className="bg-muted/60"><tr className="eyebrow"><th className={th}>Category</th><th className={th}>Default HSN</th><th className={th}>Default GST</th><th className={th}>Status</th></tr></thead>
            <tbody>
              {ordered.map(({ r, depth }) => (
                <tr key={r.id} onClick={() => onEdit({ ...r })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdit({ ...r }); } }} tabIndex={0} className="cursor-pointer border-t hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                  <td className={td} style={{ paddingLeft: 16 + depth * 24 }}>
                    {depth > 0 && <span className="mr-1.5 text-muted-foreground">└</span>}
                    <span className={depth ? "" : "font-medium"}>{r.name}</span>
                  </td>
                  <td className={`${td} num`}>{r.defaultHsn || "–"}</td><td className={`${td} num`}>{r.defaultGst}%</td>
                  <td className={td}><ActiveDot active={r.active} /></td>
                </tr>
              ))}
            </tbody>
          </>
        );
      }}
    </Shell>
  );
}

function BrandTable({ onEdit, query, status }: TableProps) {
  const q = useMaster("brands");
  const filtered = q.data ? filterMasters("brands", q.data, query, status) : undefined;
  return (
    <Shell q={{ ...q, data: filtered }} empty={q.data?.length ? "No matching brands" : "No brands yet"}>
      {(rows: Brand[]) => (
        <>
          <thead className="bg-muted/60"><tr className="eyebrow"><th className={th}>Brand</th><th className={th}>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => onEdit({ ...r })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdit({ ...r }); } }} tabIndex={0} className="cursor-pointer border-t hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                <td className={`${td} font-medium`}>{r.name}</td><td className={td}><ActiveDot active={r.active} /></td>
              </tr>
            ))}
          </tbody>
        </>
      )}
    </Shell>
  );
}

function HsnTable({ onEdit, query, status }: TableProps) {
  const q = useMaster("hsn");
  const filtered = q.data ? filterMasters("hsn", q.data, query, status) : undefined;
  return (
    <Shell q={{ ...q, data: filtered }} empty={q.data?.length ? "No matching HSN codes" : "No HSN codes yet"}>
      {(rows: HsnRate[]) => (
        <>
          <thead className="bg-muted/60"><tr className="eyebrow"><th className={th}>HSN</th><th className={th}>Description</th><th className={`${th} text-right`}>GST</th><th className={`${th} text-right`}>Cess</th><th className={th}>Effective from</th><th className={th}>Status</th></tr></thead>
          <tbody>
            {[...rows].sort((a, b) => a.code.localeCompare(b.code) || b.effectiveFrom.localeCompare(a.effectiveFrom)).map((r) => (
              <tr key={r.id} onClick={() => onEdit({ ...r })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdit({ ...r }); } }} tabIndex={0} className="cursor-pointer border-t hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                <td className={`${td} num font-medium`}>{r.code}</td><td className={td}>{r.description}</td>
                <td className={`${td} num text-right`}>{r.gstRate}%</td><td className={`${td} num text-right text-muted-foreground`}>{r.cessPct}%</td>
                <td className={`${td} num`}>{formatDate(r.effectiveFrom)}</td><td className={td}><ActiveDot active={r.active} /></td>
              </tr>
            ))}
          </tbody>
        </>
      )}
    </Shell>
  );
}

function EditDialog({ kind, initial, onClose }: { kind: MasterKind; initial: Draft; onClose: () => void }) {
  const qc = useQueryClient();
  const session = useSession();
  const [d, setD] = useState<Draft>(initial);
  const set = (k: string, v: unknown) => setD((x) => ({ ...x, [k]: v }));
  const { data: cats = [] } = useMaster("categories");
  const checked = useMemo(() => normaliseMaster(kind, d as never), [d, kind]);
  const issues = useMemo(() => masterProblems(kind, checked as Draft, cats, initial.id && d.id ? initial : undefined), [kind, checked, cats, initial, d.id]);
  const close = () => {
    if (JSON.stringify(checked) !== JSON.stringify(initial) && !window.confirm("Discard unsaved master changes?")) return;
    onClose();
  };
  const m = useMutation({
    mutationFn: () => api.saveMaster(kind, checked as never),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["masters", session?.orgId] });
      toast.success(`${LABEL[kind][0]!.toUpperCase()}${LABEL[kind].slice(1)} saved`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const str = (k: string) => String(d[k] ?? "");
  const isHsnRevision = kind === "hsn" && !!d.id;

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{d.id ? "Edit" : "New"} {LABEL[kind]}</DialogTitle></DialogHeader>
        <form
          id="master-form"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={(e) => { e.preventDefault(); if (issues.length) { toast.error(issues[0]); return; } m.mutate(); }}
        >
          {kind === "uoms" && (
            <>
              <Field label="Code"><Input autoFocus value={str("code")} onChange={(e) => set("code", e.target.value.toUpperCase())} className="num" /></Field>
              <Field label="Name"><Input value={str("name")} onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label="Kind">
                <NativeSelect value={str("category")} onChange={(e) => set("category", e.target.value)}>
                  {["count", "weight", "length", "area", "volume"].map((c) => <option key={c} value={c}>{c}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Decimal places"><Input type="number" min={0} max={4} value={str("decimals")} onChange={(e) => set("decimals", Number(e.target.value))} className="num" /></Field>
            </>
          )}
          {kind === "categories" && (
            <>
              <Field label="Name" className="sm:col-span-2"><Input autoFocus value={str("name")} onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label="Parent" className="sm:col-span-2">
                <NativeSelect value={str("parentId")} onChange={(e) => set("parentId", e.target.value || null)}>
                  <option value="">None (top level)</option>
                  {categoryTree(cats).map(({ row }) => row).filter((c) => c.id !== d.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Default HSN"><Input value={str("defaultHsn")} onChange={(e) => set("defaultHsn", e.target.value.replace(/\D/g, ""))} className="num" /></Field>
              <Field label="Default GST">
                <NativeSelect value={str("defaultGst")} onChange={(e) => set("defaultGst", Number(e.target.value))}>
                  {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                </NativeSelect>
              </Field>
            </>
          )}
          {kind === "brands" && (
            <Field label="Brand name" className="sm:col-span-2"><Input autoFocus value={str("name")} onChange={(e) => set("name", e.target.value)} /></Field>
          )}
          {kind === "hsn" && (
            <>
              <Field label="HSN code" hint="4, 6 or 8 digits"><Input autoFocus disabled={isHsnRevision} value={str("code")} onChange={(e) => set("code", e.target.value.replace(/\D/g, "").slice(0, 8))} className="num" /></Field>
              <Field label="Effective from" hint="Documents use the rate in force on their date"><Input type="date" disabled={isHsnRevision} value={str("effectiveFrom")} onChange={(e) => set("effectiveFrom", e.target.value)} /></Field>
              <Field label="Description" className="sm:col-span-2"><Input value={str("description")} onChange={(e) => set("description", e.target.value)} /></Field>
              <Field label="GST rate">
                <NativeSelect disabled={isHsnRevision} value={str("gstRate")} onChange={(e) => set("gstRate", Number(e.target.value))}>
                  {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                </NativeSelect>
              </Field>
              <Field label="Cess %"><Input type="number" disabled={isHsnRevision} min={0} max={100} step="0.01" value={str("cessPct")} onChange={(e) => set("cessPct", Number(e.target.value))} className="num" /></Field>
            </>
          )}
          {issues.length > 0 && (
            <div className="sm:col-span-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
              <p className="font-medium">Please correct the following:</p>
              <ul className="list-disc pl-5">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
            </div>
          )}
          <label className="sm:col-span-2 flex items-center gap-2 text-sm">
            <Switch checked={d["active"] !== false} onCheckedChange={(v) => set("active", v)} /> Active
          </label>
        </form>
        <DialogFooter className="gap-2 sm:justify-between">
          {isHsnRevision ? (
            <Button type="button" variant="outline" onClick={() => setD({ ...d, id: undefined, effectiveFrom: indiaMasterDate() })}>
              Add new rate from a date
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={close} disabled={m.isPending}>Cancel</Button>
            <Button type="submit" form="master-form" disabled={m.isPending || issues.length > 0}>{m.isPending ? "Saving…" : "Save"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
