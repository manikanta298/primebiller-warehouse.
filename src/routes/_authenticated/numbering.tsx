import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { NumberSeries } from "@/api/types";
import { docNumber, PADDING_MAX, PADDING_MIN, seriesProblems } from "@/lib/numbering";
import { useSession } from "@/lib/session";
import { PageHeader, ErrorState, LoadingRows } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/numbering")({
  head: () => ({
    meta: [
      { title: "Numbering series — Girder" },
      { name: "description", content: "Set the prefix and digits for sales orders, challans, invoices, receipts and stock documents." },
      { property: "og:title", content: "Numbering series — Girder" },
      { property: "og:description", content: "Set the prefix and digits for sales orders, challans, invoices, receipts and stock documents." },
    ],
  }),
  component: Numbering,
});

function Numbering() {
  const orgId = useSession()?.orgId;
  const q = useQuery({ queryKey: ["series", orgId], queryFn: api.listSeries, enabled: !!orgId });
  return (
    <div>
      <PageHeader title="Numbering series" eyebrow="Settings" />
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">Numbers look like PREFIX/FY/00042. The counter only moves when a document is confirmed or issued, so invoices never skip a number. Once a document has been issued, that document type’s prefix, digits and financial-year reset setting are locked to prevent duplicate numbers.</p>
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60"><tr className="eyebrow">{["Document", "Prefix", "Digits", "Restart each FY", "Last issued", "Next number", ""].map((h) => <th key={h} className="px-4 py-2.5 text-left font-semibold">{h}</th>)}</tr></thead>
            <tbody>{q.data!.map((s) => <Row key={`${orgId}:${s.docType}`} s={s} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ s }: { s: NumberSeries }) {
  const qc = useQueryClient();
  const [prefix, setPrefix] = useState(s.prefix);
  const [padding, setPadding] = useState(s.padding);
  const [reset, setReset] = useState(s.resetPerFy);
  const dirty = prefix !== s.prefix || padding !== s.padding || reset !== s.resetPerFy;
  const problems = seriesProblems({ docType: s.docType, prefix: prefix.trim().toUpperCase(), padding, resetPerFy: reset }, s);
  const m = useMutation({
    mutationFn: () => api.saveSeries({ docType: s.docType, prefix: prefix.trim().toUpperCase(), padding, resetPerFy: reset }),
    onSuccess: () => { toast.success(`${s.label} series saved`); qc.invalidateQueries({ queryKey: ["series"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <tr className="border-t">
      <td className="px-4 py-2 font-medium">{s.label} {s.locked && <Lock className="ml-1 inline size-3.5 text-muted-foreground" aria-label="Locked" />}</td>
      <td className="px-4 py-2"><Input className="num h-8 w-24 uppercase" value={prefix} disabled={s.locked} onChange={(e) => setPrefix(e.target.value)} /></td>
      <td className="px-4 py-2"><Input className="num h-8 w-16" type="number" min={PADDING_MIN} max={PADDING_MAX} value={padding} disabled={s.locked} onChange={(e) => setPadding(Number(e.target.value))} /></td>
      <td className="px-4 py-2"><Switch checked={reset} disabled={s.locked} onCheckedChange={setReset} /></td>
      <td className="num px-4 py-2">{s.lastNumber || "—"}</td>
      <td className="num px-4 py-2 text-primary">{docNumber(prefix.toUpperCase() || "?", s.fy, s.lastNumber + 1, padding || 1)}</td>
      <td className="px-4 py-2 text-right">{!s.locked && <Button size="sm" variant="outline" disabled={!dirty || m.isPending || problems.length > 0} title={problems.join("; ")} onClick={() => m.mutate()}>Save</Button>}</td>
    </tr>
  );
}
