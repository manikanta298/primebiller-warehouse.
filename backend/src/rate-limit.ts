import type { RequestHandler } from "express";

/** Process-local fixed-window limiter. Deploy behind the gateway's IP limiter too. */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, { count: number; until: number }>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  constructor(max: number, windowMs: number, maxKeys = 20_000) {
    this.max = max;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    if (!Number.isInteger(max) || max < 1 || !Number.isFinite(windowMs) || windowMs < 1000 || maxKeys < 1) {
      throw new Error("Invalid rate limit configuration");
    }
  }

  consume(key: string, now = Date.now()): { allowed: boolean; retryAfter: number } {
    const current = this.windows.get(key);
    if (!current || now >= current.until) {
      if (this.windows.size >= this.maxKeys) {
        for (const [k, window] of this.windows) if (now >= window.until) this.windows.delete(k);
      }
      // Fail closed instead of dropping active limits when under a key-flood attack.
      if (!current && this.windows.size >= this.maxKeys) return { allowed: false, retryAfter: Math.ceil(this.windowMs / 1000) };
      this.windows.set(key, { count: 1, until: now + this.windowMs });
      return { allowed: true, retryAfter: 0 };
    }
    current.count += 1;
    return current.count <= this.max
      ? { allowed: true, retryAfter: 0 }
      : { allowed: false, retryAfter: Math.max(1, Math.ceil((current.until - now) / 1000)) };
  }
}

export function limitAuthRequests(max: number, windowMs = 15 * 60_000): RequestHandler {
  const limiter = new FixedWindowLimiter(max, windowMs);
  return (req, res, next) => {
    // req.ip is the client address only because app.ts trusts precisely one
    // private gateway hop, which replaces X-Forwarded-For with $remote_addr.
    // req.socket.remoteAddress alone is the shared Nginx container address.
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const result = limiter.consume(ip);
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfter));
      res.status(429).json({ code: "rate_limited", message: "Too many attempts. Try again later." });
      return;
    }
    next();
  };
}
