import type { NextFunction, Request, RequestHandler, Response } from "express";
import { withConnection, withTransaction } from "./db.js";
import { Uow } from "./uow.js";

/** Wraps an async handler so thrown errors reach the error middleware. */
export const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).then((out) => {
      if (res.headersSent) return;
      if (out === undefined) res.status(204).end();
      else res.json(out);
    }, next);
  };

/** Write path: one transaction, rows locked as they're loaded, all changes flushed before commit. */
export function write<T>(req: Request, fn: (u: Uow) => Promise<T>): Promise<T> {
  return withTransaction(async (conn) => {
    const u = new Uow(conn, req.ctx, true);
    const out = await fn(u);
    await u.flush();
    return out;
  });
}

/** Read path: no locks, nothing written. */
export function read<T>(req: Request, fn: (u: Uow) => Promise<T>): Promise<T> {
  return withConnection((conn) => fn(new Uow(conn, req.ctx, false)));
}

export const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
