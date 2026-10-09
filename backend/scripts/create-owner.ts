/**
 * One-time setup for a new installation: creates your organisation, its numbering series,
 * default settings and print layouts, and the first Owner login. Refuses to run if an
 * organisation already exists. Values come from environment variables (put them in .env
 * for this one run, then remove the password):
 *
 *   SETUP_ORG_NAME, SETUP_ORG_GSTIN,
 *   SETUP_OWNER_NAME, SETUP_OWNER_EMAIL, SETUP_OWNER_PASSWORD (min 8 chars), SETUP_OWNER_MOBILE (optional)
 *
 *   npm run setup:owner
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool, exec, one, newId, withTransaction } from "../src/db.js";
import { stateName } from "../src/states.js";
import { isValidGstin, stateFromGstin } from "../src/shared/gst.js";
import { fyLabel } from "../src/shared/numbering.js";

const env = z.object({
  SETUP_ORG_NAME: z.string().min(2),
  SETUP_ORG_GSTIN: z.string().length(15),
  SETUP_OWNER_NAME: z.string().min(2),
  SETUP_OWNER_EMAIL: z.string().email(),
  SETUP_OWNER_PASSWORD: z.string().min(8),
  SETUP_OWNER_MOBILE: z.string().optional().default(""),
}).parse(process.env);

const gstin = env.SETUP_ORG_GSTIN.trim().toUpperCase();
if (!isValidGstin(gstin)) throw new Error("SETUP_ORG_GSTIN is not a valid GSTIN");
const stateCode = stateFromGstin(gstin);

const today = new Date().toISOString().slice(0, 10);
const fy = fyLabel(today); // e.g. "26-27"
const startYear = 2000 + Number(fy.slice(0, 2));

const SERIES: Record<string, string> = { SO: "SO", DC: "DC", INV: "INV", RCT: "RCT", PO: "PO", GRN: "GRN", TRF: "TRF", ADJ: "ADJ" };

const settings = {
  legalName: env.SETUP_ORG_NAME, tradeName: env.SETUP_ORG_NAME, gstin, pan: gstin.slice(2, 12),
  address: "", stateCode, phone: "", email: env.SETUP_OWNER_EMAIL, bankName: "", bankAccount: "", ifsc: "",
  invoiceTerms: "", jurisdiction: "",
  fyName: `FY ${startYear}-${String(startYear + 1).slice(2)}`, fyStart: `${startYear}-04-01`, fyEnd: `${startYear + 1}-03-31`, fyStatus: "open",
  composition: false, ewbThreshold: 50000, einvoiceThreshold: 50000000, roundOff: "nearest_rupee",
  adjApprovalLimit: 25000, reasonCodes: [],
  gsp: { provider: "", username: "", clientId: "", sandbox: true },
};

const PROFILES = [
  { id: "A", name: "80 mm thermal (gate pass / counter bill)", paper: "80mm", showLogo: false, showBank: false, showHsnSummary: false, showSignature: false, showQr: false, copies: 1, footer: "" },
  { id: "B", name: "A4 tax invoice", paper: "A4", showLogo: true, showBank: true, showHsnSummary: true, showSignature: true, showQr: false, copies: 3, footer: "This is a computer generated invoice." },
];

await withTransaction(async (conn) => {
  if (await one(conn, "SELECT id FROM orgs LIMIT 1", [])) throw new Error("An organisation already exists — setup has already been done.");
  const orgId = newId("org");
  const userId = newId("u");
  await exec(conn, "INSERT INTO orgs (id, name, gstin, state_code, state_name) VALUES (?,?,?,?,?)", [orgId, env.SETUP_ORG_NAME, gstin, stateCode, stateName(stateCode)]);
  await exec(conn, "INSERT INTO users (id, name, email, mobile, password_hash, active) VALUES (?,?,?,?,?,1)",
    [userId, env.SETUP_OWNER_NAME, env.SETUP_OWNER_EMAIL.toLowerCase(), env.SETUP_OWNER_MOBILE, await bcrypt.hash(env.SETUP_OWNER_PASSWORD, 12)]);
  await exec(conn, "INSERT INTO user_roles (user_id, org_id, role) VALUES (?,?,'Owner')", [userId, orgId]);
  for (const [t, prefix] of Object.entries(SERIES))
    await exec(conn, "INSERT INTO doc_series (org_id, doc_type, prefix, padding, reset_per_fy) VALUES (?,?,?,5,1)", [orgId, t, prefix]);
  await exec(conn, "INSERT INTO org_settings (org_id, body) VALUES (?,?)", [orgId, JSON.stringify(settings)]);
  for (const p of PROFILES) await exec(conn, "INSERT INTO print_profiles (org_id, id, body) VALUES (?,?,?)", [orgId, p.id, JSON.stringify(p)]);
});

console.log(`Created ${env.SETUP_ORG_NAME} and Owner login ${env.SETUP_OWNER_EMAIL}. Add your godowns, items and parties from the app.`);
await pool.end();
