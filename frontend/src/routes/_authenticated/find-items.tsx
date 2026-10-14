import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useSession } from "@/lib/session";
import { matchesSearch, searchRank, searchReady } from "@/lib/search-match";
import { SearchHighlight } from "@/components/app/SearchHighlight";
import { PageHeader, ErrorState, LoadingRows } from "@/components/app/states";
import { Input } from "@/components/ui/input";
import { formatINR, formatQty } from "@/lib/format";
import { itemStock } from "@/lib/item-list-rules";
export const Route = createFileRoute("/_authenticated/find-items")({ component: FindItems, head: () => ({ meta: [{ title: "Find Items — Girder" }] }) });
export function FindItems() {
  const session = useSession();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  useEffect(() => { setQuery(""); setLimit(50); }, [session?.orgId]);
  const data = useQuery({ queryKey: ["items", session?.orgId], queryFn: () => api.listItems(), enabled: !!session?.orgId });
  const matches = searchReady(query) ? (data.data ?? []).filter(i => matchesSearch(`${i.name} ${i.sku} ${i.hsn} ${i.brand} ${i.category}`, query)).sort((a,b) => searchRank(a.name,query) - searchRank(b.name,query) || a.name.localeCompare(b.name)) : [];
  return <div className="space-y-4"><PageHeader title="Find Items" eyebrow="Search"/><p className="text-sm text-muted-foreground">Type at least two letters of an item name, SKU, HSN, brand or category. Matching names are highlighted regardless of case.</p><Input autoFocus aria-label="Find items" placeholder="Search items…" value={query} onChange={e => { setQuery(e.target.value); setLimit(50); }} onKeyDown={e => { if (e.key === "Enter" && matches[0]) { e.preventDefault(); navigate({ to: "/items/$id", params: { id: matches[0].id } }); } }} />{data.isLoading ? <LoadingRows/> : data.error ? <ErrorState error={data.error} onRetry={data.refetch}/> : searchReady(query) && <><p role="status" className="text-sm text-muted-foreground">{matches.length} matching item(s)</p><div className="space-y-2">{matches.slice(0,limit).map((i,index) => { const stock = itemStock(i, session?.godownId ?? "all"); return <Link aria-label={`${i.name} ${i.sku}`} key={i.id} to="/items/$id" params={{ id: i.id }} className={`block rounded-lg border p-4 ${index === 0 ? "border-primary bg-accent" : "bg-card hover:bg-accent"}`}><div className="flex flex-wrap justify-between gap-2"><strong><SearchHighlight text={i.name} query={query}/></strong><span>{formatINR(i.salePrice)} / {i.baseUom}</span></div><p className="text-xs text-muted-foreground"><SearchHighlight text={`${i.sku} · HSN ${i.hsn} · ${i.brand} · ${i.category}`} query={query}/></p><p className={`text-sm ${stock.free <= 0 ? "text-destructive" : "text-muted-foreground"}`}>{stock.free <= 0 ? "Out of stock" : `Free stock: ${formatQty(stock.free)} ${i.baseUom}`}{!i.active ? " · Inactive" : ""}</p></Link>; })}</div>{matches.length > limit && <button className="min-h-11 rounded border px-4" onClick={() => setLimit(n => n + 50)}>Show more items</button>}</>}</div>;
}
