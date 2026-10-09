import { GST_RATES, HSN_PATTERN, isValidGstin, stateFromGstin } from "@/lib/gst";

export type ImportEntity = "items" | "parties" | "warehouses";
export type Row = Record<string, string>;

export interface FieldDef { key: string; label: string; required?: boolean; aliases?: string[] }

export const FIELDS: Record<ImportEntity, FieldDef[]> = {
  items: [
    { key: "sku", label: "SKU", required: true, aliases: ["code", "item code"] },
    { key: "name", label: "Name", required: true, aliases: ["item", "item name", "description"] },
    { key: "category", label: "Category" },
    { key: "brand", label: "Brand" },
    { key: "hsn", label: "HSN", required: true, aliases: ["hsn code"] },
    { key: "gstRate", label: "GST %", required: true, aliases: ["gst", "gst rate", "tax"] },
    { key: "baseUom", label: "Base unit", required: true, aliases: ["uom", "unit"] },
    { key: "salePrice", label: "Sale price", aliases: ["rate", "price", "mrp"] },
    { key: "costPrice", label: "Cost price", aliases: ["cost", "purchase price"] },
  ],
  parties: [
    { key: "name", label: "Name", required: true, aliases: ["party", "party name"] },
    { key: "kind", label: "Type", required: true, aliases: ["party type"] },
    { key: "gstin", label: "GSTIN", aliases: ["gst no", "gst number"] },
    { key: "stateCode", label: "State code", aliases: ["state"] },
    { key: "city", label: "City" },
    { key: "phone", label: "Phone", aliases: ["mobile"] },
    { key: "creditLimit", label: "Credit limit" },
    { key: "creditDays", label: "Credit days" },
  ],
  warehouses: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true, aliases: ["godown", "warehouse"] },
    { key: "type", label: "Type" },
    { key: "address", label: "Address" },
    { key: "stateCode", label: "State code", required: true, aliases: ["state"] },
    { key: "manager", label: "Manager" },
  ],
};

export const TEMPLATE_SAMPLE: Record<ImportEntity, string[]> = {
  items: ["CEM-ACC-OPC53", "ACC OPC 53 50kg bag", "Cement", "ACC", "2523", "28", "BAG", "410", "365"],
  parties: ["Lakshmi Builders", "customer", "", "36", "Hyderabad", "9848012345", "500000", "30"],
  warehouses: ["MDP", "Medchal Yard", "yard", "Medchal, Hyderabad", "36", ""],
};

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Guess header → field mapping by label, key or alias. */
export function autoMap(entity: ImportEntity, headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const f of FIELDS[entity]) {
    const names = [f.key, f.label, ...(f.aliases ?? [])].map(norm);
    const idx = headers.findIndex((h) => names.includes(norm(h)));
    if (idx >= 0) map[f.key] = idx;
  }
  return map;
}

export interface Existing { skus?: string[]; gstins?: string[]; codes?: string[] }
export type RowErrors = Record<string, string>;

const num = (v: string) => v.trim() !== "" && Number.isFinite(Number(v.replace(/,/g, "")));
export const PARTY_KINDS = ["customer", "supplier", "both", "transporter"];
export const GODOWN_TYPES = ["godown", "yard", "shop_counter", "transit"];

/** Validate every row; duplicates are checked against existing records and earlier rows in the file. */
export function validateRows(entity: ImportEntity, rows: Row[], existing: Existing = {}): RowErrors[] {
  const seen = new Set<string>();
  return rows.map((r) => {
    const e: RowErrors = {};
    for (const f of FIELDS[entity]) if (f.required && !r[f.key]?.trim()) e[f.key] = `${f.label} is required`;
    const v = (k: string) => (r[k] ?? "").trim();
    const dup = (key: string, list: string[] | undefined, field: string, label: string) => {
      if (!key) return;
      if (list?.some((x) => x.toUpperCase() === key)) e[field] = `${label} ${key} already exists`;
      else if (seen.has(key)) e[field] = `${label} ${key} is repeated in this file`;
      seen.add(key);
    };
    if (entity === "items") {
      dup(v("sku").toUpperCase(), existing.skus, "sku", "SKU");
      if (v("hsn") && !HSN_PATTERN.test(v("hsn"))) e["hsn"] = "HSN must be 4, 6 or 8 digits";
      if (v("gstRate") && !(GST_RATES as readonly number[]).includes(Number(v("gstRate").replace("%", "")))) e["gstRate"] = `GST must be one of ${GST_RATES.join(", ")}`;
      for (const k of ["salePrice", "costPrice"]) if (v(k) && (!num(v(k)) || Number(v(k).replace(/,/g, "")) < 0)) e[k] = "Must be a positive number";
    }
    if (entity === "parties") {
      if (v("kind") && !PARTY_KINDS.includes(v("kind").toLowerCase())) e["kind"] = `Type must be ${PARTY_KINDS.join(" / ")}`;
      const g = v("gstin").toUpperCase();
      if (g) {
        if (!isValidGstin(g)) e["gstin"] = "GSTIN is not valid";
        else {
          dup(g, existing.gstins, "gstin", "GSTIN");
          if (v("stateCode") && v("stateCode").padStart(2, "0") !== stateFromGstin(g)) e["stateCode"] = `GSTIN is from state ${stateFromGstin(g)}`;
        }
      } else if (!/^\d{1,2}$/.test(v("stateCode"))) e["stateCode"] = "State code is required when there is no GSTIN";
      for (const k of ["creditLimit", "creditDays"]) if (v(k) && !num(v(k))) e[k] = "Must be a number";
      if (v("phone") && !/^[6-9]\d{9}$/.test(v("phone").replace(/\D/g, "").slice(-10))) e["phone"] = "Phone must be a 10-digit mobile";
    }
    if (entity === "warehouses") {
      dup(v("code").toUpperCase(), existing.codes, "code", "Code");
      if (v("type") && !GODOWN_TYPES.includes(v("type").toLowerCase())) e["type"] = `Type must be ${GODOWN_TYPES.join(" / ")}`;
      if (v("stateCode") && !/^\d{1,2}$/.test(v("stateCode"))) e["stateCode"] = "State code must be 2 digits";
    }
    return e;
  });
}
