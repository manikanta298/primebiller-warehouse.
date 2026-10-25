import "dotenv/config";
import { exec, one, rows, pool, withTransaction } from "./db.js";
import { jsonBody } from "./distribution.js";
import { normalizeWhatsappPhone } from "./shared/distribution-rules.js";
import { DeliveryFailure, providerReady, sendDocument } from "./whatsapp-provider.js";

/** Commit processing before network I/O. A crash remains visibly uncertain, never auto-replayed. */
export async function processNext() {
  const candidate = await one(pool, "SELECT org_id, document_type, document_id, version FROM document_distributions WHERE status = 'queued' ORDER BY created_at LIMIT 1");
  if (!candidate) return false;
  const key = [candidate.org_id, candidate.document_type, candidate.document_id, candidate.version];
  const claimed = await withTransaction(async conn => {
    const table = candidate.document_type === "quotation" ? "quotations" : "invoices";
    const source = await one(conn, `SELECT body FROM ${table} WHERE org_id = ? AND id = ? FOR UPDATE`, [candidate.org_id, candidate.document_id]);
    const row = await one(conn, "SELECT * FROM document_distributions WHERE org_id = ? AND document_type = ? AND document_id = ? AND version = ? FOR UPDATE", key);
    if (!row || row.status !== "queued") return undefined;
    const latest = await one(conn, "SELECT MAX(version) AS version FROM document_distributions WHERE org_id = ? AND document_type = ? AND document_id = ?", key.slice(0, 3));
    const doc = source ? jsonBody(source.body) : undefined;
    if (!doc || doc.status === "cancelled" || latest?.version !== row.version) {
      await exec(conn, "UPDATE document_distributions SET status = 'superseded' WHERE org_id = ? AND document_type = ? AND document_id = ? AND version = ?", key); return undefined;
    }
    if (row.document_type === "quotation" && row.version > 1 && (!row.decision_by || row.decision_by === row.author_id)) {
      await exec(conn, "UPDATE document_distributions SET status = 'pending_approval' WHERE org_id = ? AND document_type = ? AND document_id = ? AND version = ?", key); return undefined;
    }
    await exec(conn, "UPDATE document_distributions SET status = 'processing', attempts = attempts + 1 WHERE org_id = ? AND document_type = ? AND document_id = ? AND version = ?", key);
    return row;
  });
  if (!claimed) return true;
  // Lock document/preferences again through the actual send: revision saves and consent revocation serialize with it.
  await withTransaction(async conn => {
    const table = claimed.document_type === "quotation" ? "quotations" : "invoices";
    const source = await one(conn, `SELECT body FROM ${table} WHERE org_id = ? AND id = ? FOR UPDATE`, key.filter((_, i) => i === 0 || i === 2));
    const row = await one(conn, "SELECT * FROM document_distributions WHERE org_id = ? AND document_type = ? AND document_id = ? AND version = ? FOR UPDATE", key);
    if (!row || row.status !== "processing") return;
    const latest = await one(conn, "SELECT MAX(version) AS version FROM document_distributions WHERE org_id = ? AND document_type = ? AND document_id = ?", key.slice(0, 3));
    let status = "superseded", error: string | null = null, providerId: string | null = null;
    if (source && jsonBody(source.body).status !== "cancelled" && latest?.version === row.version) {
      const prefs = await one(conn, "SELECT enabled, phone FROM customer_communication_preferences WHERE org_id = ? AND customer_id = ? FOR UPDATE", [row.org_id, row.customer_id]);
      const phone = prefs?.enabled ? normalizeWhatsappPhone(prefs.phone) : null;
      if (!phone || !providerReady(row.org_id)) { status = "blocked"; error = !phone ? "consent_or_phone_required" : "provider_not_configured"; }
      else try { providerId = await sendDocument(row, jsonBody(row.snapshot), phone); status = "accepted"; }
      catch (e) { status = e instanceof DeliveryFailure && e.uncertain ? "uncertain" : "failed"; error = e instanceof DeliveryFailure ? e.code : "render_failed"; }
    }
    await exec(conn, "UPDATE document_distributions SET status = ?, error_code = ?, provider_id = ? WHERE org_id = ? AND document_type = ? AND document_id = ? AND version = ?", [status, error, providerId, ...key]);
  });
  return true;
}
if (process.argv[1]?.endsWith("notification-worker.js") || process.argv[1]?.endsWith("notification-worker.ts")) {
  let stopping = false; process.on("SIGTERM", () => { stopping = true; }); process.on("SIGINT", () => { stopping = true; });
  while (!stopping) { try { await processNext(); } catch { console.error("Notification worker operation failed; processing entries require reconciliation"); } await new Promise(resolve => setTimeout(resolve, 1500)); }
  await pool.end();
}
