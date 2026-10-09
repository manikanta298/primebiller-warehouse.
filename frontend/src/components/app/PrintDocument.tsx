/** The print-only rendition of issued invoices and challans. All values come from
 * the saved document and the organisation's settings, never preview fixtures. */
import type { Challan, Invoice, OrgSettings, PrintProfile } from "@/api/types";
import { formatDate, formatINR, formatQty } from "@/lib/format";
import { printCopyLabels, taxBreakdown } from "@/lib/print-rules";

type Props = {
  profile: PrintProfile;
  settings: OrgSettings;
} & ({ kind: "invoice"; document: Invoice } | { kind: "challan"; document: Challan });

export function PrintDocument(props: Props) {
  const { profile, settings } = props;
  const doc = props.document;
  const isInvoice = props.kind === "invoice";
  const invoice = props.kind === "invoice" ? props.document : undefined;
  const challan = props.kind === "challan" ? props.document : undefined;
  const taxRows = taxBreakdown(doc.lines);
  const lines = doc.lines;
  const copies = printCopyLabels(profile.copies);
  return (
    <div className={`print-document ${profile.paper === "80mm" ? "print-thermal" : "print-a4"}`} aria-label={`${isInvoice ? "Invoice" : "Challan"} print layout`}>
      {copies.map((copy, n) => (
        <article className="print-sheet" key={n}>
          <header className="print-head">
            {profile.showLogo && <span className="print-brand-mark" aria-label="Business initials">{(settings.tradeName || settings.legalName).split(/\s+/).map((s) => s[0]).slice(0, 3).join("")}</span>}
            <div>
              <h1>{settings.legalName || settings.tradeName}</h1>
              {settings.tradeName && settings.tradeName !== settings.legalName && <p>{settings.tradeName}</p>}
              {settings.address && <p>{settings.address}</p>}
              {settings.gstin && <p>GSTIN: {settings.gstin}</p>}
              {(settings.phone || settings.email) && <p>{[settings.phone, settings.email].filter(Boolean).join(" · ")}</p>}
            </div>
          </header>
          <div className="print-doc-title"><strong>{isInvoice ? "TAX INVOICE" : "DELIVERY CHALLAN / GATE PASS"}</strong><span>{copy} · {profile.copies} {profile.copies === 1 ? "copy" : "copies"}</span></div>
          <dl className="print-details">
            <div><dt>Document</dt><dd>{doc.number}</dd></div>
            <div><dt>Date</dt><dd>{formatDate(doc.date)}</dd></div>
            <div><dt>Customer</dt><dd>{doc.customerName}</dd></div>
            {isInvoice && <><div><dt>Due</dt><dd>{formatDate(invoice!.dueDate)}</dd></div><div><dt>Recipient GSTIN</dt><dd>{invoice!.gstin || "Unregistered"}</dd></div></>}
            <div><dt>Place of supply</dt><dd>{doc.placeOfSupplyName} ({doc.placeOfSupplyCode})</dd></div>
            {!isInvoice && <><div><dt>Warehouse</dt><dd>{challan!.godownName}</dd></div><div><dt>Vehicle</dt><dd>{challan!.vehicleNo || "—"}</dd></div><div><dt>Driver</dt><dd>{challan!.driverName || "—"}</dd></div></>}
          </dl>
          <table className="print-lines">
            <thead><tr><th>Item / HSN</th><th>Qty</th><th>Rate</th><th>Taxable</th></tr></thead>
            <tbody>{lines.map((l, index) => (
              <tr key={index}>
                <td>{l.itemName}<small>HSN {l.hsn} · GST {l.gstRate}%{!isInvoice && (challan?.lines[index]?.allocations.length) ? ` · ${challan!.lines[index]!.allocations.map((a) => a.batchNo ?? "General").join(", ")}` : ""}</small></td>
                <td>{formatQty(l.qty)} {l.uom}</td><td>{formatINR(l.rate)}</td>
                <td>{formatINR(Math.round(l.qty * l.rate * (1 - l.discountPct / 100) * 100) / 100)}</td>
              </tr>
            ))}</tbody>
          </table>
          {profile.showHsnSummary && <section className="print-tax-summary"><strong>HSN tax summary</strong>
            <table><thead><tr><th>HSN</th><th>GST</th><th>Taxable</th><th>Tax</th></tr></thead><tbody>
              {taxRows.map((r) => <tr key={`${r.hsn}:${r.rate}`}><td>{r.hsn}</td><td>{r.rate}%</td><td>{formatINR(r.taxable)}</td><td>{formatINR(r.tax)}</td></tr>)}
            </tbody></table>
          </section>}
          <dl className="print-totals">
            <div><dt>Taxable</dt><dd>{formatINR(doc.taxable)}</dd></div>
            {isInvoice ? <>
              <div><dt>CGST</dt><dd>{formatINR(invoice!.cgst)}</dd></div><div><dt>SGST</dt><dd>{formatINR(invoice!.sgst)}</dd></div><div><dt>IGST</dt><dd>{formatINR(invoice!.igst)}</dd></div>
              <div><dt>Round off</dt><dd>{formatINR(invoice!.roundOff)}</dd></div><div className="print-total"><dt>Invoice total</dt><dd>{formatINR(invoice!.grandTotal)}</dd></div>
            </> : <><div><dt>GST</dt><dd>{formatINR(challan!.tax)}</dd></div><div className="print-total"><dt>Consignment value</dt><dd>{formatINR(challan!.value)}</dd></div></>}
          </dl>
          {isInvoice && profile.showBank && settings.bankName && settings.bankAccount && settings.ifsc && <section className="print-bank"><strong>Bank details</strong><p>{settings.bankName} · A/c {settings.bankAccount} · IFSC {settings.ifsc}</p></section>}
          {isInvoice && settings.invoiceTerms && <p className="print-terms">{settings.invoiceTerms}</p>}
          {!isInvoice && challan?.ewb?.number.startsWith("TEST") && <p className="print-test-warning">TEST E-WAY BILL ONLY — not a government-issued e-way bill</p>}
          {doc.status === "cancelled" && <div className="print-cancelled">CANCELLED — NOT VALID</div>}
          {profile.showSignature && <div className="print-signature">For {settings.legalName || settings.tradeName}<br />Authorised signatory</div>}
          {profile.footer && <footer className="print-footer">{profile.footer}</footer>}
        </article>
      ))}
    </div>
  );
}
