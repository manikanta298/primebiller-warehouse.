import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { InvoiceSheet } from "@/components/app/InvoiceSheet";
import { PrintDocument } from "@/components/app/PrintDocument";
import { invoiceAmountWords } from "@/lib/invoice-print";
import { PRINT_DEFAULTS } from "@/lib/print-rules";
import type { Invoice, OrgSettings } from "@/api/types";
const invoice = { id: "i1", number: "INV/26-27/00001", date: "2026-10-13", dueDate: "2026-11-12", customerId: "p1", customerName: "Saved Customer", billingAddress: "Saved address, Hyderabad", customerPhone: "9999999999", gstin: "", placeOfSupplyCode: "36", placeOfSupplyName: "Telangana", supply: "intra", challans: [], lines: [{ soLineId: "sol1", itemId: "item1", itemName: "Sample item", hsn: "1234", qty: 2, rate: 100, discountPct: 10, gstRate: 18, uom: "PCS", allocations: [] }], taxable: 180, cgst: 16.2, sgst: 16.2, igst: 0, grandTotal: 212, roundOff: -0.4, byRate: [], advances: [], paid: 0, balance: 212, status: "awaiting_payment", createdBy: "Owner" } as Invoice;
const settings = { legalName: "Test Business", tradeName: "", gstin: "NA", address: "Office address", phone: "", email: "", bankName: "Bank", bankAccount: "123456", ifsc: "BANK0000001", invoiceTerms: "Saved terms", jurisdiction: "Hyderabad" } as OrgSettings;
afterEach(cleanup);
describe("invoice reference layout", () => {
  it("prints saved amounts, discounted lines, bank details and amount in words", () => {
    render(<InvoiceSheet invoice={invoice} settings={settings} profile={PRINT_DEFAULTS.B} />);
    expect(screen.getByText("Saved address, Hyderabad", { exact: false })).toBeTruthy();
    expect(screen.getByText("Discount 10%")).toBeTruthy();
    expect(screen.getByText("Rupees Two Hundred Twelve Only")).toBeTruthy();
    expect(screen.getByText("Total Amount").parentElement?.textContent).toContain("212.00");
    expect(screen.getByText("CGST").parentElement?.textContent).toContain("16.20");
    expect(screen.getByText("Bank Name:").parentElement?.textContent).toContain("Bank");
    expect(screen.getByText("Delivery address not recorded on this invoice.")).toBeTruthy();
  });
  it("does not backfill old customer details from current records", () => {
    const { billingAddress: _address, customerPhone: _phone, ...oldInvoice } = invoice;
    render(<InvoiceSheet invoice={oldInvoice} settings={settings} profile={PRINT_DEFAULTS.B} />);
    expect(screen.getByText("Address:").parentElement?.textContent).toContain("Not recorded on this invoice");
    expect(screen.queryByText("Saved address, Hyderabad", { exact: false })).toBeNull();
  });
  it("honours profile toggles and marks cancelled invoices", () => {
    render(<InvoiceSheet invoice={{ ...invoice, status: "cancelled" }} settings={settings} profile={{ ...PRINT_DEFAULTS.B, showLogo: false, showBank: false, showHsnSummary: false, showSignature: false }} />);
    expect(screen.getByText(/CANCELLED — NOT VALID/)).toBeTruthy();
    expect(screen.queryByText("Authorised Signatory")).toBeNull();
    expect(screen.queryByText("Our Bank Details")).toBeNull();
    expect(screen.queryByText("HSN & GST Summary")).toBeNull();
  });
  it("puts print copies directly on the body and cleans them up", () => {
    const result = render(<PrintDocument kind="invoice" document={invoice} settings={settings} profile={{ ...PRINT_DEFAULTS.B, copies: 2 }} />);
    const layout = screen.getByLabelText("Invoice print layout");
    expect(layout.parentElement).toBe(document.body);
    expect(layout.querySelectorAll(".invoice-sheet")).toHaveLength(2);
    result.unmount(); expect(screen.queryByLabelText("Invoice print layout")).toBeNull();
  });
  it("supports Indian grouping, paise, zero and invalid amounts", () => {
    expect(invoiceAmountWords(38026)).toBe("Rupees Thirty Eight Thousand Twenty Six Only");
    expect(invoiceAmountWords(12345678.25)).toBe("Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Twenty Five Paise Only");
    expect(invoiceAmountWords(0)).toBe("Rupees Zero Only");
    expect(invoiceAmountWords(-1)).toBe("Amount unavailable");
  });
});
