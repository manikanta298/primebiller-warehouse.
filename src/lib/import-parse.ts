/**
 * Turns an uploaded bulk-import file into a grid of strings (first row = headings).
 * Detects the format from content, not from anything the user picks:
 * Excel (.xlsx/.xls/.ods), JSON (array of objects, array of arrays, or { rows | data | items: [...] }),
 * a Google Sheets link, or CSV. Shared by the browser mock and the server.
 */
import * as XLSX from "xlsx";

export type Grid = string[][];

const GSHEET = /https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:[^\s#]*?[#&?]gid=(\d+))?/;

/** Returns the CSV export URL if the text is (or contains) a Google Sheets link. */
export function googleSheetCsvUrl(text: string): string | null {
  const m = GSHEET.exec(text.trim());
  if (!m) return null;
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${m[2] ? `&gid=${m[2]}` : ""}`;
}

const cellStr = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).trim();
};

const clean = (g: Grid): Grid => g.filter((r) => r.some((c) => c.trim()));

function fromJson(data: unknown): Grid {
  let list: unknown = data;
  if (list && !Array.isArray(list) && typeof list === "object") {
    const o = list as Record<string, unknown>;
    list = o["rows"] ?? o["data"] ?? o["items"] ?? o["parties"] ?? o["warehouses"] ?? Object.values(o).find(Array.isArray);
  }
  if (!Array.isArray(list) || !list.length) throw new Error("The JSON file has no rows");
  if (list.every(Array.isArray)) return clean((list as unknown[][]).map((r) => r.map(cellStr)));
  const objs = list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  const headers: string[] = [];
  objs.forEach((o) => Object.keys(o).forEach((k) => headers.includes(k) || headers.push(k)));
  return clean([headers, ...objs.map((o) => headers.map((h) => cellStr(o[h])))]);
}

function fromWorkbook(bytes: Uint8Array): Grid {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  const first = wb.SheetNames.map((n) => wb.Sheets[n]!).find((s) => s["!ref"]);
  if (!first) throw new Error("The spreadsheet is empty");
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(first, { header: 1, defval: "", raw: false, dateNF: "yyyy-mm-dd" });
  return clean(aoa.map((r) => r.map(cellStr)));
}

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b; // xlsx / ods
const isOle = (b: Uint8Array) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0; // legacy xls

/** Parse file bytes. If the content is a Google Sheets link, returns { sheetUrl } so the caller can fetch it. */
export function parseImportBytes(bytes: Uint8Array): { grid: Grid } | { sheetUrl: string } {
  if (isZip(bytes) || isOle(bytes)) return { grid: fromWorkbook(bytes) };
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  const t = text.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    let data: unknown;
    try { data = JSON.parse(t); } catch { throw new Error("The JSON file could not be read"); }
    return { grid: fromJson(data) };
  }
  const url = t.length < 2000 ? googleSheetCsvUrl(t) : null;
  if (url) return { sheetUrl: url };
  // CSV / TSV / anything SheetJS understands as text.
  const wb = XLSX.read(text, { type: "string", raw: true });
  const s = wb.Sheets[wb.SheetNames[0]!];
  if (!s) return { grid: [] };
  return { grid: clean(XLSX.utils.sheet_to_json<unknown[]>(s, { header: 1, defval: "", raw: true }).map((r) => r.map(cellStr))) };
}

/** Download a Google Sheet (must be shared "Anyone with the link") and parse it. */
export async function fetchGoogleSheet(url: string): Promise<Grid> {
  const res = await fetch(url, { redirect: "follow" });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("text/html")) {
    throw new Error("Couldn't open the Google Sheet. Share it as \"Anyone with the link can view\" and try again.");
  }
  const r = parseImportBytes(new Uint8Array(await res.arrayBuffer()));
  if ("sheetUrl" in r) throw new Error("Couldn't read the Google Sheet");
  return r.grid;
}
