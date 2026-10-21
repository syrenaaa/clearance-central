/** daily aggregates, one row per non-zero counter */

import type { DailyStats, Day, ServerId, UnixTime } from "../types.ts";
import { CHECK_OUTCOMES } from "../types.ts";
import { type Sql, stmt } from "./sql.ts";

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
