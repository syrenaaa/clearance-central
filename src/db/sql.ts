/**
 * sql handle + statement helpers. each db fn does at most 1 round trip (one stmt
 * or one batch), since on val town every call is an http request. db failures
 * throw -> 500 at the edge, so the plugin retries
 */

export type SqlValue = string | number | null;
export type Statement = { readonly sql: string; readonly args: SqlValue[] };
export type Rows = {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowsAffected: number;
};

/** subset of the libsql client; val town's std/sqlite fits */
export interface Sql {
  execute(st: Statement): Promise<Rows>;
  batch(stmts: Statement[], mode: "read" | "write"): Promise<Rows[]>;
}

export const stmt = (sql: string, ...args: SqlValue[]): Statement => ({ sql, args });
