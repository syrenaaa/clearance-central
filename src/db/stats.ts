/** daily aggregates, one row per non-zero counter */

import type { DailyStats, Day, ServerId, UnixTime } from "../types.ts";
import { CHECK_OUTCOMES } from "../types.ts";
import { queries, type Sql, stmt } from "./sql.ts";
import text from "./stats.sql" with { type: "text" };

const Q = queries(text, [
  "clear_counts",
  "clear_day",
  "insert_day",
  "insert_count",
  "count_servers",
  "sum_counts",
]);

export type Metric = "check" | "score" | "ban";
export type CountRow = {
  readonly metric: Metric;
  readonly key: string;
  readonly n: number;
};

const countRows = (s: DailyStats): CountRow[] =>
  [
    ...CHECK_OUTCOMES.map((k) => ({ metric: "check" as const, key: k, n: s.checks[k] ?? 0 })),
    ...Object.entries(s.scores).map(([k, n]) => ({ metric: "score" as const, key: k, n })),
    ...Object.entries(s.bansByJoinScore).map(([k, n]) => ({ metric: "ban" as const, key: k, n })),
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
    stmt(Q.clear_counts, { serverId, day }),
    stmt(Q.clear_day, { serverId, day }),
  ];
  if (stats === undefined) {
    await sql.batch(clear, "write");
    return;
  }
  await sql.batch([
    ...clear,
    stmt(Q.insert_day, {
      serverId,
      day,
      pluginVersion: stats.pluginVersion,
      enforce: stats.enforce ? 1 : 0,
      allowScore: stats.thresholds.allowScore,
      flagScore: stats.thresholds.flagScore,
      now,
    }),
    ...countRows(stats).map((c) => stmt(Q.insert_count, { serverId, day, ...c })),
  ], "write");
};

export type NetworkRows = {
  readonly servers: number;
  readonly counts: readonly CountRow[];
};

/** sums over live servers, `from`..`to` inclusive */
export const sumStats = async (sql: Sql, from: Day, to: Day): Promise<NetworkRows> => {
  const [servers, counts] = await sql.batch([
    stmt(Q.count_servers, { from, to }),
    stmt(Q.sum_counts, { from, to }),
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
