import { useState } from "react";
import { Input } from "@/components/ui/input";

/** Native selection keeps keyboard and mobile touch behavior; searching never clears a selection. */
export function SearchableSelect({ label, searchLabel, placeholder, value, options, onChange, disabled = false }: {
  label: string; searchLabel: string; placeholder: string; value: string; disabled?: boolean;
  options: { value: string; label: string; search?: string; disabled?: boolean }[];
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = options.filter(o => terms.every(t => (o.search ?? o.label).toLocaleLowerCase().includes(t)));
  const selected = options.find(o => o.value === value);
  const visible = selected && !matches.includes(selected) ? [selected, ...matches] : matches;
  return <div className="mt-1 space-y-1">
    <Input aria-label={searchLabel} placeholder={searchLabel} value={search} disabled={disabled} onChange={e => setSearch(e.target.value)} className="min-h-11" />
    <select aria-label={label} className="min-h-11 w-full max-w-full rounded border bg-background px-2 text-sm" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {visible.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
    </select>
    {!matches.length && <p role="status" className="text-xs text-muted-foreground">No matching results.</p>}
  </div>;
}
