import type { RequestHandler } from "express";
import type { Ctx } from "./auth.js";
import { ApiError } from "./errors.js";
import type { Role } from "./shared/types.js";

// Owner/Manager administer the organisation; Accountant has organisation-wide finance access.
// Operational staff fail closed when no active warehouses have been assigned.
export function warehouseIds(ctx: Ctx): string[] | undefined {
  return ["Owner", "Manager", "Accountant"].includes(ctx.role) ? undefined : (ctx.godownIds ?? []);
}
export function canUseWarehouse(ctx: Ctx, id: string): boolean {
  const ids = warehouseIds(ctx);
  return ids === undefined || ids.includes(id);
}
export function requireWarehouse(ctx: Ctx, id: string): void {
  if (!canUseWarehouse(ctx, id)) throw new ApiError(403, "warehouse_forbidden", "This warehouse is not assigned to you");
}
export function visibleDocument(ctx: Ctx, key: string, doc: any): boolean {
  if (warehouseIds(ctx) === undefined) return true;
  if (key === "transfers") return canUseWarehouse(ctx, doc.fromId) || canUseWarehouse(ctx, doc.toId);
  if (key === "challans" && ctx.role === "Driver" && doc.driverName?.toLowerCase() !== ctx.userName.toLowerCase()) return false;
  return typeof doc.godownId === "string" && canUseWarehouse(ctx, doc.godownId);
}

const READ_ROLES: [RegExp, Role[]][] = [
  [/^\/users(?:\/|$)/, ["Owner"]],
  [/^\/settings\/numbering(?:\/|$)/, ["Owner"]],
  [/^\/settings$/, ["Owner", "Manager", "Accountant", "Storekeeper", "Driver"]],
  [/^\/print-profiles(?:\/|$)/, ["Owner", "Manager", "Accountant", "Storekeeper", "Driver"]],
  [/^\/reports(?:\/|$)/, ["Owner", "Manager", "Accountant"]],
  [/^\/items(?:\/|$)/, ["Owner", "Manager", "Storekeeper", "Sales", "Accountant"]],
  [/^\/parties(?:\/|$)/, ["Owner", "Manager", "Sales", "Accountant"]],
  [/^\/masters(?:\/|$)/, ["Owner", "Manager"]],
  [/^\/quotations(?:\/|$)/, ["Owner", "Manager", "Sales", "Accountant"]],
  [/^\/sales-orders(?:\/|$)/, ["Owner", "Manager", "Sales"]],
  [/^\/challans(?:\/|$)/, ["Owner", "Manager", "Storekeeper", "Driver"]],
  [/^\/(?:invoices|receipts)(?:\/|$)/, ["Owner", "Manager", "Accountant"]],
  [/^\/(?:purchase-orders|grns|transfers|adjustments)(?:\/|$)/, ["Owner", "Manager", "Storekeeper"]],
  [/^\/stock\/ledger(?:\/|$)/, ["Owner", "Manager", "Storekeeper", "Accountant"]],
  [/^\/alerts(?:\/|$)/, ["Owner", "Manager", "Storekeeper"]],
  [/^\/search(?:\/|$)/, ["Owner", "Manager", "Sales", "Accountant"]],
  [/^\/orgs\/[^/]+\/godowns(?:\/|$)/, ["Owner", "Manager", "Storekeeper", "Sales", "Accountant", "Driver"]],
  [/^\/(?:dashboard|notifications)$/, ["Owner", "Manager", "Storekeeper", "Sales", "Accountant"]],
];
export const enforceReadAccess: RequestHandler = (req, _res, next) => {
  try {
    if (req.method === "GET" || req.method === "HEAD") {
      const rule = READ_ROLES.find(([pattern]) => pattern.test(req.path));
      if (!rule || !rule[1].includes(req.ctx.role)) throw new ApiError(403, "forbidden", "Your role cannot read this resource");
    }
    next();
  } catch (error) { next(error); }
};
