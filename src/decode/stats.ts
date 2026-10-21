/** `PUT /v1/stats/{day}` body */

import { ok } from "../result.ts";
import {
  CHECK_OUTCOMES,
  type CheckCounts,
  type CheckOutcome,
  type DailyStats,
  SCORE_BUCKETS,
  type ScoreBuckets,
} from "../types.ts";
import {
  boolean,
  type Decoder,
  fail,
  integer,
  isRecord,
  join,
  strictObject,
  string,
} from "./core.ts";

/** cap well below 2^53 so network sums stay exact */
const MAX_COUNT = 1_000_000_000;

const count = integer(0, MAX_COUNT);

const isCheckOutcome = (key: string): key is CheckOutcome =>
  (CHECK_OUTCOMES as readonly string[]).includes(key);

export const checkCounts: Decoder<CheckCounts> = (input, path) => {
  if (!isRecord(input)) return fail(path, "must be an object");
  const out: Partial<Record<CheckOutcome, number>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isCheckOutcome(key)) return fail(join(path, key), "is not allowed");
    const n = count(value, join(path, key));
    if (!n.ok) return n;
    out[key] = n.value;
  }
  return ok(out);
};

export const scoreBuckets: Decoder<ScoreBuckets> = (input, path) => {
  if (!isRecord(input)) return fail(path, "must be an object");
  const out: Record<number, number> = {};
  for (const [key, value] of Object.entries(input)) {
    const bucket = Number(key);
    if (String(bucket) !== key || !SCORE_BUCKETS.includes(bucket)) {
      return fail(join(path, key), "is not a score bucket (0, 10, ..., 130)");
    }
    const n = count(value, join(path, key));
    if (!n.ok) return n;
    out[bucket] = n.value;
  }
  return ok(out);
};

export const dailyStats: Decoder<DailyStats> = strictObject<DailyStats>({
  pluginVersion: string(32),
  enforce: boolean,
  thresholds: strictObject({
    allowScore: integer(-1000, 1000),
    flagScore: integer(-1000, 1000),
  }),
  checks: checkCounts,
  scores: scoreBuckets,
  bansByJoinScore: scoreBuckets,
});
