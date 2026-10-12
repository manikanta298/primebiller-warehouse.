/** Creates any missing Girder tables from db/schema.sql. Never drops or changes existing data. */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { pool } from "../src/db.js";
import { applySchema } from "../src/schema-migration.js";

const sql = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
try {
  const count = await applySchema(sql, pool);
  console.log(`Applied ${count} statements.`);
} finally { await pool.end(); }
