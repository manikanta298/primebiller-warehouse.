interface MigrationConnection {
  query(sql: string): Promise<unknown>;
  release(): void;
}
interface MigrationPool {
  getConnection(): Promise<MigrationConnection>;
}

export function schemaStatements(sql: string): string[] {
  return sql.split("\n").filter(line => !line.trim().startsWith("--")).join("\n")
    .split(/;\s*(?:\n|$)/).map(statement => statement.trim()).filter(Boolean);
}

/** Session variables and PREPARE/EXECUTE must run on the same connection. */
export async function applySchema(sql: string, pool: MigrationPool): Promise<number> {
  const statements = schemaStatements(sql);
  const connection = await pool.getConnection();
  try {
    for (let index = 0; index < statements.length; index++) {
      try { await connection.query(statements[index]!); }
      catch (cause) { throw new Error(`Schema statement ${index + 1} failed; subsequent statements were not run`, { cause }); }
    }
    return statements.length;
  } finally { connection.release(); }
}
