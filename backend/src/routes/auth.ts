import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { exec, one, pool, rows, withTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { h } from "../http.js";
import { signToken } from "../auth.js";
import { config, today } from "../config.js";
import { sendPasswordResetEmail, sendRegistrationEmail, smtpConfigured } from "../smtp.js";
import type { LoginResponse } from "../shared/types.js";
import { createFirstOwner, firstOwnerInput, verifySetupToken } from "../first-owner.js";

export const authRouter = Router();

authRouter.get("/setup-status", h(async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const enabled = Buffer.byteLength(config.setupRegistrationToken) >= 32;
  const existing = enabled ? await one(pool, "SELECT id FROM orgs LIMIT 1") || await one(pool, "SELECT id FROM users LIMIT 1") : true;
  return { available: enabled && !existing };
}));

authRouter.post("/register", h(async (req) => {
  const { setupCode, ...input } = firstOwnerInput.extend({ setupCode: z.string().max(256) }).parse(req.body);
  verifySetupToken(setupCode, config.setupRegistrationToken);
  const userId = await createFirstOwner(input);
  const response = await loginResponse(userId);
  if (smtpConfigured()) {
    try { await sendRegistrationEmail(response.user.email, response.user.name); }
    catch (error) { console.error("Registration confirmation email delivery failed", error); }
  }
  return response;
}));

async function loginResponse(userId: string): Promise<LoginResponse> {
  const u = (await one(pool, "SELECT id, name, email, token_version FROM users WHERE id = ?", [userId]))!;
  const orgs = await rows(pool, "SELECT o.id, o.name, o.gstin, o.state_code, o.state_name, ur.role FROM user_roles ur JOIN orgs o ON o.id = ur.org_id WHERE ur.user_id = ? ORDER BY o.name", [userId]);
  if (!orgs.length) throw new ApiError(403, "no_org_access", "Your account isn't linked to any organisation yet");
  return {
    token: signToken(u["id"], u["token_version"]),
    user: { id: u["id"], name: u["name"], email: u["email"], role: orgs[0]!["role"] },
    orgs: orgs.map((o) => ({ id: o["id"], name: o["name"], gstin: o["gstin"], stateCode: o["state_code"], stateName: o["state_name"] })),
  };
}

authRouter.post("/login", h(async (req) => {
  const { email, password } = z.object({ email: z.string(), password: z.string() }).parse(req.body);
  const u = await one(pool, "SELECT id, password_hash, active FROM users WHERE email = ?", [email.trim().toLowerCase()]);
  // Same message for unknown email and wrong password.
  if (!u || !u["password_hash"] || !(await bcrypt.compare(password, u["password_hash"]))) throw new ApiError(401, "invalid_credentials", "Email or password is incorrect");
  if (!u["active"]) throw new ApiError(403, "user_inactive", "This user has been deactivated. Ask the owner.");
  await exec(pool, "UPDATE users SET last_login = ? WHERE id = ?", [today(), u["id"]]);
  return loginResponse(u["id"]);
}));

/** Invited user sets their password using the link the Owner shared. */
authRouter.post("/accept-invite", h(async (req) => {
  const { token, password } = z.object({ token: z.string().length(64), password: z.string().min(8, "Use at least 8 characters") }).parse(req.body);
  const u = await one(pool, "SELECT id FROM users WHERE invite_token = ? AND invite_expires_at > UTC_TIMESTAMP() AND active = 1", [token]);
  if (!u) throw new ApiError(400, "invalid_invite", "This invite link is invalid or has expired");
  await exec(pool, "UPDATE users SET password_hash = ?, invite_token = NULL, invite_expires_at = NULL WHERE id = ?", [await bcrypt.hash(password, 12), u["id"]]);
  return loginResponse(u["id"]);
}));

/** JWTs are stateless; logout just lets the client drop the token. */
authRouter.post("/logout", h(async () => undefined));


const resetRequest = z.object({ email: z.string().trim().email().max(190).transform((email) => email.toLowerCase()) });
const resetInput = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: z.string().min(10).max(128) });
const resetNotice = { message: "If an active account exists for this email, you'll receive a reset link shortly." };

/** An opaque, random reset token is emailed; only its SHA-256 digest is stored in MySQL. */
authRouter.post("/forgot-password", h(async (req) => {
  const { email } = resetRequest.parse(req.body);
  if (!smtpConfigured()) throw new ApiError(503, "mail_unavailable", "Password recovery email is not configured");
  const u = await one(pool, "SELECT id FROM users WHERE email = ? AND active = 1 AND password_hash IS NOT NULL", [email]);
  if (!u) return resetNotice; // Never reveal whether an address is registered.

  const recent = await one(pool, "SELECT COUNT(*) AS n FROM password_reset_tokens WHERE user_id = ? AND requested_at > UTC_TIMESTAMP() - INTERVAL 15 MINUTE", [u["id"]]);
  if (Number(recent?.["n"] || 0) >= 3) return resetNotice;

  const token = randomBytes(32).toString("hex");
  const digest = createHash("sha256").update(token).digest("hex");
  await exec(pool, "INSERT INTO password_reset_tokens (token_hash, user_id, requested_at, expires_at) VALUES (?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP() + INTERVAL 1 HOUR)", [digest, u["id"]]);
  const link = `${config.appUrl.replace(/\/$/, "")}/login?reset=${token}`;
  try {
    await sendPasswordResetEmail(email, link);
  } catch (error) {
    await exec(pool, "DELETE FROM password_reset_tokens WHERE token_hash = ?", [digest]);
    // Keep the response identical for registered and unknown addresses.
    console.error("Password reset email delivery failed", error);
  }
  return resetNotice;
}));

/** Single-use reset link, one-hour lifetime, and JWT revocation on password change. */
authRouter.post("/reset-password", h(async (req) => {
  const { token, password } = resetInput.parse(req.body);
  const digest = createHash("sha256").update(token).digest("hex");
  const passwordHash = await bcrypt.hash(password, 12);
  await withTransaction(async (conn) => {
    const record = await one(conn, `SELECT t.user_id FROM password_reset_tokens t
      JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > UTC_TIMESTAMP()
        AND u.active = 1 FOR UPDATE`, [digest]);
    if (!record) throw new ApiError(400, "invalid_reset", "This reset link is invalid or has expired. Request a new one.");
    await exec(conn, "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?", [passwordHash, record["user_id"]]);
    await exec(conn, "UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL", [record["user_id"]]);
  });
  return { message: "Your password has been updated. Sign in with your new password." };
}));
