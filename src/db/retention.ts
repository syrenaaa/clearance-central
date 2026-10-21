/** retention purge, run by cron.ts */

import { utcDay } from "../limits.ts";
import type { UnixTime } from "../types.ts";
import text from "./retention.sql" with { type: "text" };
import { queries, type Sql, stmt } from "./sql.ts";

const Q = queries(text, [
  "drop_pardons",
  "drop_bans",
  "drop_stats_counts",
  "drop_stats_days",
  "drop_claims",
]);

/** delete bans + stats days older than `before` (+ pardons of those bans) and expired claims */
export const purge = async (sql: Sql, before: UnixTime, now: UnixTime): Promise<void> => {
  await sql.batch([
    stmt(Q.drop_pardons, { before }),
    stmt(Q.drop_bans, { before }),
    stmt(Q.drop_stats_counts, { beforeDay: utcDay(before) }),
    stmt(Q.drop_stats_days, { beforeDay: utcDay(before) }),
    stmt(Q.drop_claims, { now }),
  ], "write");
};
