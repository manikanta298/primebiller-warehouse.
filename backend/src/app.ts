import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { requireAuth } from "./auth.js";
import { errorHandler } from "./errors.js";
import { authRouter } from "./routes/auth.js";
import { coreRouter } from "./routes/core.js";
import { salesRouter } from "./routes/sales.js";
import { inventoryRouter } from "./routes/inventory.js";
import { adminRouter } from "./routes/admin.js";
import { pool } from "./db.js";
import { importRouter } from "./routes/imports.js";
import { limitAuthRequests } from "./rate-limit.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // Exactly one trusted reverse-proxy hop (the private Docker gateway).
  // Nginx overwrites X-Forwarded-For with $remote_addr, so a caller cannot
  // prepend a spoofed address. Do not expose the backend port publicly.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    allowedHeaders: ["Content-Type", "Authorization", "X-Org-Id", "Idempotency-Key"],
  }));
  // Bulk-import uploads arrive base64-encoded; allow them more room than other requests.
  app.use("/api/v1/import", express.json({ limit: "15mb" }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  const v1 = express.Router();
  // Per-worker defence-in-depth against password guessing and email flooding.
  // The nginx gateway adds a separate shared-per-IP boundary for this deployment.
  v1.use("/auth/login", limitAuthRequests(15));
  v1.use("/auth/register", limitAuthRequests(5));
  v1.use("/auth/setup-status", limitAuthRequests(30));
  v1.use("/auth/forgot-password", limitAuthRequests(5));
  v1.use("/auth/reset-password", limitAuthRequests(10));
  v1.use("/auth/accept-invite", limitAuthRequests(10));
  v1.use("/auth", authRouter);
  v1.use(requireAuth); // everything below needs a valid token
  v1.use(coreRouter);
  v1.use(salesRouter);
  v1.use(inventoryRouter);
  v1.use(adminRouter);
  v1.use(importRouter);
  app.use("/api/v1", v1);

  app.use((_req, res) => res.status(404).json({ code: "not_found", message: "No such endpoint" }));
  app.use(errorHandler);
  return app;
}
