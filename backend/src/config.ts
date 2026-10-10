import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return v;
}

const mailDeliveryMode = process.env["MAIL_DELIVERY_MODE"] ?? "smtp";
if (!["smtp", "console"].includes(mailDeliveryMode)) throw new Error("MAIL_DELIVERY_MODE must be smtp or console");

export const config = {
  port: Number(process.env["PORT"] ?? 4000),
  host: process.env["API_HOST"] ?? "0.0.0.0",
  databaseUrl: req("DATABASE_URL"),
  dbSsl: (process.env["DB_SSL"] ?? "true") !== "false",
  dbSslCaPath: process.env["DB_SSL_CA_PATH"] || undefined,
  jwtSecret: req("JWT_SECRET"),
  jwtExpiresIn: process.env["JWT_EXPIRES_IN"] ?? "12h",
  settingsKey: process.env["SETTINGS_KEY"] ?? "",
  setupRegistrationToken: process.env["SETUP_REGISTRATION_TOKEN"] ?? "",
  corsOrigins: (process.env["CORS_ORIGINS"] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  appUrl: process.env["APP_URL"] ?? "http://localhost:8080",
  mailDeliveryMode,
  smtpHost: process.env["SMTP_HOST"] || undefined,
  smtpPort: Number(process.env["SMTP_PORT"] ?? 587),
  smtpSecurity: process.env["SMTP_SECURITY"] ?? "starttls",
  smtpUser: process.env["SMTP_USER"] || undefined,
  smtpPassword: process.env["SMTP_PASSWORD"] || undefined,
  smtpFrom: process.env["SMTP_FROM"] || undefined,
};

/** Business "today" in India (UTC+5:30), as YYYY-MM-DD. */
export function today(): string {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
}
export const nowIso = () => new Date().toISOString();
