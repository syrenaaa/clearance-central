/** rows -> api responses. facts only, never verdicts */

import type { ActiveBan, NetworkRows } from "./db/mod.ts";
import type { CheckCounts, Day, UnixTime, UserId } from "./types.ts";

type Buckets = Record<string, number>;

export type NetworkStats = {
  readonly from: Day;
  readonly to: Day;
  readonly servers: number;
  readonly checks: CheckCounts;
  readonly scores: Buckets;
  readonly bansByJoinScore: Buckets;
  readonly banRateByScore: Buckets;
};

const pick = (rows: NetworkRows, metric: string): Buckets =>
  Object.fromEntries(
    rows.counts.filter((r) => r.metric === metric).map((r) => [r.key, r.n]),
  );

/** bans / scored checks per bucket, skipping empty buckets */
export const banRates = (scores: Buckets, bans: Buckets): Buckets =>
  Object.fromEntries(
    Object.entries(scores)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => [k, (bans[k] ?? 0) / n]),
  );

export const networkStats = (
  from: Day,
  to: Day,
  rows: NetworkRows,
): NetworkStats => {
  const scores = pick(rows, "score");
  const bansByJoinScore = pick(rows, "ban");
  return {
    from,
    to,
    servers: rows.servers,
    checks: pick(rows, "check"),
    scores,
    bansByJoinScore,
    banRateByScore: banRates(scores, bansByJoinScore),
  };
};

export type PlayerFacts = {
  readonly userId: UserId;
  readonly distinctServers: number;
  readonly activeBans: number;
  readonly lastBan: null | {
    readonly at: UnixTime;
    readonly severity: number;
    readonly category: string;
  };
};

/** `bans` newest first, as `activeBans` returns them */
export const playerFacts = (
  userId: UserId,
  bans: readonly ActiveBan[],
): PlayerFacts => {
  const last = bans[0];
  return {
    userId,
    distinctServers: new Set(bans.map((b) => b.serverId)).size,
    activeBans: bans.length,
    lastBan: last === undefined
      ? null
      : { at: last.at, severity: last.severity, category: last.category },
  };
};
