import express from "express";
import { h } from "../http.js";
import { exec, one, withTransaction } from "../db.js";
import { validSignature, sameSecret } from "../whatsapp-security.js";
import { advanceDeliveryStatus } from "../shared/distribution-rules.js";

export const whatsappWebhookRouter = express.Router();
whatsappWebhookRouter.get("/", (req, res) => {
  if (req.query["hub.mode"] !== "subscribe" || typeof req.query["hub.verify_token"] !== "string" || !sameSecret(req.query["hub.verify_token"], process.env.WHATSAPP_VERIFY_TOKEN ?? "")) { res.sendStatus(403); return; }
  res.type("text/plain").send(String(req.query["hub.challenge"] ?? ""));
});
whatsappWebhookRouter.post("/", express.raw({ type: "application/json", limit: "256kb" }), h(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !validSignature(req.body, req.header("x-hub-signature-256") ?? "", process.env.WHATSAPP_APP_SECRET ?? "")) { res.sendStatus(401); return; }
  let body;
  try { body = JSON.parse(req.body.toString("utf8")); } catch { res.sendStatus(400); return; }
  if (body.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) { res.sendStatus(400); return; }
  for (const entry of body.entry) for (const change of entry.changes ?? []) {
    if (change.value?.metadata?.phone_number_id !== process.env.WHATSAPP_PHONE_NUMBER_ID) continue;
    for (const status of change.value?.statuses ?? []) {
      if (typeof status.id !== "string" || !["sent", "delivered", "read", "failed"].includes(status.status)) continue;
      await withTransaction(async conn => {
        const row = await one(conn, "SELECT org_id, status FROM document_distributions WHERE provider_id = ? AND org_id = ? FOR UPDATE", [status.id, process.env.WHATSAPP_ORG_ID ?? ""]);
        if (!row) return;
        await exec(conn, "UPDATE document_distributions SET status = ? WHERE org_id = ? AND provider_id = ?", [advanceDeliveryStatus(row.status, status.status), row.org_id, status.id]);
      });
    }
  }
  return { ok: true };
}));
