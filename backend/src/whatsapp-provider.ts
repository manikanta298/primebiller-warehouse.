import { documentPdf } from "./document-pdf.js";
export class DeliveryFailure extends Error {
  constructor(public code: string, public uncertain = false) { super(code); }
}
export function providerReady(orgId: string) {
  return process.env.WHATSAPP_ENABLED === "true" && process.env.WHATSAPP_ORG_ID === orgId &&
    !!process.env.WHATSAPP_ACCESS_TOKEN && /^\d+$/.test(process.env.WHATSAPP_PHONE_NUMBER_ID ?? "") &&
    /^v\d+\.\d+$/.test(process.env.WHATSAPP_GRAPH_VERSION ?? "") && !!process.env.WHATSAPP_APP_SECRET &&
    !!process.env.WHATSAPP_VERIFY_TOKEN && !!process.env.WHATSAPP_QUOTATION_TEMPLATE && !!process.env.WHATSAPP_INVOICE_TEMPLATE;
}
export async function sendDocument(row: any, snapshot: any, phone: string) {
  const base = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}`;
  const auth = { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` };
  const pdf = await documentPdf(snapshot, row.document_type, row.version);
  const form = new FormData(); form.set("messaging_product", "whatsapp"); form.set("type", "application/pdf");
  form.set("file", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), "document.pdf");
  let media;
  try { const r = await fetch(`${base}/media`, { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(20000) }); media = await r.json() as any; if (!r.ok || !media.id) throw new Error(); }
  catch { throw new DeliveryFailure("media_upload_failed"); }
  const d = snapshot.document;
  const name = row.document_type === "invoice" ? process.env.WHATSAPP_INVOICE_TEMPLATE : process.env.WHATSAPP_QUOTATION_TEMPLATE;
  const parameters = [d.customerName, d.number, String(row.version), String(d.grandTotal), d.customerId].map(text => ({ type: "text", text }));
  let response;
  try { response = await fetch(`${base}/messages`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000), body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "template", template: { name, language: { code: process.env.WHATSAPP_LANGUAGE ?? "en" }, components: [{ type: "header", parameters: [{ type: "document", document: { id: media.id, filename: `${String(d.number).replace(/[^A-Za-z0-9_-]/g, "_")}_v${row.version}.pdf` } }] }, { type: "body", parameters }] } }) }); }
  catch { throw new DeliveryFailure("delivery_outcome_unknown", true); }
  if (!response.ok) throw new DeliveryFailure(response.status >= 500 ? "delivery_outcome_unknown" : "provider_rejected", response.status >= 500);
  try { const result = await response.json() as any; if (!result.messages?.[0]?.id) throw new Error(); return String(result.messages[0].id); }
  catch { throw new DeliveryFailure("delivery_outcome_unknown", true); }
}
