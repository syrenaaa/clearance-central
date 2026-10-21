/** tables + indexes, created idempotently, then pending migrations */

import migrations from "./migrations.sql" with { type: "text" };
import text from "./schema.sql" with { type: "text" };
import { compile, queries, type Sql, statements, stmt } from "./sql.ts";

const SCHEMA = statements(text).map((q) => stmt(q));
const APPLIED = compile("SELECT name FROM migrations");
const MARK = compile("INSERT INTO migrations (name) VALUES (:name)");
const STEPS = Object.entries(queries(migrations, ["m001_ban_expiry"])).sort(([a], [b]) =>
  a < b ? -1 : 1
);

/** each step + its mark is one tx. a racing isolate fails on the pk, the next request retries */
export const migrate = async (sql: Sql): Promise<void> => {
  const res = await sql.batch([...SCHEMA, stmt(APPLIED)], "write");
  const done = new Set(res.at(-1)!.rows.map((r) => String(r.name)));
  for (const [name, q] of STEPS) {
    if (!done.has(name)) await sql.batch([stmt(MARK, { name }), stmt(q)], "write");
  }
};
