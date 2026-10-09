/** Validation and presentation rules for the four Masters tabs.
 * This file is copied into the standalone Express service by sync-shared.
 */
import type { Category, MasterKind, MasterRows } from "@/api/types";

type AnyRow = Record<string, unknown>;
const HSN_CODE = /^(?:\d{4}|\d{6}|\d{8})$/;
const GST = [0, 5, 12, 18, 28];
const UNIT_KINDS = ["count", "weight", "length", "area", "volume"];

export function indiaMasterDate(at: Date = new Date()): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export function isoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normaliseMaster<K extends MasterKind>(kind: K, row: Omit<MasterRows[K], "id"> & { id?: string }): Omit<MasterRows[K], "id"> & { id?: string } {
  const d: AnyRow = { ...row };
  if ("name" in d) d.name = String(d.name ?? "").trim();
  if ("code" in d) d.code = String(d.code ?? "").trim().toUpperCase();
  if (kind === "categories") {
    d.parentId = d.parentId ? String(d.parentId) : null;
    d.defaultHsn = String(d.defaultHsn ?? "").trim();
  }
  if (kind === "hsn") {
    d.description = String(d.description ?? "").trim();
    d.effectiveFrom = String(d.effectiveFrom ?? "").slice(0, 10);
  }
  return d as Omit<MasterRows[K], "id"> & { id?: string };
}

/** Verifies data BEFORE any SQL write, with parent and revision checks using records from the current organisation. */
export function masterProblems(kind: MasterKind, raw: AnyRow, categories: readonly Category[] = [], previous?: AnyRow): string[] {
  const d = normaliseMaster(kind, raw as never) as AnyRow;
  const issues: string[] = [];
  const text = (key: string) => String(d[key] ?? "");
  const bounded = (key: string, label: string, min: number, max: number) => {
    const length = text(key).length;
    if (length < min || length > max) issues.push(`${label} must be ${min}–${max} characters.`);
  };
  if (typeof d.active !== "boolean") issues.push("Active must be true or false.");
  if (kind === "uoms") {
    bounded("code", "Unit code", 1, 12);
    if (!/^[A-Z0-9_-]+$/.test(text("code"))) issues.push("Unit code may contain only letters, numbers, - and _.");
    bounded("name", "Unit name", 1, 60);
    if (!UNIT_KINDS.includes(text("category"))) issues.push("Choose a valid unit kind.");
    if (!Number.isInteger(d.decimals) || (d.decimals as number) < 0 || (d.decimals as number) > 4) issues.push("Decimal places must be a whole number from 0 to 4.");
  }
  if (kind === "categories") {
    bounded("name", "Category name", 1, 80);
    const code = text("defaultHsn");
    if (code && !HSN_CODE.test(code)) issues.push("Default HSN must be 4, 6 or 8 digits.");
    if (!GST.includes(d.defaultGst as number)) issues.push("Choose a supported default GST rate.");
    const parentId = d.parentId;
    if (parentId !== null && parentId !== "") {
      if (typeof parentId !== "string") issues.push("Invalid parent category.");
      else {
        const byId = new Map(categories.map((c) => [c.id, c]));
        if (!byId.has(parentId)) issues.push("Parent category must belong to this organisation.");
        const seen = new Set<string>();
        let next: string | null = parentId;
        while (next && !seen.has(next)) {
          if (next === d.id) { issues.push("A category cannot contain itself as an ancestor."); break; }
          seen.add(next);
          next = byId.get(next)?.parentId ?? null;
        }
        if (next && seen.has(next)) issues.push("Category hierarchy cannot contain a cycle.");
      }
    }
  }
  if (kind === "brands") bounded("name", "Brand name", 1, 80);
  if (kind === "hsn") {
    if (!HSN_CODE.test(text("code"))) issues.push("HSN must contain 4, 6 or 8 digits.");
    bounded("description", "Description", 1, 200);
    if (!GST.includes(d.gstRate as number)) issues.push("Choose a supported GST rate.");
    if (typeof d.cessPct !== "number" || !Number.isFinite(d.cessPct) || d.cessPct < 0 || d.cessPct > 100 || Math.abs(Math.round(d.cessPct * 100) - d.cessPct * 100) > 1e-8) issues.push("Cess must be between 0 and 100, with at most two decimals.");
    if (!isoCalendarDate(text("effectiveFrom"))) issues.push("Enter a valid effective date.");
    if (previous && ["code", "gstRate", "cessPct", "effectiveFrom"].some((key) => String(d[key]) !== String(previous[key]))) {
      issues.push("Published HSN codes, dates and rates are immutable. Add a new dated rate instead.");
    }
  }
  return [...new Set(issues)];
}

/** Keep every category visible, including deeper levels and stale orphaned nodes. */
export function categoryTree(rows: readonly Category[]): { row: Category; depth: number }[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const siblings = (parentId: string | null) => rows.filter((r) => r.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
  const done = new Set<string>();
  const out: { row: Category; depth: number }[] = [];
  const visit = (row: Category, depth: number) => {
    if (done.has(row.id)) return;
    done.add(row.id);
    out.push({ row, depth });
    for (const child of siblings(row.id)) visit(child, depth + 1);
  };
  for (const r of rows.filter((r) => !r.parentId || !byId.has(r.parentId)).sort((a, b) => a.name.localeCompare(b.name))) visit(r, 0);
  for (const r of [...rows].sort((a, b) => a.name.localeCompare(b.name))) visit(r, 0);
  return out;
}

export function filterMasters<K extends MasterKind>(kind: K, rows: readonly MasterRows[K][], query: string, status: "all" | "active" | "inactive"): MasterRows[K][] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (status === "active" && !row.active) return false;
    if (status === "inactive" && row.active) return false;
    const search = kind === "uoms" ? ["code", "name", "category"] : kind === "categories" ? ["name", "defaultHsn"] : kind === "brands" ? ["name"] : ["code", "description"];
    const haystack = search.map((k) => String((row as unknown as AnyRow)[k] ?? "")).join(" ").toLocaleLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}
