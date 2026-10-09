import { readFileSync } from "node:fs";
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { config } from "./config.js";

function sslOptions() {
  if (!config.dbSsl) return undefined;
  return config.dbSslCaPath ? { ca: readFileSync(config.dbSslCaPath, "utf8") } : { rejectUnauthorized: true };
}

const url = new URL(config.databaseUrl);
url.searchParams.delete("ssl-mode"); // Aiven-style flag; SSL is configured below instead

export const pool: Pool = mysql.createPool({
  uri: url.toString(),
  ssl: sslOptions(),
  connectionLimit: 10,
  decimalNumbers: true, // DECIMAL → number (values stay within 15 significant digits)
  dateStrings: true, // DATE/DATETIME → string, no timezone shifts
  timezone: "Z",
  multipleStatements: false,
});

export type Conn = PoolConnection;
export type Row = RowDataPacket & Record<string, any>;

export async function rows<T = Row>(conn: Conn | Pool, sql: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await conn.query<RowDataPacket[]>(sql, params);
  return r as unknown as T[];
}

export async function one<T = Row>(conn: Conn | Pool, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(conn, sql, params))[0];
}

export async function exec(conn: Conn | Pool, sql: string, params: unknown[] = []) {
  await conn.query(sql, params);
}

/** Runs fn inside a transaction; rolls back on any error. */
export async function withTransaction<T>(fn: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function withConnection<T>(fn: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

export const bool = (v: unknown) => v === 1 || v === true || v === "1";
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
