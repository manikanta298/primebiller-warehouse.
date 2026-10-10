import bcrypt from "bcryptjs";
import { timingSafeEqual } from "node:crypto";
import type { Pool } from "mysql2/promise";
import { z } from "zod";
import { pool, exec, one, newId } from "./db.js";
import { ApiError } from "./errors.js";
import { stateName } from "./states.js";
import { isValidGstin, stateFromGstin } from "./shared/gst.js";
import { fyLabel } from "./shared/numbering.js";
import { today } from "./config.js";

export const firstOwnerInput = z.object({
  orgName: z.string().trim().min(2).max(200),
  orgGstin: z.string().trim().toUpperCase().refine(isValidGstin, "Enter a valid GSTIN"),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(190).transform((value) => value.toLowerCase()),
  password: z.string().min(10, "Use at least 10 characters").max(128),
  mobile: z.string().trim().max(20).optional().default(""),
}).strict();

export function verifySetupToken(provided: string, expected: string): void {
  const actual = Buffer.from(provided);
  const wanted = Buffer.from(expected);
  if (wanted.length < 32 || actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
    throw new ApiError(403, "invalid_setup_code", "First registration requires the private setup code configured by the administrator");
  }
}

/** CLI and web registration share the same one-time, atomic Owner setup. */
export async function createFirstOwner(input: unknown, database: Pick<Pool, "getConnection"> = pool): Promise<string> {
  const data = firstOwnerInput.parse(input);
  const passwordHash = await bcrypt.hash(data.password, 12);
  const conn = await database.getConnection();
  let locked = false;
  let transaction = false;
  try {
    const lock = await one(conn, "SELECT GET_LOCK('girder:first-owner', 10) AS acquired");
    if (Number(lock?.["acquired"]) !== 1) throw new ApiError(503, "setup_busy", "Registration is already in progress. Try again shortly.");
    locked = true;
    await conn.beginTransaction();
    transaction = true;
    if (await one(conn, "SELECT id FROM orgs LIMIT 1") || await one(conn, "SELECT id FROM users LIMIT 1")) {
      throw new ApiError(409, "setup_complete", "The master admin is already registered. Sign in or request an invitation.");
    }
    const orgId = newId("org");
    const userId = newId("u");
    const stateCode = stateFromGstin(data.orgGstin);
    const fy = fyLabel(today());
    const startYear = 2000 + Number(fy.slice(0, 2));
    const settings = {
      legalName: data.orgName, tradeName: data.orgName, gstin: data.orgGstin, pan: data.orgGstin.slice(2, 12),
      address: "", stateCode, phone: "", email: data.email, bankName: "", bankAccount: "", ifsc: "",
      invoiceTerms: "", jurisdiction: "",
      fyName: `FY ${startYear}-${String(startYear + 1).slice(2)}`, fyStart: `${startYear}-04-01`, fyEnd: `${startYear + 1}-03-31`, fyStatus: "open",
      composition: false, ewbThreshold: 50000, einvoiceThreshold: 50000000, roundOff: "nearest_rupee",
      adjApprovalLimit: 25000, reasonCodes: [],
      gsp: { provider: "", username: "", clientId: "", sandbox: true },
    };
    await exec(conn, "INSERT INTO orgs (id, name, gstin, state_code, state_name) VALUES (?,?,?,?,?)", [orgId, data.orgName, data.orgGstin, stateCode, stateName(stateCode)]);
    await exec(conn, "INSERT INTO users (id, name, email, mobile, password_hash, active) VALUES (?,?,?,?,?,1)", [userId, data.name, data.email, data.mobile, passwordHash]);
    await exec(conn, "INSERT INTO user_roles (user_id, org_id, role) VALUES (?,?,'Owner')", [userId, orgId]);
    const series: Record<string, string> = { SO: "SO", DC: "DC", INV: "INV", RCT: "RCT", PO: "PO", GRN: "GRN", TRF: "TRF", ADJ: "ADJ" };
    for (const [type, prefix] of Object.entries(series)) {
      await exec(conn, "INSERT INTO doc_series (org_id, doc_type, prefix, padding, reset_per_fy) VALUES (?,?,?,5,1)", [orgId, type, prefix]);
    }
    await exec(conn, "INSERT INTO org_settings (org_id, body) VALUES (?,?)", [orgId, JSON.stringify(settings)]);
    const profiles = [
      { id: "A", name: "80 mm thermal (gate pass / counter bill)", paper: "80mm", showLogo: false, showBank: false, showHsnSummary: false, showSignature: false, showQr: false, copies: 1, footer: "" },
      { id: "B", name: "A4 tax invoice", paper: "A4", showLogo: true, showBank: true, showHsnSummary: true, showSignature: true, showQr: false, copies: 3, footer: "This is a computer generated invoice." },
    ];
    for (const profile of profiles) {
      await exec(conn, "INSERT INTO print_profiles (org_id, id, body) VALUES (?,?,?)", [orgId, profile.id, JSON.stringify(profile)]);
    }
    await conn.commit();
    transaction = false;
    return userId;
  } catch (error) {
    if (transaction) await conn.rollback();
    throw error;
  } finally {
    // Release after commit/rollback so two simultaneous requests cannot both win.
    if (locked) {
      try { await conn.query("SELECT RELEASE_LOCK('girder:first-owner')"); }
      catch { conn.destroy(); }
    }
    conn.release();
  }
}
