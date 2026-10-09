/** Users & roles, settings, numbering series, print profiles, search and reports. */
import { Router } from "express";
import { createCipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { exec, newId, one, rows, withTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { h, read, str } from "../http.js";
import { requirePerm } from "../auth.js";
import { config, today } from "../config.js";
import { stateName } from "../states.js";
import { refreshInvoice } from "./sales.js";
import { loadItems } from "./core.js";
import { isValidGstin, stateFromGstin } from "../shared/gst.js";
import { seriesProblems } from "../shared/numbering.js";
import { userProblems, normaliseUserInput, settingsProblems } from "../shared/admin-rules.js";
import { printProfileProblems, normalisePrintProfile } from "../shared/print-rules.js";
import { filterDocs } from "../shared/search-rules.js";
import { buildGstr1, itemSales, receivables, salesRegister, validReportMonth, validReportRange } from "../shared/reports.js";
import { ROLES, type AppUser, type DocHit, type DocType, type NumberSeries, type OrgSettings, type PrintProfile, type SearchDocType } from "../shared/types.js";

export const adminRouter = Router();
const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

// ---------- Users ----------
async function listUsers(conn: Parameters<typeof rows>[0], orgId: string): Promise<AppUser[]> {
  const us = await rows(conn,
    `SELECT u.id, u.name, u.email, u.mobile, u.active, u.last_login, u.invite_token, u.password_hash, ur.role FROM users u JOIN user_roles ur ON ur.user_id = u.id
     WHERE ur.org_id = ? ORDER BY u.name`, [orgId]);
  const gs = await rows(conn, "SELECT ug.user_id, ug.godown_id FROM user_godowns ug JOIN godowns g ON g.id = ug.godown_id WHERE g.org_id = ?", [orgId]);
  return us.map((u) => ({
    id: u["id"], name: u["name"], email: u["email"], mobile: u["mobile"], role: u["role"], active: !!u["active"],
    godownIds: gs.filter((g) => g["user_id"] === u["id"]).map((g) => g["godown_id"]), lastLogin: u["last_login"] ?? undefined,
    invitePending: !u["password_hash"] && !!u["invite_token"],
  }));
}

adminRouter.get("/users", h(async (req) => {
  requirePerm(req.ctx, "manageUsers", "Only the Owner can manage users");
  return withTransaction((conn) => listUsers(conn, req.ctx.orgId));
}));

const userInput = z.object({
  id: z.string().optional(), name: z.string().trim().min(1, "Name is required"), email: z.string().trim().toLowerCase().email("Enter a valid email"),
  mobile: z.string().refine((m) => !m.trim() || /^\d{10}$/.test(m.replace(/\D/g, "")), "Mobile must be 10 digits or blank"), role: z.enum(ROLES as [string, ...string[]]),
  godownIds: z.array(z.string()).min(1, "Pick at least one godown"), active: z.boolean(),
});
const saveUser = h(async (req) => {
  requirePerm(req.ctx, "manageUsers", "Only the Owner can manage users");
  const input = normaliseUserInput(userInput.parse({ ...req.body, id: req.params["id"] ?? req.body.id }) as import("../shared/types.js").AppUserInput);
  const orgId = req.ctx.orgId;
  return withTransaction(async (conn) => {
    // Lock the organisation row: concurrent Owner demotions cannot both remove the last Owner.
    await one(conn, "SELECT id FROM orgs WHERE id = ? FOR UPDATE", [orgId]);
    const okGodowns = await rows(conn, "SELECT id FROM godowns WHERE org_id = ? AND active = 1", [orgId]);
    const existing = await listUsers(conn, orgId);
    const problems = userProblems(input, okGodowns.map((g) => String(g["id"])), existing, req.ctx.userId);
    if (problems.length) throw new ApiError(422, "invalid", problems[0]!);
    const dup = await one(conn, "SELECT id FROM users WHERE email = ? AND id <> ?", [input.email, input.id ?? ""]);
    if (dup) throw new ApiError(409, "duplicate", "A user with this email already exists");
    let inviteUrl: string | undefined;
    let id = input.id;
    if (id) {
      const cur = await one(conn, "SELECT u.id, u.active, ur.role FROM users u JOIN user_roles ur ON ur.user_id = u.id AND ur.org_id = ? WHERE u.id = ? FOR UPDATE", [orgId, id]);
      if (!cur) throw new ApiError(404, "not_found", "User not found");
      // A user may belong to another organisation. Do not mutate their global
      // identity or status from one organisation's administration screen.
      const memberships = await rows(conn, "SELECT org_id FROM user_roles WHERE user_id = ?", [id]);
      if (memberships.length > 1) {
        const profile = await one(conn, "SELECT name, email, mobile, active FROM users WHERE id = ?", [id]);
        if (profile && (profile["name"] !== input.name || profile["email"] !== input.email ||
            profile["mobile"] !== input.mobile || !!profile["active"] !== input.active))
          throw new ApiError(409, "shared_user", "This account belongs to multiple organisations. Change only its role or warehouse permissions here.");
      }
      // Role change or deactivation signs the user out everywhere.
      const revoke = cur["role"] !== input.role || (!!cur["active"] && !input.active);
      await exec(conn, `UPDATE users SET name = ?, email = ?, mobile = ?, active = ?${revoke ? ", token_version = token_version + 1" : ""} WHERE id = ?`,
        [input.name, input.email, input.mobile, +input.active, id]);
      await exec(conn, "UPDATE user_roles SET role = ? WHERE user_id = ? AND org_id = ?", [input.role, id, orgId]);
    } else {
      id = newId("u");
      const token = randomBytes(32).toString("hex");
      await exec(conn, "INSERT INTO users (id, name, email, mobile, active, invite_token, invite_expires_at) VALUES (?,?,?,?,?,?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))",
        [id, input.name, input.email, input.mobile, +input.active, token]);
      await exec(conn, "INSERT INTO user_roles (user_id, org_id, role) VALUES (?,?,?)", [id, orgId, input.role]);
      inviteUrl = `${config.appUrl}/accept-invite?token=${token}`;
      // The Owner receives this once in the response. Never log invite secrets.
    }
    await exec(conn, "DELETE ug FROM user_godowns ug JOIN godowns g ON g.id = ug.godown_id WHERE ug.user_id = ? AND g.org_id = ?", [id, orgId]);
    for (const g of input.godownIds) await exec(conn, "INSERT INTO user_godowns (user_id, godown_id) VALUES (?,?)", [id, g]);
    const user = (await listUsers(conn, orgId)).find((u) => u.id === id)!;
    return inviteUrl ? { ...user, inviteUrl } : user;
  });
});
adminRouter.post("/users", saveUser);
adminRouter.put("/users/:id", saveUser);

// ---------- Settings ----------
function encrypt(secret: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(config.settingsKey)) throw new ApiError(500, "no_settings_key", "SETTINGS_KEY must be set on the server to store secrets");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(config.settingsKey, "hex"), iv);
  const enc = Buffer.concat([c.update(secret, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}

async function getSettings(conn: Parameters<typeof rows>[0], orgId: string): Promise<OrgSettings> {
  const r = await one(conn, "SELECT body, gsp_secret_enc FROM org_settings WHERE org_id = ?", [orgId]);
  if (!r) throw new ApiError(404, "not_found", "Settings not set up");
  const b = parse(r["body"]) as OrgSettings;
  return { ...b, gsp: { ...b.gsp, secretSet: !!r["gsp_secret_enc"] } };
}

adminRouter.get("/settings", h((req) => read(req, (u) => getSettings(u.conn, u.ctx.orgId))));

adminRouter.put("/settings", h(async (req) => {
  requirePerm(req.ctx, "settings", "Only the Owner can change settings");
  const input = z.object({
    legalName: z.string().min(1), tradeName: z.string(), gstin: z.string(), pan: z.string(), address: z.string(), stateCode: z.string(), phone: z.string(), email: z.string(),
    bankName: z.string(), bankAccount: z.string(), ifsc: z.string(), invoiceTerms: z.string(), jurisdiction: z.string(),
    fyName: z.string(), fyStart: z.string(), fyEnd: z.string(), fyStatus: z.enum(["open", "closed"]),
    composition: z.boolean(), ewbThreshold: z.number(), einvoiceThreshold: z.number().min(0), roundOff: z.enum(["nearest_rupee", "none"]), adjApprovalLimit: z.number().min(0, "Approval limit can't be negative"),
    reasonCodes: z.array(z.object({ id: z.string(), type: z.enum(["adjustment", "return", "override", "cancellation"]), code: z.string(), label: z.string(), active: z.boolean() })),
    gsp: z.object({ provider: z.string(), username: z.string(), clientId: z.string(), sandbox: z.boolean(), secret: z.string().optional() }),
  }).parse(req.body);
  const errors = settingsProblems(input as import("../shared/types.js").OrgSettingsInput);
  if (errors.length) throw new ApiError(422, "invalid", errors[0]!);
  const codes = input.reasonCodes.map((r) => ({ ...r, code: r.code.trim().toUpperCase(), label: r.label.trim() }));
  const { secret, ...gsp } = input.gsp;
  const stateCode = stateFromGstin(input.gstin);
  const body = { ...input, stateCode, ewbThreshold: 50000, reasonCodes: codes, gsp }; // EWB threshold is fixed by law
  return withTransaction(async (conn) => {
    const current = await one(conn, "SELECT gstin FROM orgs WHERE id = ? FOR UPDATE", [req.ctx.orgId]);
    if (!current) throw new ApiError(404, "not_found", "Organisation not found");
    if (current["gstin"] !== input.gstin.toUpperCase()) {
      const issued = await one(conn, "SELECT id FROM invoices WHERE org_id = ? AND number IS NOT NULL LIMIT 1", [req.ctx.orgId]);
      if (issued) throw new ApiError(409, "gstin_locked", "Cannot change GSTIN after issuing invoices. Consult your accountant for a new registration.");
    }
    await exec(conn, "UPDATE org_settings SET body = ? WHERE org_id = ?", [JSON.stringify(body), req.ctx.orgId]);
    if (secret) await exec(conn, "UPDATE org_settings SET gsp_secret_enc = ? WHERE org_id = ?", [encrypt(secret), req.ctx.orgId]);
    await exec(conn, "UPDATE orgs SET name = ?, gstin = ?, state_code = ?, state_name = ? WHERE id = ?", [input.legalName, input.gstin.toUpperCase(), stateCode, stateName(stateCode), req.ctx.orgId]);
    return getSettings(conn, req.ctx.orgId);
  });
}));

// ---------- Numbering ----------
const LABELS: Record<DocType, string> = { SO: "Sales order", DC: "Delivery challan", INV: "Tax invoice", RCT: "Receipt", PO: "Purchase order", GRN: "Goods receipt", TRF: "Stock transfer", ADJ: "Stock adjustment" };
async function listSeries(conn: Parameters<typeof rows>[0], orgId: string): Promise<NumberSeries[]> {
  const fy = (await import("../shared/numbering.js")).fyLabel(today());
  const ss = await rows(conn, "SELECT * FROM doc_series WHERE org_id = ?", [orgId]);
  const cs = await rows(conn, "SELECT doc_type, fy, last_number FROM doc_counters WHERE org_id = ?", [orgId]);
  return (Object.keys(LABELS) as DocType[]).flatMap((t) => {
    const s = ss.find((x) => x["doc_type"] === t);
    if (!s) return [];
    const last = Number(cs.find((c) => c["doc_type"] === t && c["fy"] === (s["reset_per_fy"] ? fy : "ALL"))?.["last_number"] ?? 0);
    const everIssued = cs.some((c) => c["doc_type"] === t && Number(c["last_number"]) > 0);
    return [{ docType: t, label: LABELS[t], prefix: s["prefix"], fy, lastNumber: last, padding: Number(s["padding"]), resetPerFy: !!s["reset_per_fy"], locked: everIssued }];
  });
}
adminRouter.get("/settings/numbering", h((req) => { requirePerm(req.ctx, "settings", "Only the Owner can manage numbering"); return read(req, (u) => listSeries(u.conn, u.ctx.orgId)); }));
adminRouter.put("/settings/numbering/:docType", h(async (req) => {
  requirePerm(req.ctx, "settings", "Only the Owner can change numbering");
  const input = z.object({ prefix: z.string().trim().toUpperCase(), padding: z.number().int(), resetPerFy: z.boolean() }).strict().parse(req.body);
  const docType = z.enum(Object.keys(LABELS) as [DocType, ...DocType[]]).parse(req.params["docType"]);
  return withTransaction(async (conn) => {
    // Serialise series edits with Uow.next, which locks the same series row first.
    const row = await one(conn, "SELECT * FROM doc_series WHERE org_id = ? AND doc_type = ? FOR UPDATE", [req.ctx.orgId, docType]);
    if (!row) throw new ApiError(404, "not_found", "Series not found");
    const used = await one(conn, "SELECT MAX(last_number) AS last_number FROM doc_counters WHERE org_id = ? AND doc_type = ?", [req.ctx.orgId, docType]);
    const problems = seriesProblems({ docType, ...input }, {
      prefix: row["prefix"], padding: Number(row["padding"]), resetPerFy: !!row["reset_per_fy"],
      lastNumber: Number(used?.["last_number"] ?? 0),
    });
    if (problems.length) throw new ApiError(422, "invalid", problems[0]!);
    await exec(conn, "UPDATE doc_series SET prefix = ?, padding = ?, reset_per_fy = ? WHERE org_id = ? AND doc_type = ?", [input.prefix, input.padding, +input.resetPerFy, req.ctx.orgId, docType]);
    return (await listSeries(conn, req.ctx.orgId)).find((s) => s.docType === docType);
  });
}));

// ---------- Print profiles ----------
adminRouter.get("/print-profiles", h((req) => read(req, async (u) => (await rows(u.conn, "SELECT body FROM print_profiles WHERE org_id = ? ORDER BY id", [u.ctx.orgId])).map((r) => parse(r["body"]) as PrintProfile))));
adminRouter.put("/print-profiles/:id", h(async (req) => {
  requirePerm(req.ctx, "printProfiles", "Only Owner or Manager can change print profiles");
  const id = z.enum(["A", "B"]).parse(req.params["id"]);
  const input = z.object({
    id: z.enum(["A", "B"]), name: z.string(), paper: z.enum(["80mm", "A4"]),
    showLogo: z.boolean(), showBank: z.boolean(), showHsnSummary: z.boolean(),
    showSignature: z.boolean(), showQr: z.boolean(), copies: z.number(), footer: z.string(),
  }).strict().parse(req.body);
  const problems = printProfileProblems(input, id);
  if (problems.length) throw new ApiError(422, "invalid", problems[0]!);
  return withTransaction(async (conn) => {
    const existing = await one(conn, "SELECT id FROM print_profiles WHERE org_id = ? AND id = ? FOR UPDATE", [req.ctx.orgId, id]);
    if (!existing) throw new ApiError(404, "not_found", "Print profile not found");
    const saved = normalisePrintProfile(input);
    await exec(conn, "UPDATE print_profiles SET body = ? WHERE org_id = ? AND id = ?", [JSON.stringify(saved), req.ctx.orgId, id]);
    return saved;
  });
}));

// ---------- Search ----------
adminRouter.get("/search", h((req) => read(req, async (u) => {
  const docs: DocHit[] = [
    ...(await u.docs_("salesOrders", "number IS NOT NULL")).map((o) => ({ type: "SO" as const, id: o.id, number: o.number!, date: o.date, party: o.customerName, amount: o.grandTotal, status: o.status })),
    ...(await u.docs_("challans")).map((c) => ({ type: "DC" as const, id: c.id, number: c.number, date: c.date, party: c.customerName, amount: c.value, status: c.status })),
    ...(await u.docs_("invoices")).map(refreshInvoice).map((i) => ({ type: "INV" as const, id: i.id, number: i.number, date: i.date, party: i.customerName, amount: i.grandTotal, status: i.status })),
    ...(await u.docs_("receipts")).map((r) => ({ type: "RCT" as const, id: r.id, number: r.number, date: r.date, party: r.customerName, amount: r.amount, status: r.advance > 0 ? "advance" : "allocated" })),
  ];
  const num = (v: unknown) => (typeof v === "string" && v !== "" ? Number(v) : undefined);
  return filterDocs(docs, {
    q: str(req.query["q"]), types: str(req.query["docTypes"])?.split(",") as SearchDocType[] | undefined, status: str(req.query["status"]),
    period: str(req.query["datePreset"]) as never, min: num(req.query["min"]), max: num(req.query["max"]),
  }, today()).slice(0, 500);
})));

// ---------- Reports ----------
adminRouter.use("/reports", (req, _res, next) => {
  try { requirePerm(req.ctx, "reports", "Your role cannot open reports"); next(); } catch (e) { next(e); }
});
const range = (req: { query: Record<string, unknown> }) => {
  const from = str(req.query["from"]) ?? "";
  const to = str(req.query["to"]) ?? "";
  if (!validReportRange(from, to)) throw new ApiError(422, "bad_report_range", "Select valid From and To dates with From no later than To");
  return [from, to] as const;
};
adminRouter.get("/reports/sales-register", h((req) => read(req, async (u) => {
  const [from, to] = range(req);
  return salesRegister((await u.docs_("invoices", "doc_date BETWEEN ? AND ?", [from, to])).map(refreshInvoice));
})));
adminRouter.get("/reports/receivables", h((req) => read(req, async (u) => receivables((await u.docs_("invoices", "status <> 'cancelled'")).map(refreshInvoice), today()))));
adminRouter.get("/reports/item-sales", h((req) => read(req, async (u) => {
  const [from, to] = range(req);
  const items = await loadItems(u.conn, u.ctx.orgId);
  return itemSales((await u.docs_("invoices", "doc_date BETWEEN ? AND ?", [from, to])).map(refreshInvoice), (id) => items.find((i) => i.id === id)?.costPrice ?? 0);
})));
adminRouter.get("/reports/gstr1", h((req) => read(req, async (u) => {
  const period = z.string().refine(validReportMonth, "Period must be a valid month in YYYY-MM format").parse(req.query["period"]);
  return buildGstr1((await u.docs_("invoices", "DATE_FORMAT(doc_date, '%Y-%m') = ?", [period])).map(refreshInvoice), period, u.ctx.orgGstin);
})));
