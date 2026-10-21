/** input decoding: shared primitives + one explicit decoder per request type */

import { err, ok, type Result } from "./result.ts";
import {
  BAN_CATEGORIES,
  type BanCategory,
  type BanReport,
  CHECK_OUTCOMES,
  type CheckCounts,
  type CheckOutcome,
  type ClaimId,
  type DailyStats,
  type Day,
  type PardonReport,
  type ReportId,
  type ReportRequest,
  SCORE_BUCKETS,
  type ScoreBuckets,
  type ServerAddress,
  type ServerId,
  type UnixTime,
  type UserId,
} from "./types.ts";

/** what failed and where, e.g. path `checks.allow` */
export type DecodeError = { readonly path: string; readonly message: string };

export type Decoder<T> = (input: unknown, path: string) => Result<T, DecodeError>;

const fail = (path: string, message: string) => err({ path, message });

/** cap well below 2^53 so network sums stay exact */
const MAX_COUNT = 1_000_000_000;

// primitives

export const string = (max: number): Decoder<string> => (input, path) => {
  if (typeof input !== "string") return fail(path, "must be a string");
  if (input.length === 0 || input.length > max) return fail(path, `must be 1..${max} characters`);
  return ok(input);
};

export const integer = (min: number, max: number): Decoder<number> => (input, path) => {
  if (typeof input !== "number" || !Number.isInteger(input)) {
    return fail(path, "must be an integer");
  }
  if (input < min || input > max) return fail(path, `must be in ${min}..${max}`);
  return ok(input);
};

export const boolean: Decoder<boolean> = (input, path) =>
  typeof input === "boolean" ? ok(input) : fail(path, "must be a boolean");

export const literal =
  <const T extends string>(values: readonly T[]): Decoder<T> => (input, path) =>
    typeof input === "string" && (values as readonly string[]).includes(input)
      ? ok(input as T)
      : fail(path, `must be one of ${values.join(", ")}`);

const isRecord = (input: unknown): input is Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input);

const join = (path: string, key: string) => path === "" ? key : `${path}.${key}`;

type Fields<T> = { readonly [K in keyof T]-?: Decoder<T[K]> };

/** exactly these keys, all required (`additionalProperties: false`) */
export const strictObject = <T>(fields: Fields<T>): Decoder<T> => (input, path) => {
  if (!isRecord(input)) return fail(path, "must be an object");
  const unknown = Object.keys(input).find((k) => !Object.hasOwn(fields, k));
  if (unknown !== undefined) return fail(join(path, unknown), "is not allowed");
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(fields) as (keyof T & string)[]) {
    if (!Object.hasOwn(input, key)) return fail(join(path, key), "is required");
    const field = fields[key](input[key], join(path, key));
    if (!field.ok) return field;
    out[key] = field.value;
  }
  return ok(out as T);
};

// ---------------------------------------------------------------------------
// domain scalars
// ---------------------------------------------------------------------------

const USER_ID = /^[^@\s]+@(steam|discord|northwood)$/;

/** trim + lowercase like the plugin, then check shape */
export const userId: Decoder<UserId> = (input, path) => {
  if (typeof input !== "string") return fail(path, "must be a string");
  const normalized = input.trim().toLowerCase();
  return normalized.length <= 128 && USER_ID.test(normalized)
    ? ok(normalized as UserId)
    : fail(path, "must look like 76561198000000000@steam");
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `Date.UTC` rolls invalid days over, so round-trip to check */
const isCalendarDay = (y: number, m: number, d: number): boolean => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d;
};

export const day: Decoder<Day> = (input, path) => {
  const m = typeof input === "string" ? DAY.exec(input) : null;
  return m !== null && isCalendarDay(Number(m[1]), Number(m[2]), Number(m[3]))
    ? ok(input as Day)
    : fail(path, "must be a date, YYYY-MM-DD");
};

export const unixTime: Decoder<UnixTime> = (input, path) => {
  const r = integer(0, Number.MAX_SAFE_INTEGER)(input, path);
  return r.ok ? ok(r.value as UnixTime) : r;
};

const opaqueId = <T extends string>(prefix: string): Decoder<T> => (input, path) =>
  typeof input === "string" && input.startsWith(prefix) &&
    /^[A-Za-z0-9_-]{1,64}$/.test(input)
    ? ok(input as T)
    : fail(path, "is not a valid id");

export const serverId: Decoder<ServerId> = opaqueId("");
export const reportId: Decoder<ReportId> = opaqueId("rep_");
export const claimId: Decoder<ClaimId> = opaqueId("clm_");

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

// ---------------------------------------------------------------------------
// request bodies
// ---------------------------------------------------------------------------

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

const clientRef = string(128);

const banReport: Decoder<BanReport> = strictObject<BanReport>({
  kind: literal(["ban"]),
  clientRef,
  userId,
  at: unixTime,
  severity: integer(1, 5),
  category: literal<BanCategory>(BAN_CATEGORIES),
});

const pardonReport: Decoder<PardonReport> = strictObject<PardonReport>({
  kind: literal(["pardon"]),
  clientRef,
  reportId,
  at: unixTime,
});

export const reportRequest: Decoder<ReportRequest> = (input, path) => {
  if (!isRecord(input)) return fail(path, "must be an object");
  switch (input.kind) {
    case "ban":
      return banReport(input, path);
    case "pardon":
      return pardonReport(input, path);
    default:
      return fail(join(path, "kind"), "must be ban or pardon");
  }
};

/** hostnames, ipv4, ipv6 literals (lowercased) */
const ADDRESS = /^[a-z0-9.:\[\]-]{1,253}$/;

export const serverAddress: Decoder<ServerAddress> = (input, path) => {
  const r = strictObject<ServerAddress>({
    address: string(253),
    port: integer(1, 65535),
  })(input, path);
  if (!r.ok) return r;
  const address = r.value.address.trim().toLowerCase();
  return ADDRESS.test(address)
    ? ok({ address, port: r.value.port })
    : fail(join(path, "address"), "must be a hostname or IP address");
};
