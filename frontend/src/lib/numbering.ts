/** Document numbering: {PREFIX}/{FY}/{zero-padded counter}. Shared by the mock and mirrored by the server. */
export function docNumber(prefix: string, fy: string, seq: number, padding: number): string {
  return `${prefix}/${fy}/${String(seq).padStart(padding, "0")}`;
}

/** Indian financial year label for a date, e.g. 2026-10-08 → "26-27"; 2027-02-01 → "26-27". */
export function fyLabel(date: string): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

/** Validate the actual number, including growth beyond its configured padding. */
export function invoiceNumberProblems(number: string): string[] {
  return /^[A-Za-z0-9/-]{1,16}$/.test(number) ? [] : ["Tax invoice number must contain 1–16 letters, digits, hyphens or slashes"];
}

export const PADDING_MIN = 3;
export const PADDING_MAX = 6;

/** Once ANY number is issued, this series configuration becomes immutable. */
export function seriesProblems(
  input: { docType: string; prefix: string; padding: number; resetPerFy?: boolean },
  current: { lastNumber: number; prefix: string; padding: number; resetPerFy?: boolean; locked?: boolean },
): string[] {
  const p: string[] = [];
  if (!/^[A-Z0-9]{1,6}$/.test(input.prefix)) p.push("Prefix must be 1–6 capital letters or digits");
  if (!Number.isInteger(input.padding) || input.padding < PADDING_MIN || input.padding > PADDING_MAX) p.push(`Digits must be between ${PADDING_MIN} and ${PADDING_MAX}`);
  if (input.docType === "INV" && invoiceNumberProblems(docNumber(input.prefix, "26-27", 1, input.padding)).length)
    p.push("Invoice prefix and digits exceed the 16-character limit including financial year and separators");
  if ((current.locked || current.lastNumber > 0) &&
      (input.prefix !== current.prefix || input.padding !== current.padding ||
       (input.resetPerFy !== undefined && current.resetPerFy !== undefined && input.resetPerFy !== current.resetPerFy)))
    p.push("Series is locked after its first document has been issued");
  return p;
}
