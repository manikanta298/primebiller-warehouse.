import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Item } from "@/api/types";
import { stockFor } from "@/lib/stock";
import { formatINR, formatQty } from "@/lib/format";
import { SearchHighlight } from "./SearchHighlight";
import { matchesSearch, searchRank, searchReady } from "@/lib/search-match";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/session";

/** Item autocomplete that shows on-hand and free stock for the chosen godown. */
export function ItemPicker({ value, godownId, onPick, onClear, disabled }: { value: string; godownId: string; onPick: (i: Item) => void; onClear?: () => void; disabled?: boolean }) {
  const session = useSession();
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const [hi, setHi] = useState(0);
  // Preserve what the user is typing when onClear clears the previous selection.
  useEffect(() => { if (value) setQ(value); }, [value]);
  useEffect(() => { setOpen(false); }, [session?.orgId]);
  const { data = [] } = useQuery({ queryKey: ["items", session?.orgId, "picker"], queryFn: () => api.listItems(), enabled: open && !!session?.orgId });
  const list = data.filter(item => item.active && matchesSearch(`${item.name} ${item.sku} ${item.hsn}`, q)).sort((a,b) => searchRank(a.name,q) - searchRank(b.name,q)).slice(0, 8);

  const pick = (i: Item) => {
    onPick(i);
    setQ(i.name);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-label="Search item"
        aria-autocomplete="list"
        aria-expanded={open && searchReady(q) && list.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && searchReady(q) && list[hi] ? `${listId}-${hi}` : undefined}
        value={q}
        disabled={disabled}
        placeholder="Type to search items…"
        onChange={(e) => {
          setQ(e.target.value);
          if (value && e.target.value !== value) onClear?.();
          setOpen(true);
          setHi(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); return; }
          if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); }
          if (!searchReady(q) || !open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === "Enter" && open && list[hi]) { e.preventDefault(); pick(list[hi]); }
        }}
        className="h-8 w-full rounded border-0 bg-transparent px-2 text-sm outline-none focus:bg-card focus:ring-1 focus:ring-ring disabled:opacity-100"
      />
      {open && searchReady(q) && !disabled && list.length > 0 && (
        <div id={listId} role="listbox" aria-label="Matching items" className="absolute left-0 top-9 z-40 w-full min-w-[18rem] max-w-[28rem] overflow-hidden rounded-md border bg-popover shadow-lg">
          <div className="eyebrow grid grid-cols-[1fr_5rem_5rem] gap-2 border-b px-3 py-1.5">
            <span>Item</span><span className="text-right">On hand</span><span className="text-right">Free</span>
          </div>
          {list.map((i, idx) => {
            const s = stockFor(i, godownId);
            return (
              <button
                type="button"
                key={i.id}
                role="option" aria-label={i.name} id={`${listId}-${idx}`} aria-selected={hi === idx}
                onPointerDown={event => event.preventDefault()} onClick={() => pick(i)}
                onMouseEnter={() => setHi(idx)}
                className={cn("grid w-full grid-cols-[1fr_5rem_5rem] gap-2 px-3 py-2 text-left text-sm", hi === idx && "bg-accent")}
              >
                <span className="truncate">
                  <SearchHighlight text={i.name} query={q}/>
                  <span className="num block text-xs text-muted-foreground">{i.hsn} · {i.gstRate}% · {formatINR(i.salePrice)}/{i.baseUom}</span>
                </span>
                <span className="num text-right">{formatQty(s.onHand)}</span>
                <span className={cn("num text-right font-medium", s.free <= 0 ? "text-destructive" : s.free < s.reorder && "text-ember")}>{formatQty(s.free)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
