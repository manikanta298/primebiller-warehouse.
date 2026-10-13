import type { Invoice, OrgSettings, PrintProfile } from "@/api/types";
import { formatDate, formatINR, formatQty } from "@/lib/format";
import { lineTaxable } from "@/lib/gst";
import { invoiceAmountWords } from "@/lib/invoice-print";
import { taxBreakdown } from "@/lib/print-rules";
import "./invoice-sheet.css";

/** The same saved-document rendition is used for screen preview and A4 printing. */
export function InvoiceSheet({ invoice: i, settings: s, profile: p, copy = "Original" }: {
  invoice: Invoice; settings: OrgSettings; profile: PrintProfile; copy?: string;
}) {
  const business = s.legalName || s.tradeName || "Business";
  const taxRows = taxBreakdown(i.lines);
  const orders = [...new Set(i.challans.map(c => c.soNumber).filter(Boolean))].join(", ");
  return <article className="invoice-sheet" aria-label={`${copy} tax invoice`}>
    <div className="invoice-caption"><strong>Tax Invoice</strong><span>{copy}</span></div>
    <div className="invoice-border">
      <header className="invoice-business">
        {p.showLogo && <div className="invoice-mark" aria-label="Business initials">{business.split(/\s+/).map(w => w[0]).slice(0, 3).join("")}</div>}
        <div><p>GSTIN: {s.gstin === "NA" ? "Not registered" : s.gstin || "Not configured"}</p><h1>{business}</h1>{s.tradeName && s.tradeName !== business && <p>{s.tradeName}</p>}<p>{s.address || "Business address not configured"}</p>{(s.phone || s.email) && <p>{[s.phone, s.email].filter(Boolean).join(" · ")}</p>}</div>
      </header>
      {i.status === "cancelled" && <div className="invoice-void">CANCELLED — NOT VALID FOR PAYMENT OR TAX FILING</div>}
      <div className="invoice-parties">
        <div className="invoice-addresses"><section><h2>Bill To</h2><div className="invoice-block"><p><b>Name:</b> {i.customerName}</p><p><b>Address:</b> {i.billingAddress || "Not recorded on this invoice"}</p><p><b>State / place of supply:</b> {i.placeOfSupplyName} – {i.placeOfSupplyCode}</p><p><b>GSTIN:</b> {i.gstin && i.gstin !== "NA" ? i.gstin : "Unregistered"}</p>{i.customerPhone && <p><b>Contact:</b> {i.customerPhone}</p>}</div></section><section><h2>Ship To</h2><div className="invoice-block"><p>Delivery address not recorded on this invoice.</p><p>Linked challan(s): {i.challans.map(c => c.number).join(", ") || "—"}</p></div></section></div>
        <dl className="invoice-meta"><div><dt>Invoice No.</dt><dd>{i.number}</dd></div><div><dt>Invoice Date</dt><dd>{formatDate(i.date)}</dd></div><div><dt>Due Date</dt><dd>{formatDate(i.dueDate)}</dd></div><div><dt>Tax Type</dt><dd>{i.supply === "intra" ? "CGST + SGST" : "IGST"}</dd></div><div><dt>Sales Order No.</dt><dd>{orders || "—"}</dd></div><div><dt>Status</dt><dd className="invoice-status">{i.status.replaceAll("_", " ")}</dd></div></dl>
      </div>
      <table className="invoice-items"><colgroup><col style={{width:"4%"}}/><col style={{width:"29%"}}/><col style={{width:"8%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"11%"}}/><col style={{width:"7%"}}/><col style={{width:"10%"}}/><col style={{width:"11%"}}/></colgroup>
        <thead><tr><th rowSpan={2}>Sr</th><th rowSpan={2}>Goods &amp; Service Description</th><th rowSpan={2}>HSN</th><th rowSpan={2}>Quantity</th><th rowSpan={2}>Rate</th><th rowSpan={2}>Taxable</th><th colSpan={2}>GST</th><th rowSpan={2}>Total</th></tr><tr><th>%</th><th>Amount</th></tr></thead>
        <tbody>{i.lines.map((l, index) => { const taxable = lineTaxable(l), tax = taxBreakdown([l])[0]!.tax; return <tr key={index}><td>{index + 1}</td><td>{l.itemName}{!!l.discountPct && <small>Discount {l.discountPct}%</small>}</td><td>{l.hsn}</td><td>{formatQty(l.qty)} {l.uom}</td><td>{formatINR(l.rate)}</td><td>{formatINR(taxable)}</td><td>{l.gstRate}%</td><td>{formatINR(tax)}</td><td>{formatINR(Math.round((taxable + tax) * 100) / 100)}</td></tr>; })}</tbody>
        <tfoot><tr><th colSpan={5}>Sub-total</th><td>{formatINR(i.taxable)}</td><td colSpan={2}>{formatINR(i.cgst + i.sgst + i.igst)}</td><td>{formatINR(i.grandTotal - i.roundOff)}</td></tr></tfoot>
      </table>
      <div className="invoice-summary"><section className="invoice-payment">
        {p.showBank && <div className="invoice-block"><h3>Our Bank Details</h3>{s.bankName || s.bankAccount || s.ifsc ? <><p><b>Bank Name:</b> {s.bankName || "Not configured"}</p><p><b>Account No.:</b> {s.bankAccount || "Not configured"}</p><p><b>IFSC Code:</b> {s.ifsc || "Not configured"}</p></> : <p>Bank details not configured.</p>}</div>}
        <div className="invoice-words"><h3>Invoice Total in Words</h3><p>{invoiceAmountWords(i.grandTotal)}</p></div>
      </section><table className="invoice-amounts"><thead><tr><th>Summary</th><th>Amount</th></tr></thead><tbody>{[["Taxable value", i.taxable],["CGST", i.cgst],["SGST", i.sgst],["IGST", i.igst],["Round off", i.roundOff],["Total Amount", i.grandTotal],["Advances applied", i.advances.reduce((n,a) => n+a.amount,0)],["Payments received", i.paid],["Balance due", i.balance]].map(([label, value]) => <tr key={String(label)} className={label === "Total Amount" ? "invoice-grand-total" : ""}><th>{label}</th><td>{formatINR(Number(value))}</td></tr>)}</tbody></table></div>
      {p.showHsnSummary && <section className="invoice-hsn"><h2>HSN &amp; GST Summary</h2><table><thead><tr><th>HSN</th><th>GST Rate</th><th>Taxable Value</th><th>GST Amount</th></tr></thead><tbody>{taxRows.map(r => <tr key={`${r.hsn}:${r.rate}`}><td>{r.hsn}</td><td>{r.rate}%</td><td>{formatINR(r.taxable)}</td><td>{formatINR(r.tax)}</td></tr>)}</tbody></table></section>}
      <div className="invoice-bottom"><section><h3>Declaration / Terms</h3>{s.invoiceTerms && <p>{s.invoiceTerms}</p>}{s.jurisdiction && <p>Subject to {s.jurisdiction} jurisdiction.</p>}<p>E. &amp; O. E.</p></section>{p.showSignature && <section className="invoice-sign"><p>For, {business}</p><p>Authorised Signatory</p></section>}</div>
    </div>{p.footer && <footer>{p.footer}</footer>}
  </article>;
}
