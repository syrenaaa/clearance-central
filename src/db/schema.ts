/** tables + indexes, created idempotently */

import text from "./schema.sql" with { type: "text" };
import { type Sql, statements, stmt } from "./sql.ts";

const SCHEMA = statements(text).map((q) => stmt(q));

export const migrate = async (sql: Sql): Promise<void> => {
  await sql.batch(SCHEMA, "write");
};
