import { format, parseISO } from "date-fns";

const inr = (decimals: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** ₹1,42,00,000.00 — Indian digit grouping. */
export function formatINR(n: number, decimals = 2): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}₹${inr(decimals).format(Math.abs(n))}`;
}

/** KPI abbreviation: ₹1.42 Cr, ₹3.5 L, else full rupees. */
export function formatCompactINR(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)} L`;
  return formatINR(n, 0);
}

function trim(v: number) {
  return v.toFixed(2).replace(/\.?0+$/, "");
}

export function formatQty(n: number, decimals = 0): string {
  return inr(decimals).format(n);
}

/** "22 Sep 2026" */
export function formatDate(d: string | Date): string {
  const date = typeof d === "string" ? parseISO(d) : d;
  return format(date, "d MMM yyyy");
}
