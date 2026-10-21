/**
 * storage. each fn does at most 1 round trip (one stmt or one batch), since on
 * val town every call is an http request. db failures throw -> 500 at the edge,
 * so the plugin retries
 */

import type {
  BanReport,
  DailyStats,
  Day,
  PardonReport,
  ReportId,
  Server,
  ServerAddress,
  ServerId,
  UnixTime,
  UserId,
} from "./types.ts";
import { CHECK_OUTCOMES } from "./types.ts";

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

const stmt = (sql: string, ...args: SqlValue[]): Statement => ({ sql, args });

// schema

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    address TEXT NOT NULL,
    port INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  )`,
  // one live listing per address; re-verifying rotates its key
  `CREATE UNIQUE INDEX IF NOT EXISTS servers_live_address
    ON servers (address, port) WHERE revoked_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS claims (
    id_hash TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    address TEXT NOT NULL,
    port INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS claims_address ON claims (address, port)`,
  `CREATE TABLE IF NOT EXISTS stats_days (
    server_id TEXT NOT NULL,
    day TEXT NOT NULL,
    plugin_version TEXT NOT NULL,
    enforce INTEGER NOT NULL,
    allow_score INTEGER NOT NULL,
    flag_score INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY (server_id, day)
  )`,
  // one row per non-zero counter, so network sums are one GROUP BY
  `CREATE TABLE IF NOT EXISTS stats_counts (
    server_id TEXT NOT NULL,
    day TEXT NOT NULL,
    metric TEXT NOT NULL CHECK (metric IN ('check', 'score', 'ban')),
    key TEXT NOT NULL,
    n INTEGER NOT NULL,
    PRIMARY KEY (server_id, day, metric, key)
  )`,
  `CREATE INDEX IF NOT EXISTS stats_counts_day ON stats_counts (day)`,
  `CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('ban', 'pardon')),
    client_ref TEXT NOT NULL,
    user_id TEXT,
    severity INTEGER,
    category TEXT,
    target_id TEXT,
    at INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    UNIQUE (server_id, kind, client_ref),
    CHECK (
      (kind = 'ban' AND user_id IS NOT NULL AND severity IS NOT NULL
        AND category IS NOT NULL AND target_id IS NULL)
      OR (kind = 'pardon' AND target_id IS NOT NULL AND user_id IS NULL
        AND severity IS NULL AND category IS NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS reports_ban_user
    ON reports (user_id, at) WHERE kind = 'ban'`,
  `CREATE INDEX IF NOT EXISTS reports_pardon_target
    ON reports (target_id) WHERE kind = 'pardon'`,
];

export const migrate = async (sql: Sql): Promise<void> => {
  await sql.batch(SCHEMA.map((s) => stmt(s)), "write");
};

// servers

export const findServerByKeyHash = async (
  sql: Sql,
  keyHash: string,
): Promise<Server | undefined> => {
  const { rows } = await sql.execute(
    stmt(
      "SELECT id FROM servers WHERE key_hash = ? AND revoked_at IS NULL",
      keyHash,
    ),
  );
  const row = rows[0];
  return row === undefined ? undefined : { id: String(row.id) as ServerId };
};

/** new server, or re-key the live one at the same address */
const upsertServer = (
  newId: ServerId,
  keyHash: string,
  { address, port }: ServerAddress,
  now: UnixTime,
) =>
  stmt(
    `INSERT INTO servers (id, key_hash, address, port, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (address, port) WHERE revoked_at IS NULL
      DO UPDATE SET key_hash = excluded.key_hash
      RETURNING id`,
    newId,
    keyHash,
    address,
    port,
    now,
  );

/** id of the server that now has `keyHash` */
export const upsertServerKey = async (
  sql: Sql,
  newId: ServerId,
  keyHash: string,
  address: ServerAddress,
  now: UnixTime,
): Promise<ServerId> => {
  const { rows } = await sql.execute(upsertServer(newId, keyHash, address, now));
  return String(rows[0]!.id) as ServerId;
};

/** false if no live server had that id */
export const revokeServer = async (
  sql: Sql,
  id: ServerId,
  now: UnixTime,
): Promise<boolean> => {
  const { rowsAffected } = await sql.execute(stmt(
    "UPDATE servers SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    now,
    id,
  ));
  return rowsAffected > 0;
};

// claims

export type ClaimLimits = { readonly perAddress: number; readonly total: number };

export type StoredClaim = ServerAddress & { readonly token: string };

/** false when a limit is hit. expired claims don't count */
export const insertClaim = async (
  sql: Sql,
  idHash: string,
  claim: StoredClaim,
  expiresAt: UnixTime,
  now: UnixTime,
  limits: ClaimLimits,
): Promise<boolean> => {
  const [, inserted] = await sql.batch([
    stmt("DELETE FROM claims WHERE expires_at <= ?", now),
    stmt(
      `INSERT INTO claims (id_hash, token, address, port, expires_at)
        SELECT ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM claims WHERE address = ? AND port = ?) < ?
          AND (SELECT COUNT(*) FROM claims) < ?`,
      idHash,
      claim.token,
      claim.address,
      claim.port,
      expiresAt,
      claim.address,
      claim.port,
      limits.perAddress,
      limits.total,
    ),
  ], "write");
  return inserted!.rowsAffected > 0;
};

export const findClaim = async (
  sql: Sql,
  idHash: string,
  now: UnixTime,
): Promise<StoredClaim | undefined> => {
  const { rows } = await sql.execute(stmt(
    "SELECT token, address, port FROM claims WHERE id_hash = ? AND expires_at > ?",
    idHash,
    now,
  ));
  const row = rows[0];
  return row === undefined ? undefined : {
    token: String(row.token),
    address: String(row.address),
    port: Number(row.port),
  };
};

/** atomically drop the claim + register/re-key the server */
export const completeClaim = async (
  sql: Sql,
  idHash: string,
  newId: ServerId,
  keyHash: string,
  address: ServerAddress,
  now: UnixTime,
): Promise<ServerId> => {
  const [, upserted] = await sql.batch([
    stmt("DELETE FROM claims WHERE id_hash = ?", idHash),
    upsertServer(newId, keyHash, address, now),
  ], "write");
  return String(upserted!.rows[0]!.id) as ServerId;
};

// stats

export type Metric = "check" | "score" | "ban";
export type CountRow = {
  readonly metric: Metric;
  readonly key: string;
  readonly n: number;
};

const countRows = (stats: DailyStats): CountRow[] =>
  [
    ...CHECK_OUTCOMES.map((k) => ({
      metric: "check" as const,
      key: k,
      n: stats.checks[k] ?? 0,
    })),
    ...Object.entries(stats.scores).map(([k, n]) => ({
      metric: "score" as const,
      key: k,
      n,
    })),
    ...Object.entries(stats.bansByJoinScore).map(([k, n]) => ({
      metric: "ban" as const,
      key: k,
      n,
    })),
  ].filter((r) => r.n > 0);

/** replace one server's day. undefined `stats` just clears it (below anonymity threshold) */
export const replaceStatsDay = async (
  sql: Sql,
  serverId: ServerId,
  day: Day,
  stats: DailyStats | undefined,
  now: UnixTime,
): Promise<void> => {
  const clear = [
    stmt(
      "DELETE FROM stats_counts WHERE server_id = ? AND day = ?",
      serverId,
      day,
    ),
    stmt("DELETE FROM stats_days WHERE server_id = ? AND day = ?", serverId, day),
  ];
  if (stats === undefined) {
    await sql.batch(clear, "write");
    return;
  }
  const counts = countRows(stats);
  await sql.batch([
    ...clear,
    stmt(
      `INSERT INTO stats_days
        (server_id, day, plugin_version, enforce, allow_score, flag_score, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      serverId,
      day,
      stats.pluginVersion,
      stats.enforce ? 1 : 0,
      stats.thresholds.allowScore,
      stats.thresholds.flagScore,
      now,
    ),
    ...(counts.length === 0 ? [] : [{
      sql: `INSERT INTO stats_counts (server_id, day, metric, key, n) VALUES ${
        counts.map(() => "(?, ?, ?, ?, ?)").join(", ")
      }`,
      args: counts.flatMap((c) => [serverId, day, c.metric, c.key, c.n]),
    }]),
  ], "write");
};

export type NetworkRows = {
  readonly servers: number;
  readonly counts: readonly CountRow[];
};

/** sums over live servers, `from`..`to` inclusive */
export const sumStats = async (
  sql: Sql,
  from: Day,
  to: Day,
): Promise<NetworkRows> => {
  const [servers, counts] = await sql.batch([
    stmt(
      `SELECT COUNT(DISTINCT d.server_id) AS servers
        FROM stats_days d JOIN servers s ON s.id = d.server_id
        WHERE s.revoked_at IS NULL AND d.day BETWEEN ? AND ?`,
      from,
      to,
    ),
    stmt(
      `SELECT c.metric, c.key, SUM(c.n) AS n
        FROM stats_counts c JOIN servers s ON s.id = c.server_id
        WHERE s.revoked_at IS NULL AND c.day BETWEEN ? AND ?
        GROUP BY c.metric, c.key`,
      from,
      to,
    ),
  ], "read");
  return {
    servers: Number(servers!.rows[0]?.servers ?? 0),
    counts: counts!.rows.map((r) => ({
      metric: String(r.metric) as Metric,
      key: String(r.key),
      n: Number(r.n),
    })),
  };
};

// reports

export type StoredReport = {
  readonly reportId: ReportId;
  readonly kind: "ban" | "pardon";
  readonly receivedAt: UnixTime;
};

const toStoredReport = (row: Record<string, unknown>): StoredReport => ({
  reportId: String(row.id) as ReportId,
  kind: row.kind === "pardon" ? "pardon" : "ban",
  receivedAt: Number(row.received_at) as UnixTime,
});

const selectByClientRef = (
  serverId: ServerId,
  kind: "ban" | "pardon",
  clientRef: string,
) =>
  stmt(
    `SELECT id, kind, received_at FROM reports
      WHERE server_id = ? AND kind = ? AND client_ref = ?`,
    serverId,
    kind,
    clientRef,
  );

/** insert a ban, or return this server's existing one with the same clientRef */
export const insertBan = async (
  sql: Sql,
  newId: ReportId,
  serverId: ServerId,
  ban: BanReport,
  now: UnixTime,
): Promise<StoredReport> => {
  const [, existing] = await sql.batch([
    stmt(
      `INSERT INTO reports
        (id, server_id, kind, client_ref, user_id, severity, category, at, received_at)
        VALUES (?, ?, 'ban', ?, ?, ?, ?, ?, ?)
        ON CONFLICT (server_id, kind, client_ref) DO NOTHING`,
      newId,
      serverId,
      ban.clientRef,
      ban.userId,
      ban.severity,
      ban.category,
      ban.at,
      now,
    ),
    selectByClientRef(serverId, "ban", ban.clientRef),
  ], "write");
  return toStoredReport(existing!.rows[0]!);
};

/** pardon one of this server's bans (or return the existing one by clientRef). undefined if no such ban */
export const insertPardon = async (
  sql: Sql,
  newId: ReportId,
  serverId: ServerId,
  pardon: PardonReport,
  now: UnixTime,
): Promise<StoredReport | undefined> => {
  const [, existing] = await sql.batch([
    stmt(
      `INSERT INTO reports (id, server_id, kind, client_ref, target_id, at, received_at)
        SELECT ?, ?, 'pardon', ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM reports WHERE id = ? AND server_id = ? AND kind = 'ban'
        )
        ON CONFLICT (server_id, kind, client_ref) DO NOTHING`,
      newId,
      serverId,
      pardon.clientRef,
      pardon.reportId,
      pardon.at,
      now,
      pardon.reportId,
      serverId,
    ),
    selectByClientRef(serverId, "pardon", pardon.clientRef),
  ], "write");
  const row = existing!.rows[0];
  return row === undefined ? undefined : toStoredReport(row);
};

export type ActiveBan = {
  readonly serverId: ServerId;
  readonly at: UnixTime;
  readonly severity: number;
  readonly category: string;
};

/** unpardoned bans from live servers since `since`, newest first */
export const activeBans = async (
  sql: Sql,
  userId: UserId,
  since: UnixTime,
): Promise<ActiveBan[]> => {
  const { rows } = await sql.execute(stmt(
    `SELECT r.server_id, r.at, r.severity, r.category
      FROM reports r JOIN servers s ON s.id = r.server_id
      WHERE r.kind = 'ban' AND r.user_id = ? AND r.at >= ?
        AND s.revoked_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM reports p WHERE p.kind = 'pardon' AND p.target_id = r.id
        )
      ORDER BY r.at DESC
      LIMIT 1000`,
    userId,
    since,
  ));
  return rows.map((r) => ({
    serverId: String(r.server_id) as ServerId,
    at: Number(r.at) as UnixTime,
    severity: Number(r.severity),
    category: String(r.category),
  }));
};

// retention

/** delete bans older than `before` (+ their pardons) and expired claims */
export const purge = async (
  sql: Sql,
  before: UnixTime,
  now: UnixTime,
): Promise<void> => {
  await sql.batch([
    stmt(
      `DELETE FROM reports WHERE kind = 'pardon' AND target_id IN (
        SELECT id FROM reports WHERE kind = 'ban' AND at < ?
      )`,
      before,
    ),
    stmt("DELETE FROM reports WHERE kind = 'ban' AND at < ?", before),
    stmt("DELETE FROM claims WHERE expires_at <= ?", now),
  ], "write");
};
