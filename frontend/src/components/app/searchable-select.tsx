import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { matchesSearch, searchRank, searchReady } from "@/lib/search-match";
import { SearchSuggestions } from "./SearchSuggestions";
import { SearchHighlight } from "./SearchHighlight";

export function SearchableSelect({ inputId, describedBy, invalid, label, searchLabel, placeholder, value, options, onChange, disabled = false, required = false }: {
  inputId?: string | undefined; describedBy?: string | undefined; invalid?: React.AriaAttributes["aria-invalid"];
  label: string; searchLabel: string; placeholder: string; value: string; disabled?: boolean; required?: boolean;
  options: { value: string; label: string; search?: string; disabled?: boolean }[];
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const anchor = useRef<HTMLInputElement>(null);
  const matches = options.filter(o => matchesSearch(`${o.label} ${o.search ?? ""}`, search)).sort((a,b) => searchRank(a.label, search) - searchRank(b.label, search));
  const choices = matches.filter(o => !o.disabled).slice(0, 30);
  const selected = options.find(o => o.value === value);
  useEffect(() => { if (!open) setSearch(selected?.label ?? ""); }, [selected?.label, open]);
  useEffect(() => { anchor.current?.setCustomValidity(required && !value ? `Choose ${label.toLowerCase()} from suggestions` : ""); }, [required, value, label]);
  const expanded = open && searchReady(search) && !disabled;
  const highlighted = Math.min(active, Math.max(0, choices.length - 1));
  const pick = (next: string) => { setSearch(options.find(o => o.value === next)?.label ?? ""); onChange(next); setOpen(false); };
  return <div className="relative mt-1 space-y-1" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget) && !document.getElementById(id)?.contains(e.relatedTarget as Node)) setOpen(false); }}>
    <Input id={inputId} aria-describedby={describedBy} aria-invalid={invalid} required={required} ref={anchor} role="combobox" aria-label={searchLabel} aria-autocomplete="list" aria-expanded={expanded} aria-controls={id} aria-activedescendant={expanded && choices[highlighted] ? `${id}-${highlighted}` : undefined} placeholder={searchLabel} value={search} disabled={disabled} onFocus={e => { e.target.select(); setOpen(true); }} onChange={e => { setSearch(e.target.value); setActive(0); setOpen(true); }} onKeyDown={e => {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); }
      if (!expanded || !choices.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setActive(n => Math.max(0, Math.min(choices.length - 1, n + (e.key === "ArrowDown" ? 1 : -1)))); }
      if (e.key === "Enter") { e.preventDefault(); pick(choices[highlighted]!.value); }
    }} className="min-h-11" />
    {expanded && choices.length > 0 && <SearchSuggestions anchor={anchor} id={id} label={`${label} matches`}>{choices.map((o,index) => <button type="button" role="option" tabIndex={-1} aria-label={o.label} id={`${id}-${index}`} key={o.value} aria-selected={highlighted === index} onPointerDown={e => e.preventDefault()} onClick={() => pick(o.value)} onPointerMove={() => setActive(index)} className={`block min-h-11 w-full rounded px-3 py-2 text-left text-sm ${highlighted === index ? "bg-accent ring-1 ring-inset ring-primary/30" : "hover:bg-accent"}`}><SearchHighlight text={o.label} query={search} /></button>)}</SearchSuggestions>}
    {!!value && !disabled && <button type="button" aria-label={`Clear ${label}`} className="min-h-8 text-xs text-muted-foreground underline" onClick={() => pick("")}>Clear selection</button>}
    {expanded && !matches.length && <p role="status" className="text-xs text-muted-foreground">No matching results.</p>}
  </div>;
}
