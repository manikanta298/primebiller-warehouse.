import { searchReady, searchTokens } from "@/lib/search-match";
/** Plain React text, never HTML injection; matching is independent of case. */
export function SearchHighlight({ text, query }: { text: string; query: string }) {
  if (!searchReady(query)) return <>{text}</>;
  const tokens = searchTokens(query);
  const lower = text.toLocaleLowerCase();
  const ranges: [number, number][] = [];
  for (const token of tokens) {
    let start = lower.indexOf(token);
    while (start >= 0) { ranges.push([start, start + token.length]); start = lower.indexOf(token, start + token.length); }
  }
  ranges.sort((a,b) => a[0] - b[0]);
  const merged: [number,number][] = [];
  for (const range of ranges) { const last = merged.at(-1); if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]); else merged.push([...range]); }
  let cursor = 0;
  const pieces = merged.map(([start,end]) => { const before = text.slice(cursor,start); cursor = end; return <span key={start}>{before}<mark className="rounded-sm bg-amber-200 text-slate-950">{text.slice(start,end)}</mark></span>; });
  return <>{pieces}{text.slice(cursor)}</>;
}
