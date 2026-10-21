/** domain scalars: ids, days, times */

import { ok } from "../result.ts";
import type { ClaimId, Day, ReportId, ServerId, UnixTime, UserId } from "../types.ts";
import { type Decoder, fail, integer } from "./core.ts";

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
