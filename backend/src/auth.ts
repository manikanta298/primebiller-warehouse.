import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { one, pool } from "./db.js";
import { ApiError } from "./errors.js";
import { can, type Permission } from "./shared/permissions.js";
import type { Role } from "./shared/types.js";

export interface Ctx {
  userId: string;
  userName: string;
  role: Role;
  orgId: string;
  orgStateCode: string;
  orgGstin: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx: Ctx;
    }
  }
}

export function signToken(userId: string, tokenVersion: number) {
  return jwt.sign({ sub: userId, tv: tokenVersion }, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
}

/**
 * Verifies the bearer token, checks the user is active and the token has not been
 * revoked (role change / deactivation bumps token_version), then loads the role for
 * the organisation named in the X-Org-Id header.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const h = req.header("authorization") ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    if (!token) throw new ApiError(401, "unauthenticated", "Sign in first");
    let payload: { sub: string; tv: number };
    try {
      payload = jwt.verify(token, config.jwtSecret) as typeof payload;
    } catch {
      throw new ApiError(401, "unauthenticated", "Your session has expired. Sign in again.");
    }
    const u = await one(pool, "SELECT id, name, active, token_version FROM users WHERE id = ?", [payload.sub]);
    if (!u || !u["active"] || u["token_version"] !== payload.tv) throw new ApiError(401, "unauthenticated", "Your session has ended. Sign in again.");
    const orgId = req.header("x-org-id") || (req.params["orgId"] as string | undefined);
    const r = orgId
      ? await one(pool, "SELECT ur.role, o.id, o.state_code, o.gstin FROM user_roles ur JOIN orgs o ON o.id = ur.org_id WHERE ur.user_id = ? AND ur.org_id = ?", [u["id"], orgId])
      : await one(pool, "SELECT ur.role, o.id, o.state_code, o.gstin FROM user_roles ur JOIN orgs o ON o.id = ur.org_id WHERE ur.user_id = ? ORDER BY o.name LIMIT 1", [u["id"]]);
    if (!r) throw new ApiError(403, "no_org_access", "You don't have access to this organisation");
    req.ctx = { userId: u["id"], userName: u["name"], role: r["role"], orgId: r["id"], orgStateCode: r["state_code"], orgGstin: r["gstin"] };
    next();
  } catch (e) {
    next(e);
  }
}

export function requirePerm(ctx: Ctx, p: Permission, message: string) {
  if (!can(ctx.role, p)) throw new ApiError(403, "forbidden", message);
}
