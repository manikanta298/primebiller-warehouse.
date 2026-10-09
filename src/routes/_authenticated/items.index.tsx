import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, Search, Upload } from "lucide-react";
import { api } from "@/api/client";
import { useSession } from "@/lib/session";
import { can } from "@/lib/permissions";
import {
  filterItemList, itemListCsv, itemListSummary, itemStock, itemStockStatus, paginateItemList,
  type ItemActivityFilter, type ItemListSort, type ItemStockFilter,
} from "@/lib/item-list-rules";
import { download } from "@/lib/download";
import { formatCompactINR, formatINR, formatQty } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/app/states";
import { NativeSelect } from "@/components/app/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/items/")({
  head: () => ({
    meta: [
      { title: "Items — Girder" },
      { name: "description", content: "Item master with HSN, GST rate, units and stock per godown." },
      { property: "og:title", content: "Items — Girder" },
      { property: "og:description", content: "Item master with HSN, GST rate, units and stock per godown." },
    ],
  }),
  component: ItemsPage,
});

const PAGE_SIZE = 25;

function ItemsPage() {
  const session = useSession();
  const orgId = session?.orgId;
  const gid = session?.godownId ?? "all";
  const canImport = can(session?.user.role, "editItems");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [stock, setStock] = useState<ItemStockFilter>("all");
  const [activity, setActivity] = useState<ItemActivityFilter>("active");
  const [sort, setSort] = useState<ItemListSort>("name_asc");
  const [page, setPage] = useState(1);

  // Fetch the full organisation catalogue for correct unfiltered KPI totals;
  // selectors below operate on that authorised snapshot without extra API calls.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["items", orgId],
    queryFn: () => api.listItems(),
    enabled: !!orgId,
    refetchOnWindowFocus: true,
  });
  const items = useMemo(() => data ?? [], [data]);
  const totals = useMemo(() => itemListSummary(items, gid), [items, gid]);
  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [items]);
  const filtered = useMemo(() => filterItemList(items, { query: q, category, stock, activity, sort, godownId: gid }), [items, q, category, stock, activity, sort, gid]);
  const { page: actualPage, totalPages: pages, start, rows: shown } = paginateItemList(filtered, page, PAGE_SIZE);
  const isFiltered = q.trim() !== "" || category !== "all" || stock !== "all" || activity !== "active";
  const reset = () => { setQ(""); setCategory("all"); setStock("all"); setActivity("active"); setSort("name_asc"); setPage(1); };
  // Never carry a previous organisation's catalogue filters or page into another one.
  useEffect(() => {
    setQ(""); setCategory("all"); setStock("all"); setActivity("active"); setSort("name_asc"); setPage(1);
  }, [orgId]);

  const exportCsv = () => {
    if (!orgId || filtered.length === 0) return;
    // Include all filtered matches, not just the current pagination slice.
    download(`girder-items-${orgId}-${gid}.csv`, itemListCsv(filtered, gid), "text/csv;charset=utf-8");
  };

  return (
    <div>
      <PageHeader
        title="Items"
        eyebrow="Masters"
        actions={canImport ? (
          <Button variant="outline" size="sm" asChild>
            <Link to="/import"><Upload className="size-4" /> Import items</Link>
          </Button>
        ) : undefined}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Inventory summary">
        <Strip label="Active items" value={data ? String(totals.active) : "–"} />
        <Strip label="Stock value" value={data ? formatCompactINR(totals.value) : "–"} />
        <Strip label="Below reorder" value={data ? String(totals.low) : "–"} tone="ember" />
        <Strip label="Out of stock" value={data ? String(totals.out) : "–"} tone="danger" />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm flex-1 basis-60">
          <Search aria-hidden="true" className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search items" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name, SKU, HSN, brand" className="pl-8" />
        </div>
        <NativeSelect aria-label="Filter category" className="w-full sm:w-40" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Filter stock status" className="w-full sm:w-40" value={stock} onChange={(e) => { setStock(e.target.value as ItemStockFilter); setPage(1); }}>
          <option value="all">All stock</option>
          <option value="available">Stock healthy</option>
          <option value="low">Below reorder</option>
          <option value="out">Out of stock</option>
        </NativeSelect>
        <NativeSelect aria-label="Filter active status" className="w-full sm:w-32" value={activity} onChange={(e) => { setActivity(e.target.value as ItemActivityFilter); setPage(1); }}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All items</option>
        </NativeSelect>
        <NativeSelect aria-label="Sort items" className="w-full sm:w-44" value={sort} onChange={(e) => { setSort(e.target.value as ItemListSort); setPage(1); }}>
          <option value="name_asc">Name: A to Z</option>
          <option value="name_desc">Name: Z to A</option>
          <option value="stock_desc">Most on hand</option>
          <option value="free_asc">Least free stock</option>
          <option value="value_desc">Highest stock value</option>
          <option value="price_desc">Highest sale price</option>
        </NativeSelect>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data || filtered.length === 0} title="Export filtered items as CSV">
          <Download className="size-4" /> Export CSV
        </Button>
        {isFiltered && <Button variant="ghost" size="sm" onClick={reset}>Clear filters</Button>}
      </div>

      {isLoading && <LoadingRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && filtered.length === 0 && (
        <EmptyState
          title={items.length === 0 ? "No items yet" : "No items match"}
          hint={items.length === 0 ? "Import your first items to start tracking stock." : "Try changing your search or filters."}
          action={items.length > 0 && isFiltered ? <Button variant="outline" size="sm" onClick={reset}>Clear filters</Button> : canImport ? <Button variant="outline" size="sm" asChild><Link to="/import">Import items</Link></Button> : undefined}
        />
      )}
      {data && filtered.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[750px] text-sm">
              <thead className="bg-muted/60">
                <tr className="eyebrow text-left">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Item</th>
                  <th scope="col" className="font-semibold">HSN</th>
                  <th scope="col" className="font-semibold">GST</th>
                  <th scope="col" className="text-right font-semibold">On hand</th>
                  <th scope="col" className="text-right font-semibold">Held</th>
                  <th scope="col" className="text-right font-semibold">Free</th>
                  <th scope="col" className="px-4 text-right font-semibold">Sale price</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => {
                  const s = itemStock(i, gid);
                  const status = itemStockStatus(i, gid);
                  return (
                    <tr key={i.id} className="border-t hover:bg-muted/40">
                      <td className="px-4 py-2.5">
                        <Link to="/items/$id" params={{ id: i.id }} className="font-medium hover:text-primary">
                          {i.name}
                        </Link>
                        {!i.active && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Inactive</span>}
                        <div className="num text-xs text-muted-foreground">{i.sku}</div>
                      </td>
                      <td className="num">{i.hsn}</td>
                      <td className="num">{i.gstRate}%</td>
                      <td className={cn("num text-right", status === "out" ? "text-destructive" : status === "low" && "text-ember")}>
                        {formatQty(s.onHand)} <span className="text-xs text-muted-foreground">{i.baseUom}</span>
                      </td>
                      <td className="num text-right text-muted-foreground">{formatQty(s.held)}</td>
                      <td className={cn("num text-right font-medium", s.free <= 0 && "text-destructive")}>{formatQty(s.free)}</td>
                      <td className="num px-4 text-right">{formatINR(i.salePrice)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground" aria-live="polite">
            <div>Showing {start + 1}–{start + shown.length} of {filtered.length} items{isFiltered ? ` (${items.length} total)` : ""}</div>
            {pages > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={actualPage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                <span className="num">Page {actualPage} of {pages}</span>
                <Button variant="outline" size="sm" disabled={actualPage === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>Next</Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Strip({ label, value, tone }: { label: string; value: string; tone?: "ember" | "danger" }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className={cn("num mt-1 text-xl font-semibold", tone === "ember" && "text-ember", tone === "danger" && "text-destructive")}>{value}</div>
    </div>
  );
}
