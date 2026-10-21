/**
 * sql handle + query file loading. each db fn does at most 1 round trip (one stmt
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

/** a query with `:name` params compiled to `?` (libsql-wasm can't bind names) */
export type Query = { readonly sql: string; readonly names: readonly string[] };
/** named args, `:key` in the sql */
export type Args = Readonly<Record<string, SqlValue>>;

// quoted text + comments are matched first so their `:` is left alone
const TOKEN = /'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|:(\w+)/g;

export const compile = (src: string): Query => {
  const names: string[] = [];
  const sql = src.replace(TOKEN, (m, name?: string) => {
    if (name === undefined) return m;
    names.push(name);
    return "?";
  });
  return { sql, names };
};

/** bind args by name. a missing one is a bug, so it throws */
export const stmt = (q: Query, args: Args = {}): Statement => ({
  sql: q.sql,
  args: q.names.map((n) => {
    const v = args[n];
    if (v === undefined) throw new Error(`missing arg :${n}`);
    return v;
  }),
});

const NAME = /^-- name: (\w+)[ \t]*$/m;

/** `-- name: x` sections of a .sql file. throws at load if one of `names` is missing */
export const queries = <K extends string>(text: string, names: readonly K[]): Record<K, Query> => {
  const parts = text.split(NAME).slice(1);
  const out: Record<string, Query> = {};
  for (let i = 0; i < parts.length; i += 2) out[parts[i]!] = compile(parts[i + 1]!.trim());
  const miss = names.find((n) => !(n in out));
  if (miss !== undefined) throw new Error(`missing query: ${miss}`);
  return out as Record<K, Query>;
};

/** `;`-separated statements, comment-only chunks dropped */
export const statements = (text: string): Query[] =>
  text.split(/;[ \t]*$/m)
    .map((s) => s.trim())
    .filter((s) => s.replace(/^--.*$/gm, "").trim() !== "")
    .map(compile);
