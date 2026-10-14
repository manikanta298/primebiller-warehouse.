import { useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { matchesSearch, searchRank, searchReady } from "@/lib/search-match";
import { SearchSuggestions } from "./SearchSuggestions";
import { SearchHighlight } from "./SearchHighlight";

export function SearchableSelect({ label, searchLabel, placeholder, value, options, onChange, disabled = false, required = false }: {
  label: string; searchLabel: string; placeholder: string; value: string; disabled?: boolean; required?: boolean;
  options: { value: string; label: string; search?: string; disabled?: boolean }[];
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const anchor = useRef<HTMLInputElement>(null);
  const matches = options.filter(o => matchesSearch(o.search ?? o.label, search)).sort((a,b) => searchRank(a.label, search) - searchRank(b.label, search));
  const choices = matches.filter(o => !o.disabled).slice(0, 30);
  const selected = options.find(o => o.value === value);
  const visible = selected && !matches.includes(selected) ? [selected, ...matches] : matches;
  const expanded = open && searchReady(search) && !disabled;
  const highlighted = Math.min(active, Math.max(0, choices.length - 1));
  const pick = (next: string) => { onChange(next); setOpen(false); };
  return <div className="relative mt-1 space-y-1" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget) && !document.getElementById(id)?.contains(e.relatedTarget as Node)) setOpen(false); }}>
    <Input ref={anchor} role="combobox" aria-label={searchLabel} aria-autocomplete="list" aria-expanded={expanded} aria-controls={id} aria-activedescendant={expanded && choices[highlighted] ? `${id}-${highlighted}` : undefined} placeholder={searchLabel} value={search} disabled={disabled} onFocus={() => setOpen(true)} onChange={e => { setSearch(e.target.value); setActive(0); setOpen(true); }} onKeyDown={e => {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); }
      if (!expanded || !choices.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setActive(n => Math.max(0, Math.min(choices.length - 1, n + (e.key === "ArrowDown" ? 1 : -1)))); }
      if (e.key === "Enter") { e.preventDefault(); pick(choices[highlighted]!.value); }
    }} className="min-h-11" />
    {expanded && choices.length > 0 && <SearchSuggestions anchor={anchor} id={id} label={`${label} matches`}>{choices.map((o,index) => <button type="button" role="option" tabIndex={-1} aria-label={o.label} id={`${id}-${index}`} key={o.value} aria-selected={highlighted === index} onPointerDown={e => e.preventDefault()} onClick={() => pick(o.value)} onPointerMove={() => setActive(index)} className={`block min-h-11 w-full rounded px-3 py-2 text-left text-sm ${highlighted === index ? "bg-accent ring-1 ring-inset ring-primary/30" : "hover:bg-accent"}`}><SearchHighlight text={o.label} query={search} /></button>)}</SearchSuggestions>}
    <select required={required} aria-label={label} className="min-h-11 w-full max-w-full rounded border bg-background px-2 text-sm" value={value} disabled={disabled} onChange={e => pick(e.target.value)}>
      <option value="">{placeholder}</option>{visible.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
    </select>
    {searchReady(search) && !matches.length && <p role="status" className="text-xs text-muted-foreground">No matching results.</p>}
  </div>;
}
