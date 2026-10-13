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
