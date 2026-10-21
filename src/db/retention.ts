/** retention purge, run by cron.ts */

import type { UnixTime } from "../types.ts";
import { type Sql, stmt } from "./sql.ts";

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
