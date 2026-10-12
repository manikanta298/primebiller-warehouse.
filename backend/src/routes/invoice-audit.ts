import { Router } from "express";
import { z } from "zod";
import { h } from "../http.js";
import { one, rows, withConnection } from "../db.js";
import { ApiError } from "../errors.js";
import { parseSnapshot, snapshotHash } from "../invoice-audit.js";

export const invoiceAuditRouter = Router();
export const invoiceAuditHandler = h(req => {
  if (!["Owner","Manager","Accountant","Chartered Accountant"].includes(req.ctx.role)) throw new ApiError(403,"forbidden","Your role cannot audit invoices");
  const query = z.object({
    after: z.string().regex(/^\d{1,20}$/).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }).strict().parse(req.query);
  return withConnection(async conn => {
    const invoiceId = String(req.params["id"]), org = req.ctx.orgId;
    const current = await one(conn,"SELECT body FROM invoices WHERE org_id = ? AND id = ?",[org,invoiceId]);
    if (!current) throw new ApiError(404,"not_found","Invoice not found in this organisation");
    const events = await rows(conn, `SELECT CAST(id AS CHAR) AS id, event_type, actor_id, actor_name, before_snapshot, after_snapshot, snapshot_sha256, created_at
      FROM invoice_audit_events WHERE org_id = ? AND invoice_id = ? AND id > ? ORDER BY id LIMIT ?`, [org,invoiceId,query.after ?? "0",query.limit + 1]);
    const more = events.length > query.limit, page = events.slice(0,query.limit);
    return { invoiceId, currentSnapshotHash: snapshotHash(parseSnapshot(current["body"])),
      events: page.map(e => ({ id:String(e["id"]),event:e["event_type"],actorId:e["actor_id"],actorName:e["actor_name"],at:e["created_at"],
        before:e["before_snapshot"] ? parseSnapshot(e["before_snapshot"]) : null, after:parseSnapshot(e["after_snapshot"]),snapshotHash:e["snapshot_sha256"] })),
      nextCursor: more ? String(page[page.length-1]!["id"]) : null,
      coverage: "Events recorded after this feature was deployed; baseline events are migration-time snapshots, not original issuance history" };
  });
});
invoiceAuditRouter.get("/invoices/:id/audit", invoiceAuditHandler);
