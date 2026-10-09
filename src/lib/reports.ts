/** Report builders shared by the mock (and mirrored by the server). Pure functions over issued invoices. */
import type { Gstr1, Invoice, ItemSalesRow, ReceivableRow, SalesRegisterRow } from "@/api/types";
import { lineTaxable } from "./gst.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Unregistered inter-state invoices above this value go to B2CL (threshold since 1 Aug 2024). */
export const B2CL_THRESHOLD = 100000;
export const b2clThresholdForPeriod = (period: string) => period >= "2024-08" ? B2CL_THRESHOLD : 250000;

/** Calendar-safe periods and date ranges, shared by REST and demo reports. */
export const validReportMonth = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2100;
export const validReportDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const validReportRange = (from: string, to: string) => validReportDate(from) && validReportDate(to) && from <= to;
export const inPeriod = (date: string, period: string) => validReportMonth(period) && date.slice(0, 7) === period;

export function salesRegister(invoices: Invoice[]): SalesRegisterRow[] {
  return invoices
    .slice()
    .sort((a, b) => a.number.localeCompare(b.number))
    .map((i) => ({ id: i.id, number: i.number, date: i.date, customer: i.customerName, gstin: i.gstin, taxable: i.taxable, cgst: i.cgst, sgst: i.sgst, igst: i.igst, total: i.grandTotal, status: i.status }));
}

/** Ageing buckets by days past due date as of `today`. */
export function receivables(invoices: Invoice[], today: string): ReceivableRow[] {
  const map = new Map<string, ReceivableRow>();
  const t = Date.parse(today);
  for (const i of invoices) {
    if (i.status === "cancelled" || i.balance <= 0) continue;
    const r = map.get(i.customerId) ?? { customerId: i.customerId, customer: i.customerName, invoices: 0, current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0 };
    const late = Math.floor((t - Date.parse(i.dueDate)) / 86400000);
    const k = late <= 0 ? "current" : late <= 30 ? "d30" : late <= 60 ? "d60" : late <= 90 ? "d90" : "over90";
    r[k] = r2(r[k] + i.balance);
    r.total = r2(r.total + i.balance);
    r.invoices += 1;
    map.set(i.customerId, r);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function itemSales(invoices: Invoice[], costOf: (itemId: string) => number): ItemSalesRow[] {
  const map = new Map<string, ItemSalesRow>();
  for (const i of invoices) {
    if (i.status === "cancelled") continue;
    for (const l of i.lines) {
      const r = map.get(l.itemId) ?? { itemId: l.itemId, item: l.itemName, hsn: l.hsn, uom: l.uom, qty: 0, taxable: 0, cost: 0, margin: 0 };
      r.qty += l.qty;
      r.taxable = r2(r.taxable + lineTaxable(l));
      r.cost = r2(r.cost + l.qty * costOf(l.itemId));
      r.margin = r2(r.taxable - r.cost);
      map.set(l.itemId, r);
    }
  }
  return [...map.values()].sort((a, b) => b.taxable - a.taxable);
}

function split(supply: "intra" | "inter", tax: number) {
  if (supply === "inter") return { igst: r2(tax), cgst: 0, sgst: 0 };
  const cgst = r2(tax / 2);
  return { igst: 0, cgst, sgst: r2(tax - cgst) };
}

export function buildGstr1(all: Invoice[], period: string, orgGstin: string): Gstr1 {
  const inMonth = all.filter((i) => inPeriod(i.date, period));
  const live = inMonth.filter((i) => i.status !== "cancelled");
  const out: Gstr1 = { period, gstin: orgGstin, b2b: [], b2cl: [], b2cs: [], hsn: [], docs: [], totals: { taxable: 0, igst: 0, cgst: 0, sgst: 0, invoices: live.length } };
  const b2cs = new Map<string, Gstr1["b2cs"][number]>();
  const hsn = new Map<string, Gstr1["hsn"][number]>();
  for (const i of live) {
    const pos = `${i.placeOfSupplyCode}-${i.placeOfSupplyName}`;
    for (const br of i.byRate) {
      const t = split(i.supply, br.tax);
      if (i.gstin?.trim()) out.b2b.push({ gstin: i.gstin, name: i.customerName, invoiceNo: i.number, date: i.date, value: i.grandTotal, pos, rate: br.rate, taxable: br.taxable, ...t });
      else if (i.supply === "inter" && i.grandTotal > b2clThresholdForPeriod(period)) out.b2cl.push({ invoiceNo: i.number, date: i.date, value: i.grandTotal, pos, rate: br.rate, taxable: br.taxable, igst: t.igst });
      else {
        const k = `${pos}|${br.rate}|${i.supply}`;
        const r = b2cs.get(k) ?? { pos, supply: i.supply, rate: br.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
        r.taxable = r2(r.taxable + br.taxable); r.igst = r2(r.igst + t.igst); r.cgst = r2(r.cgst + t.cgst); r.sgst = r2(r.sgst + t.sgst);
        b2cs.set(k, r);
      }
      out.totals.taxable = r2(out.totals.taxable + br.taxable);
      out.totals.igst = r2(out.totals.igst + t.igst);
      out.totals.cgst = r2(out.totals.cgst + t.cgst);
      out.totals.sgst = r2(out.totals.sgst + t.sgst);
    }
    for (const l of i.lines) {
      const recipient = i.gstin?.trim() ? "b2b" : "b2c";
      const k = `${recipient}|${l.hsn}|${l.uom}|${l.gstRate}`;
      const taxable = lineTaxable(l);
      const t = split(i.supply, (taxable * l.gstRate) / 100);
      const r = hsn.get(k) ?? { recipient, hsn: l.hsn, uom: l.uom, qty: 0, rate: l.gstRate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      r.qty += l.qty; r.taxable = r2(r.taxable + taxable); r.igst = r2(r.igst + t.igst); r.cgst = r2(r.cgst + t.cgst); r.sgst = r2(r.sgst + t.sgst);
      hsn.set(k, r);
    }
  }
  out.b2cs = [...b2cs.values()];
  out.hsn = [...hsn.values()].sort((a, b) => a.recipient.localeCompare(b.recipient) || a.hsn.localeCompare(b.hsn) || a.rate - b.rate);
  if (inMonth.length) {
    const nums = inMonth.map((i) => i.number).sort();
    out.docs.push({ nature: "Invoices for outward supply", from: nums[0]!, to: nums[nums.length - 1]!, total: inMonth.length, cancelled: inMonth.length - live.length });
  }
  return out;
}

/** Reconciliation draft only, NOT certified for GSTN offline-tool upload. */
export function gstr1Json(g: Gstr1) {
  const fp = `${g.period.slice(5, 7)}${g.period.slice(0, 4)}`;
  const byCtin = new Map<string, Gstr1["b2b"]>();
  g.b2b.forEach((r) => byCtin.set(r.gstin, [...(byCtin.get(r.gstin) ?? []), r]));
  return {
    _notice: "REVIEW ONLY: incomplete GSTR-1 draft; do not upload to the GST Portal",
    gstin: g.gstin,
    fp,
    b2b: [...byCtin.entries()].map(([ctin, rows]) => ({
      ctin,
      inv: [...new Set(rows.map((r) => r.invoiceNo))].map((inum) => {
        const rs = rows.filter((r) => r.invoiceNo === inum);
        return { inum, idt: rs[0]!.date.split("-").reverse().join("-"), val: rs[0]!.value, pos: rs[0]!.pos.slice(0, 2), rchrg: "N", inv_typ: "R",
          itms: rs.map((r, n) => ({ num: n + 1, itm_det: { rt: r.rate, txval: r.taxable, iamt: r.igst, camt: r.cgst, samt: r.sgst, csamt: 0 } })) };
      }),
    })),
    b2cl: [...new Set(g.b2cl.map((r) => r.pos.slice(0, 2)))].map((pos) => ({
      pos,
      inv: [...new Set(g.b2cl.filter((r) => r.pos.slice(0, 2) === pos).map((r) => r.invoiceNo))].map((inum) => {
        const rs = g.b2cl.filter((r) => r.pos.slice(0, 2) === pos && r.invoiceNo === inum);
        return { inum, idt: rs[0]!.date.split("-").reverse().join("-"), val: rs[0]!.value,
          itms: rs.map((r, n) => ({ num: n + 1, itm_det: { rt: r.rate, txval: r.taxable, iamt: r.igst, csamt: 0 } })) };
      }),
    })),
    b2cs: g.b2cs.map((r) => ({ sply_ty: r.supply === "intra" ? "INTRA" : "INTER", pos: r.pos.slice(0, 2), typ: "OE", rt: r.rate, txval: r.taxable, iamt: r.igst, camt: r.cgst, samt: r.sgst, csamt: 0 })),
    // From May 2025 GSTR-1 requires separate B2B/B2C HSN summaries.
    hsn: {
      b2b: g.hsn.filter((r) => r.recipient === "b2b").map((r, n) => ({ num: n + 1, hsn_sc: r.hsn, uqc: r.uom, qty: r.qty, rt: r.rate, txval: r.taxable, iamt: r.igst, camt: r.cgst, samt: r.sgst, csamt: 0 })),
      b2c: g.hsn.filter((r) => r.recipient === "b2c").map((r, n) => ({ num: n + 1, hsn_sc: r.hsn, uqc: r.uom, qty: r.qty, rt: r.rate, txval: r.taxable, iamt: r.igst, camt: r.cgst, samt: r.sgst, csamt: 0 })),
    },
    doc_issue: { doc_det: [{ doc_num: 1, docs: g.docs.map((d, n) => ({ num: n + 1, from: d.from, to: d.to, totnum: d.total, cancel: d.cancelled, net_issue: d.total - d.cancelled })) }] },
  };
}

/** One well-formed CSV with an explicit section column (never a multi-CSV concatenation). */
export function gstr1Csv(g: Gstr1): string {
  type Row = Record<string, string | number> & { section: string; invoice: string; date: string; gstin: string; pos: string; hsn: string; uom: string; qty: number | string; rate: number | string; taxable: number | string; igst: number | string; cgst: number | string; sgst: number | string; detail: string };
  const row = (v: Partial<Row>): Row => ({ section: "", invoice: "", date: "", gstin: "", pos: "", hsn: "", uom: "", qty: "", rate: "", taxable: "", igst: "", cgst: "", sgst: "", detail: "", ...v });
  const rows: Row[] = [
    ...g.b2b.map((r) => row({ section: "B2B", invoice: r.invoiceNo, date: r.date, gstin: r.gstin, pos: r.pos, rate: r.rate, taxable: r.taxable, igst: r.igst, cgst: r.cgst, sgst: r.sgst, detail: r.name })),
    ...g.b2cl.map((r) => row({ section: "B2CL", invoice: r.invoiceNo, date: r.date, pos: r.pos, rate: r.rate, taxable: r.taxable, igst: r.igst })),
    ...g.b2cs.map((r) => row({ section: "B2CS", pos: r.pos, rate: r.rate, taxable: r.taxable, igst: r.igst, cgst: r.cgst, sgst: r.sgst, detail: r.supply })),
    ...g.hsn.map((r) => row({ section: r.recipient === "b2b" ? "HSN B2B" : "HSN B2C", hsn: r.hsn, uom: r.uom, qty: r.qty, rate: r.rate, taxable: r.taxable, igst: r.igst, cgst: r.cgst, sgst: r.sgst })),
    ...g.docs.map((r) => row({ section: "DOCUMENTS", detail: `${r.nature}: ${r.from} to ${r.to}; issued ${r.total}; cancelled ${r.cancelled}` })),
  ];
  return toCsv(rows);
}

/** Escape CSV including values which spreadsheets might evaluate as formulas. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const value = v == null ? "" : String(v);
    // Excel/LibreOffice can evaluate formula-looking strings even within quotes.
    const s = /^[\s\u0000-\u001f]*[=+@-]/.test(value) && typeof v === "string" ? `'${value}` : value;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.map(esc).join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\r\n");
}
