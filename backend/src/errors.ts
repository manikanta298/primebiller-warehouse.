import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

/** Same shape the frontend's ApiError expects: { code, message, details }. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) return res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(422).json({ code: "validation", message: first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input", details: err.issues });
  }
  const e = err as { code?: string; message?: string };
  if (e?.code === "ER_DUP_ENTRY") return res.status(409).json({ code: "duplicate", message: "That record already exists" });
  console.error(err);
  return res.status(500).json({ code: "server_error", message: "Something went wrong on the server" });
}
