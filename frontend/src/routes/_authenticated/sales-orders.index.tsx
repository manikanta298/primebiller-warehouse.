import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { z } from "zod";
import { api } from "@/api/client";
import { formatDate, formatINR } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import { filterSalesOrders, orderPage } from "@/lib/sales-order-rules";
import { Input } from "@/components/ui/input";

const STATUSES = [
  ["all", "All"],
  ["draft", "Draft"],
  ["confirmed", "Confirmed"],
  ["partially_delivered", "Part delivered"],
  ["delivered", "Delivered"],
  ["cancelled", "Cancelled"],
] as const;

export const Route = createFileRoute("/_authenticated/sales-orders/")({
  validateSearch: z.object({ status: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Sales orders — Girder" },
      { name: "description", content: "Draft, confirmed and delivered sales orders with stock holds." },
      { property: "og:title", content: "Sales orders — Girder" },
      { property: "og:description", content: "Draft, confirmed and delivered sales orders with stock holds." },
    ],
  }),
  component: SalesOrdersPage,
});

function SalesOrdersPage() {
  const { status = "all" } = Route.useSearch();
  const navigate = useNavigate();
  const session = useSession();
  const stateCode = session?.orgs.find((o) => o.id === session.orgId)?.stateCode;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["sales-orders", session?.orgId, status],
    queryFn: () => api.listSalesOrders(status), enabled: !!session?.orgId,
  });
  const filtered = useMemo(() => filterSalesOrders(data ?? [], status, search), [data, status, search]);
  const pagination = orderPage(filtered, page);
  useEffect(() => { setSearch(""); setPage(1); }, [session?.orgId]);
  useEffect(() => { setPage(1); }, [status]);

  return (
    <div>
      <PageHeader
        title="Sales orders"
        eyebrow="Sales"
        actions={can(session?.user.role, "salesOrders") ? (
          <Button variant="ember" asChild>
            <Link to="/sales-orders/$id" params={{ id: "new" }}>
              <Plus /> New order <span className="kbd ml-1 border-ember-foreground/30 bg-transparent text-ember-foreground">Ctrl N</span>
            </Link>
          </Button>
        ) : undefined}
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {STATUSES.map(([v, l]) => (
          <Link
            key={v}
            to="/sales-orders"
            search={v === "all" ? {} : { status: v }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              status === v ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary",
            )}
          >
            {l}
          </Link>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm flex-1 basis-56">
          <Search aria-hidden="true" className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search sales orders" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search order number, customer, date" className="pl-8" />
        </div>
        {data && <span className="text-xs text-muted-foreground">{filtered.length} of {data.length} orders</span>}
      </div>
      {isLoading && <LoadingRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && filtered.length === 0 && <EmptyState title={data.length ? "No matching sales orders" : "No sales orders here"} hint={data.length ? "Try another search or status." : "Create an order to start a sales workflow."} />}
      {data && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr className="eyebrow text-left">
                <th className="px-4 py-2.5 font-semibold">Number</th>
                <th className="font-semibold">Date</th>
                <th className="font-semibold">Customer</th>
                <th className="font-semibold">Supply</th>
                <th className="font-semibold">Status</th>
                <th className="px-4 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {pagination.rows.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => navigate({ to: "/sales-orders/$id", params: { id: o.id } })}
                  className="cursor-pointer border-t hover:bg-muted/40"
                >
                  <td className="num px-4 py-3 text-xs">{o.number ?? <span className="text-muted-foreground">Draft</span>}</td>
                  <td>{formatDate(o.date)}</td>
                  <td className="font-medium">{o.customerName}</td>
                  <td className="text-xs text-muted-foreground">{o.placeOfSupplyCode === stateCode ? "CGST + SGST" : "IGST"}</td>
                  <td><StatusBadge status={o.status} /></td>
                  <td className="num px-4 text-right">{formatINR(o.grandTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > 25 && (
        <div className="mt-4 flex items-center justify-end gap-3 text-sm">
          <Button variant="outline" size="sm" disabled={pagination.page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="num text-muted-foreground">{pagination.page} / {pagination.totalPages}</span>
          <Button variant="outline" size="sm" disabled={pagination.page === pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
