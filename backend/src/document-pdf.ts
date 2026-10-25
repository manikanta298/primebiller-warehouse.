import PDFDocument from "pdfkit";
import { computeTotals } from "./shared/gst.js";
import { fileURLToPath } from "node:url";
/** Render only the immutable server snapshot; no URLs, HTML or filesystem input. */
export async function documentPdf(snapshot: any, type: string, version: number): Promise<Buffer> {
  const pdf = new PDFDocument({ size: "A4", margin: 45 });
  pdf.font(fileURLToPath(new URL("../assets/DejaVuSans.ttf", import.meta.url)));
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => { pdf.on("data", b => chunks.push(b)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject); });
  const d = snapshot.document;
  const clean = (x: unknown) => String(x ?? "").replace(/₹/g, "INR ");
  const text = (s: unknown, size = 10) => { pdf.fontSize(size).text(clean(s)); pdf.moveDown(0.35); };
  text(snapshot.business?.name, 18); text(snapshot.business?.address); text(snapshot.business?.phone); text(`GSTIN: ${snapshot.business?.gstin || "Unregistered"}`);
  text(`${type === "invoice" ? "TAX INVOICE" : "QUOTATION"} ${d.number} | Version ${version}`, 15);
  text(`Date: ${d.date} | Customer ID: ${d.customerId}`); text(d.customerName);
  text(snapshot.customer?.address); text(snapshot.customer?.city); text(`GSTIN: ${snapshot.customer?.gstin || "Unregistered"}`);
  text(`Place of supply: ${d.placeOfSupplyName} (${d.placeOfSupplyCode})`);
  for (const l of d.lines) {
    if (pdf.y > 690) pdf.addPage();
    text(`${l.itemName} | HSN ${l.hsn}`, 11);
    text(`${l.qty} ${l.uom} x INR ${l.rate} | Discount ${l.discountPct}% | GST ${l.gstRate}%`);
  }
  if (type === "invoice") {
    text(`Taxable INR ${d.taxable} | CGST INR ${d.cgst} | SGST INR ${d.sgst} | IGST INR ${d.igst}`);
    text(`Round off INR ${d.roundOff} | Due: ${d.dueDate}`); text(snapshot.business?.invoiceTerms);
  } else { const totals = computeTotals(d.lines, d.supply); text(`Taxable INR ${totals.taxable} | CGST INR ${totals.cgst} | SGST INR ${totals.sgst} | IGST INR ${totals.igst}`); text(`Round off INR ${totals.roundOff}`); text(`Valid until: ${d.validUntil}`); text(d.terms); text(d.notes); text("This quotation is not a tax invoice."); }
  text(`Grand total: INR ${d.grandTotal}`, 14);
  pdf.end(); return result;
}
