/** policy constants + day math */

import type { Day } from "./types.ts";

export const DAY_SECONDS = 86_400;

/** bans older than this don't count and get purged */
export const RETENTION_SECONDS = 730 * DAY_SECONDS;
/** days below this are accepted, not stored */
export const MIN_CHECKS = 20;
/** max client clock drift into the future */
export const CLOCK_SKEW_SECONDS = 300;
export const MAX_RANGE_DAYS = 366;
export const CLAIM_TTL_SECONDS = 3600;
export const CLAIM_LIMITS = { perAddress: 5, total: 1000 } as const;
/** in-memory key cache ttl, bounds revocation delay */
export const AUTH_CACHE_SECONDS = 60;
export const AUTH_CACHE_MAX = 1000;

export const utcDay = (t: number): Day => new Date(t * 1000).toISOString().slice(0, 10) as Day;

export const daySpan = (from: Day, to: Day): number =>
  (Date.parse(to) - Date.parse(from)) / (DAY_SECONDS * 1000);
