import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { GodownType, PartyKind } from "@/api/types";
import { useSession } from "@/lib/session";
import { FIELDS, TEMPLATE_SAMPLE, autoMap, toCsv, validateRows, type ImportEntity, type Row } from "@/lib/import-rules";
import { PageHeader } from "@/components/app/states";
import { Chips, NativeSelect } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({
    meta: [
      { title: "Bulk import — Girder" },
      { name: "description", content: "Import items, parties and warehouses from a CSV file, fix errors inline and commit." },
      { property: "og:title", content: "Bulk import — Girder" },
      { property: "og:description", content: "Import items, parties and warehouses from a CSV file, fix errors inline and commit." },
    ],
  }),
  component: ImportPage,
});

type Step = "upload" | "map" | "review" | "done";
const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "Upload" }, { id: "map", label: "Map columns" }, { id: "review", label: "Validate & fix" }, { id: "done", label: "Commit" },
];
const ENTITY_LABEL: Record<ImportEntity, string> = { items: "Items", parties: "Parties", warehouses: "Warehouses" };
const DEST: Record<ImportEntity, string> = { items: "/items", parties: "/parties", warehouses: "/warehouses" };

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name;
  a.click();
}

function ImportPage() {
  const session = useSession();
  const orgId = session?.orgId ?? "";
  const qc = useQueryClient();
  const [entity, setEntity] = useState<ImportEntity>("items");
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [raw, setRaw] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [existing, setExisting] = useState<{ skus: string[]; gstins: string[]; codes: string[] }>({ skus: [], gstins: [], codes: [] });
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [progress, setProgress] = useState(0);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: { row: number; msg: string }[] } | null>(null);

  const fields = FIELDS[entity];
  const headers = raw[0] ?? [];
  const errors = useMemo(() => validateRows(entity, rows, existing), [entity, rows, existing]);
  const badCount = errors.filter((e) => Object.keys(e).length).length;
  const byKind = useMemo(() => {
    const m = new Map<string, number>();
    errors.forEach((e) => Object.entries(e).forEach(([k]) => m.set(k, (m.get(k) ?? 0) + 1)));
    return [...m.entries()];
  }, [errors]);

  const reset = () => { setStep("upload"); setRaw([]); setRows([]); setResult(null); setFileName(""); setProgress(0); };

  async function onFile(f: File | { url: string }) {
    let data: string[][];
    try { data = await api.parseImport(f); } catch (e) { toast.error(e instanceof Error ? e.message : "File could not be read"); return; }
    if (data.length < 2) { toast.error("The file needs a header row and at least one data row"); return; }
    setFileName(f instanceof File ? f.name : "Google Sheet");
    setRaw(data);
    setMap(autoMap(entity, data[0]!));
    setStep("map");
  }

  async function toReview() {
    const missing = fields.filter((f) => f.required && map[f.key] === undefined);
    if (missing.length) { toast.error(`Map required columns: ${missing.map((m) => m.label).join(", ")}`); return; }
    const [items, parties, godowns] = await Promise.all([
      entity === "items" ? api.listItems() : Promise.resolve([]),
      entity === "parties" ? api.listParties() : Promise.resolve([]),
      entity === "warehouses" ? api.listGodownsDetailed(orgId) : Promise.resolve([]),
    ]);
    setExisting({ skus: items.map((i) => i.sku), gstins: parties.flatMap((p) => (p.gstin ? [p.gstin] : [])), codes: godowns.map((g) => g.code) });
    setRows(raw.slice(1).map((r) => Object.fromEntries(fields.map((f) => [f.key, map[f.key] !== undefined ? (r[map[f.key]!] ?? "").trim() : ""]))));
    setStep("review");
  }

  const edit = (i: number, k: string, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const bulkFix = (k: string, fn: (v: string) => string) => setRows((rs) => rs.map((r) => ({ ...r, [k]: fn(r[k] ?? "") })));
  const dropBad = () => setRows((rs) => rs.filter((_, i) => !Object.keys(errors[i]!).length));

  async function commit() {
    setCommitting(true);
    const failed: { row: number; msg: string }[] = [];
    let ok = 0;
    const n = (v: string | undefined) => Number((v ?? "").replace(/,/g, "")) || 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      try {
        if (entity === "items") {
          await api.createItem({
            sku: r["sku"]!.toUpperCase(), name: r["name"]!, category: r["category"] || "Uncategorised", brand: r["brand"] || "",
            hsn: r["hsn"]!, gstRate: n(r["gstRate"]?.replace("%", "")), baseUom: r["baseUom"]!.toUpperCase(), conversions: [],
            salePrice: n(r["salePrice"]), costPrice: n(r["costPrice"]), allowNegative: false, trackBatches: false, active: true,
          });
        } else if (entity === "parties") {
          const gstin = r["gstin"]?.toUpperCase() || undefined;
          await api.saveParty({
            kind: r["kind"]!.toLowerCase() as PartyKind, name: r["name"]!, gstin,
            stateCode: gstin ? gstin.slice(0, 2) : r["stateCode"]!.padStart(2, "0"),
            city: r["city"] ?? "", phone: r["phone"] ?? "", creditLimit: n(r["creditLimit"]), creditDays: n(r["creditDays"]),
          });
        } else {
          await api.saveGodown(orgId, {
            code: r["code"]!.toUpperCase(), name: r["name"]!, type: ((r["type"] || "godown").toLowerCase() as GodownType),
            address: r["address"] ?? "", stateCode: r["stateCode"]!.padStart(2, "0"), manager: r["manager"] ?? "",
            allowNegative: false, defaultForSales: false, active: true,
          });
        }
        ok++;
      } catch (e) {
        failed.push({ row: i + 2, msg: e instanceof Error ? e.message : "Failed" });
      }
      setProgress(Math.round(((i + 1) / rows.length) * 100));
    }
    qc.invalidateQueries();
    setResult({ ok, failed });
    setCommitting(false);
    setStep("done");
    if (ok) toast.success(`${ok} ${ENTITY_LABEL[entity].toLowerCase()} imported`);
  }

  const visible = rows.map((r, i) => ({ r, i })).filter(({ i }) => !onlyErrors || Object.keys(errors[i]!).length);

  return (
    <div>
      <PageHeader title="Bulk import" eyebrow="Operations">
        <p className="mt-1 text-sm text-muted-foreground">Add many items, parties or warehouses at once from a CSV file (save Excel sheets as CSV).</p>
      </PageHeader>

      <ol className="mb-6 flex flex-wrap gap-2 text-sm">
        {STEPS.map((s, i) => {
          const cur = STEPS.findIndex((x) => x.id === step);
          return (
            <li key={s.id} className={cn("flex items-center gap-2 rounded-full border px-3 py-1", i === cur ? "border-primary bg-primary text-primary-foreground" : i < cur ? "bg-muted" : "bg-card text-muted-foreground")}>
              <span className="num">{i + 1}</span>{s.label}
            </li>
          );
        })}
      </ol>

      {step === "upload" && (
        <div className="space-y-5 rounded-lg border bg-card p-6" onPaste={(e) => { const t = e.clipboardData.getData("text"); if (/docs\.google\.com\/spreadsheets/.test(t)) { e.preventDefault(); onFile({ url: t.trim() }); } }}>
          <div>
            <div className="eyebrow mb-2">What are you importing?</div>
            <Chips value={entity} onChange={setEntity} options={(Object.keys(ENTITY_LABEL) as ImportEntity[]).map((v) => ({ value: v, label: ENTITY_LABEL[v] }))} />
          </div>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 text-center hover:bg-muted/40">
            <Upload className="mb-2 size-7 text-muted-foreground" />
            <span className="font-medium">Choose a CSV file</span>
            <span className="text-xs text-muted-foreground">First row must be column headings</span>
            <input type="file" accept=".csv,text/csv,.xlsx,.xls,.ods,.json,.txt,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="sr-only" aria-label="CSV file" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Columns: {fields.map((f) => f.label + (f.required ? "*" : "")).join(", ")}</span>
            <Button variant="outline" size="sm" onClick={() => download(`girder-${entity}-template.csv`, toCsv([fields.map((f) => f.label), TEMPLATE_SAMPLE[entity]]))}>
              <Download /> Download template
            </Button>
          </div>
        </div>
      )}

      {step === "map" && (
        <div className="rounded-lg border bg-card p-6">
          <p className="mb-4 text-sm text-muted-foreground"><span className="font-medium text-foreground">{fileName}</span> · <span className="num">{raw.length - 1}</span> rows. Match each Girder field to a column in your file.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <label key={f.key} className="grid grid-cols-[9rem_1fr] items-center gap-3 text-sm">
                <span>{f.label}{f.required && <span className="text-destructive">*</span>}</span>
                <NativeSelect value={map[f.key] ?? ""} onChange={(e) => setMap((m) => { const n = { ...m }; if (e.target.value === "") delete n[f.key]; else n[f.key] = Number(e.target.value); return n; })}>
                  <option value="">— skip —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </NativeSelect>
              </label>
            ))}
          </div>
          <div className="mt-6 flex justify-between">
            <Button variant="outline" onClick={reset}>Back</Button>
            <Button onClick={toReview}>Validate rows</Button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span><span className="num font-medium">{rows.length}</span> rows · <span className={cn("num font-medium", badCount ? "text-destructive" : "text-primary")}>{badCount}</span> with errors</span>
              <label className="flex items-center gap-2"><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> Show only rows with errors</label>
            </div>
            <div className="max-h-[60vh] overflow-auto rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr className="eyebrow"><th className="px-2 py-2 text-left">Row</th>{fields.map((f) => <th key={f.key} className="px-2 py-2 text-left">{f.label}</th>)}</tr>
                </thead>
                <tbody>
                  {visible.slice(0, 500).map(({ r, i }) => (
                    <tr key={i} className="border-t">
                      <td className="num px-2 py-1 text-muted-foreground">{i + 2}</td>
                      {fields.map((f) => {
                        const err = errors[i]![f.key];
                        return (
                          <td key={f.key} className="px-1 py-1">
                            <input
                              value={r[f.key] ?? ""}
                              title={err}
                              aria-invalid={!!err}
                              onChange={(e) => edit(i, f.key, e.target.value)}
                              className={cn("h-8 w-full min-w-24 rounded border bg-transparent px-2 outline-none focus:ring-1 focus:ring-ring", err ? "border-destructive bg-destructive/5" : "border-transparent hover:border-border")}
                            />
                            {err && <div className="px-1 text-[11px] leading-tight text-destructive">{err}</div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {visible.length > 500 && <p className="p-3 text-xs text-muted-foreground">Showing first 500 rows. Fix these or use "Show only rows with errors".</p>}
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("map")}>Back</Button>
              <Button disabled={!!badCount || !rows.length || committing} onClick={commit}>
                {committing ? `Importing… ${progress}%` : `Import ${rows.length} ${ENTITY_LABEL[entity].toLowerCase()}`}
              </Button>
            </div>
            {committing && <Progress value={progress} />}
          </div>

          <aside className="space-y-3 rounded-lg border bg-card p-4 text-sm">
            <div className="eyebrow">Errors by field</div>
            {byKind.length === 0 ? (
              <p className="flex items-center gap-2 text-primary"><CheckCircle2 className="size-4" /> All rows are valid</p>
            ) : (
              <ul className="space-y-1.5">
                {byKind.map(([k, c]) => (
                  <li key={k} className="flex justify-between"><span>{fields.find((f) => f.key === k)?.label ?? k}</span><span className="num text-destructive">{c}</span></li>
                ))}
              </ul>
            )}
            <div className="eyebrow pt-2">Bulk fixes</div>
            <div className="flex flex-col gap-1.5">
              <Button size="sm" variant="outline" onClick={() => fields.forEach((f) => bulkFix(f.key, (v) => v.trim().replace(/\s+/g, " ")))}>Trim extra spaces</Button>
              {entity === "items" && <Button size="sm" variant="outline" onClick={() => { bulkFix("sku", (v) => v.toUpperCase()); bulkFix("baseUom", (v) => v.toUpperCase()); }}>Uppercase SKU & unit</Button>}
              {entity === "items" && <Button size="sm" variant="outline" onClick={() => bulkFix("gstRate", (v) => v.replace(/[%\s]/g, ""))}>Strip % from GST</Button>}
              {entity === "parties" && <Button size="sm" variant="outline" onClick={() => { bulkFix("gstin", (v) => v.toUpperCase().replace(/\s/g, "")); bulkFix("kind", (v) => v.toLowerCase() || "customer"); }}>Clean GSTIN & type</Button>}
              {entity === "warehouses" && <Button size="sm" variant="outline" onClick={() => { bulkFix("code", (v) => v.toUpperCase()); bulkFix("type", (v) => v.toLowerCase() || "godown"); }}>Uppercase codes, default type</Button>}
              {badCount > 0 && <Button size="sm" variant="ghost" className="text-destructive" onClick={dropBad}>Remove {badCount} rows with errors</Button>}
            </div>
          </aside>
        </div>
      )}

      {step === "done" && result && (
        <div className="space-y-4 rounded-lg border bg-card p-6">
          <p className="flex items-center gap-2 text-lg font-medium"><CheckCircle2 className="size-5 text-primary" /> <span className="num">{result.ok}</span> {ENTITY_LABEL[entity].toLowerCase()} imported</p>
          {result.failed.length > 0 && (
            <div className="rounded-md border border-destructive/40 p-3 text-sm">
              <p className="mb-2 flex items-center gap-2 font-medium text-destructive"><AlertTriangle className="size-4" /> {result.failed.length} rows failed</p>
              <ul className="space-y-0.5">{result.failed.map((f) => <li key={f.row}>Row <span className="num">{f.row}</span>: {f.msg}</li>)}</ul>
            </div>
          )}
          <div className="flex gap-2">
            <Button asChild><Link to={DEST[entity]}>View {ENTITY_LABEL[entity].toLowerCase()}</Link></Button>
            <Button variant="outline" onClick={reset}>Import another file</Button>
          </div>
        </div>
      )}
    </div>
  );
}
