import { Router } from "express";
import { h } from "../http.js";
import { requirePerm } from "../auth.js";
import { ApiError } from "../errors.js";
import { exec, one, rows, withTransaction } from "../db.js";
import { DOC_TABLES } from "../uow.js";
import { recordReferenced, type DeletableRecord } from "../shared/record-delete-rules.js";

export const recordDeleteRouter = Router();
const kinds = { items: "items", parties: "parties", warehouses: "godowns" } as const;
for (const kind of Object.keys(kinds) as DeletableRecord[]) {
  const path = kind === "warehouses" ? "/orgs/:orgId/godowns/:id" : `/${kind}/:id`;
  recordDeleteRouter.delete(path, h(req => {
    requirePerm(req.ctx, "editMasters", "Only Owner or Manager can delete master records");
    if (req.params["orgId"] && req.params["orgId"] !== req.ctx.orgId) throw new ApiError(403, "forbidden", "Select the current organisation");
    return withTransaction(async conn => {
      const org = req.ctx.orgId, id = String(req.params["id"]), table = kinds[kind];
      // Same master-row locks are acquired by document creation; a concurrent
      // creator either finishes before the reference check or sees a missing master.
      const record = await one(conn, `SELECT * FROM ${table} WHERE org_id = ? AND id = ? FOR UPDATE`, [org, id]);
      if (!record) throw new ApiError(404, "not_found", "Record not found in this organisation");
      const used = (reason: string): never => { throw new ApiError(409, "record_in_use", reason); };
      if (kind === "parties" && Number(record["outstanding"]) !== 0) used("This party has an outstanding balance. Keep the record and use Block instead.");
      if (kind !== "parties") {
        const column = kind === "items" ? "item_id" : "godown_id";
        const stock = await one(conn, `SELECT item_id FROM item_stock WHERE org_id = ? AND ${column} = ? AND (on_hand <> 0 OR held <> 0) LIMIT 1`, [org, id]);
        if (stock) used("This record has stock or held reservations and cannot be deleted.");
        if (await one(conn, `SELECT id FROM batches WHERE org_id = ? AND ${column} = ? LIMIT 1`, [org,id])) used("This record has batch history and cannot be deleted.");
        if (await one(conn, `SELECT id FROM stock_ledger WHERE org_id = ? AND ${column} = ? LIMIT 1`, [org,id])) used("This record has stock history. Keep it and use Inactive after clearing stock.");
      }
      if (kind === "warehouses" && await one(conn, "SELECT user_id FROM user_godowns WHERE godown_id = ? LIMIT 1", [id])) used("This warehouse is assigned to users. Remove its assignments before deleting an unused warehouse.");
      // Inspect only this tenant's documents; include drafts and cancelled history.
      // Delete is an infrequent maintenance action, so use the shared JSON rule.
      for (const docTable of Object.values(DOC_TABLES)) {
        for (const row of await rows(conn, `SELECT body FROM ${docTable} WHERE org_id = ?`, [org])) {
          const doc = typeof row["body"] === "string" ? JSON.parse(row["body"]) : row["body"];
          if (recordReferenced(kind,id,doc)) used("This record is used by existing documents. Keep it and use Inactive or Block instead.");
        }
      }
      if (kind !== "parties") {
        const column = kind === "items" ? "item_id" : "godown_id";
        // Only unused zero-balance threshold rows can reach this point.
        await exec(conn, `DELETE FROM item_stock WHERE org_id = ? AND ${column} = ?`, [org,id]);
      }
      await exec(conn, `DELETE FROM ${table} WHERE org_id = ? AND id = ?`, [org,id]);
      return { deleted: true, id };
    });
  }));
}
