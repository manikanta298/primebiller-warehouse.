/** Creates any missing Girder tables from db/schema.sql. Never drops or changes existing data. */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { pool } from "../src/db.js";

const sql = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .split(/;\s*(?:\n|$)/)
  .map((s) => s.trim())
  .filter(Boolean);

for (const s of statements) await pool.query(s);
console.log(`Applied ${statements.length} statements.`);
await pool.end();
