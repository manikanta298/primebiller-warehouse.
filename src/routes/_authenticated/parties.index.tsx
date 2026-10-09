import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { api } from "@/api/client";
import type { PartyKind } from "@/api/types";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatINR } from "@/lib/format";
import { filterParties, partyCreditSummary, type PartyTypeFilter, type PartyStatusFilter } from "@/lib/party-rules";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { Chips, NativeSelect } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/parties/")({
  head: () => ({
    meta: [
      { title: "Parties — Girder" },
      { name: "description", content: "Customers, suppliers and transporters with GSTIN, credit limit and outstanding." },
      { property: "og:title", content: "Parties — Girder" },
      { property: "og:description", content: "Customers, suppliers and transporters with GSTIN, credit limit and outstanding." },
    ],
  }),
  component: PartiesPage,
});

const KIND_LABEL: Record<PartyKind, string> = { customer: "Customer", supplier: "Supplier", both: "Customer & supplier", transporter: "Transporter" };

function PartiesPage() {
  const navigate = useNavigate();
  const session = useSession();
  const orgId = session?.orgId ?? "";
  const mayEdit = can(session?.user.role, "editParties");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<PartyTypeFilter>("all");
  const [status, setStatus] = useState<PartyStatusFilter>("all");
  useEffect(() => { setQ(""); setKind("all"); setStatus("all"); }, [orgId]);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["parties", orgId],
    queryFn: () => api.listParties(),
    enabled: !!orgId,
  });
  const filtered = useMemo(() => filterParties(data ?? [], kind, q, status), [data, kind, q, status]);
  return (
    <div>
      <PageHeader
        title="Parties"
        eyebrow="Masters"
        actions={mayEdit && <Button onClick={() => navigate({ to: "/parties/$id", params: { id: "new" } })}><Plus /> New party</Button>}
      />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search parties" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, GSTIN, city, mobile" className="pl-8" />
        </div>
        <Chips
          value={kind}
          onChange={setKind}
          options={[{ value: "all", label: "All" }, { value: "customer", label: "Customers" }, { value: "supplier", label: "Suppliers" }, { value: "both", label: "Both" }, { value: "transporter", label: "Transporters" }]}
        />
        <NativeSelect aria-label="Party status" value={status} onChange={(e) => setStatus(e.target.value as PartyStatusFilter)} className="w-40">
          <option value="all">All statuses</option><option value="unblocked">Not blocked</option><option value="blocked">Blocked</option>
        </NativeSelect>
        {data && <span className="text-xs text-muted-foreground" aria-live="polite">{filtered.length} of {data.length} parties</span>}
      </div>
      {isLoading && <LoadingRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && data.length === 0 && <EmptyState title="No parties yet" hint="Add a customer, supplier or transporter to get started." />}
      {data && data.length > 0 && filtered.length === 0 && <EmptyState title="No parties match" hint="Try a shorter search or another filter." />}
      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr className="eyebrow text-left">
                <th className="px-4 py-2.5 font-semibold">Party</th>
                <th className="font-semibold">GSTIN</th>
                <th className="font-semibold">State</th>
                <th className="text-right font-semibold">Credit limit</th>
                <th className="text-right font-semibold">Outstanding</th>
                <th className="px-4 text-right font-semibold">Headroom</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const { headroom, nearLimit } = partyCreditSummary(p);
                return (
                  <tr key={p.id} className="border-t hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <Link to="/parties/$id" params={{ id: p.id }} className="font-medium hover:text-primary">{p.name}</Link>
                      <div className="text-xs text-muted-foreground">
                        {KIND_LABEL[p.kind]} · {p.city || "No city"}
                        {p.blocked && <span className="ml-1.5 rounded bg-destructive/10 px-1.5 text-destructive">Blocked</span>}
                      </div>
                    </td>
                    <td className="num text-xs">{p.gstin ?? <span className="text-muted-foreground">Unregistered</span>}</td>
                    <td className="text-muted-foreground">{p.stateName}</td>
                    <td className="num text-right">{p.creditLimit ? formatINR(p.creditLimit, 0) : "–"}</td>
                    <td className="num text-right">{p.outstanding ? formatINR(p.outstanding, 0) : "–"}</td>
                    <td className={cn("num px-4 text-right font-medium", nearLimit && "text-ember")}>{p.creditLimit ? formatINR(headroom, 0) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
