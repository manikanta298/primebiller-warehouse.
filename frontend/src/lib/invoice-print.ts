/** Indian number grouping for the saved invoice total; presentation only. */
export function invoiceAmountWords(amount: number): string {
  const paise = Math.round(amount * 100);
  if (!Number.isSafeInteger(paise) || paise < 0) return "Amount unavailable";
  const small = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function words(n: number): string {
    if (n < 20) return small[n]!;
    if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${small[n % 10]}` : ""}`;
    const unit = n >= 10000000 ? [10000000, "Crore"] as const : n >= 100000 ? [100000, "Lakh"] as const : n >= 1000 ? [1000, "Thousand"] as const : [100, "Hundred"] as const;
    return `${words(Math.floor(n / unit[0]))} ${unit[1]}${n % unit[0] ? ` ${words(n % unit[0])}` : ""}`;
  }
  return `Rupees ${words(Math.floor(paise / 100))}${paise % 100 ? ` and ${words(paise % 100)} Paise` : ""} Only`;
}

/** A4 height less 12mm margins on both sides and a 2mm pagination buffer. */
export function singlePageInvoiceScale(height: number): number {
  if (!Number.isFinite(height) || height <= 0) return 1;
  return Math.min(1, Math.max(0.0001, Math.floor(((271 * 96 / 25.4) / height) * 10000) / 10000));
}

/** Zoom can alter table wrapping; measure again instead of assuming a linear height. */
export function fitInvoiceSheet(sheet: { style: { zoom: string }; getBoundingClientRect: () => { height: number } }): void {
  sheet.style.zoom = "1";
  let scale = 1;
  const available = 271 * 96 / 25.4;
  for (let attempt = 0; attempt < 12; attempt++) {
    const height = sheet.getBoundingClientRect().height;
    if (!Number.isFinite(height) || height <= 0 || height <= available) break;
    scale = Math.max(0.0001, Math.floor(scale * singlePageInvoiceScale(height) * 0.98 * 1e6) / 1e6);
    sheet.style.zoom = String(scale);
  }
}
