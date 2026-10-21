/** ban + pardon reports */

import type { BanReport, PardonReport, ReportId, ServerId, UnixTime, UserId } from "../types.ts";
import text from "./reports.sql" with { type: "text" };
import { queries, type Sql, stmt } from "./sql.ts";

const Q = queries(text, [
  "insert_ban",
  "insert_pardon",
  "by_client_ref",
  "active_bans",
  "for_user",
  "drop_user_pardons",
  "drop_user_bans",
  "drop_pardons_of",
  "drop_ban",
]);

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

/** insert a ban, or return this server's existing one with the same clientRef */
export const insertBan = async (
  sql: Sql,
  id: ReportId,
  serverId: ServerId,
  { clientRef, userId, severity, category, at, duration }: BanReport,
  now: UnixTime,
): Promise<StoredReport> => {
  const expiresAt = duration === null ? null : at + duration;
  const [, got] = await sql.batch([
    stmt(Q.insert_ban, { id, serverId, clientRef, userId, severity, category, at, expiresAt, now }),
    stmt(Q.by_client_ref, { serverId, kind: "ban", clientRef }),
  ], "write");
  return toStoredReport(got!.rows[0]!);
};

/** pardon one of this server's bans (or return the existing one by clientRef). undefined if no such ban */
export const insertPardon = async (
  sql: Sql,
  id: ReportId,
  serverId: ServerId,
  { clientRef, reportId, at }: PardonReport,
  now: UnixTime,
): Promise<StoredReport | undefined> => {
  const [, got] = await sql.batch([
    stmt(Q.insert_pardon, { id, serverId, clientRef, reportId, at, now }),
    stmt(Q.by_client_ref, { serverId, kind: "pardon", clientRef }),
  ], "write");
  const row = got!.rows[0];
  if (row === undefined) return undefined;
  return toStoredReport(row);
};

export type ActiveBan = {
  readonly serverId: ServerId;
  readonly at: UnixTime;
  /** null = permanent */
  readonly expiresAt: UnixTime | null;
  readonly severity: number;
  readonly category: string;
};

/** running bans from live servers since `since`, newest first */
export const activeBans = async (
  sql: Sql,
  userId: UserId,
  since: UnixTime,
  now: UnixTime,
): Promise<ActiveBan[]> => {
  const { rows } = await sql.execute(stmt(Q.active_bans, { userId, since, now }));
  return rows.map((r) => ({
    serverId: String(r.server_id) as ServerId,
    at: Number(r.at) as UnixTime,
    expiresAt: r.expires_at === null ? null : Number(r.expires_at) as UnixTime,
    severity: Number(r.severity),
    category: String(r.category),
  }));
};

export type AdminReport = {
  readonly reportId: ReportId;
  readonly serverId: ServerId;
  readonly clientRef: string;
  readonly at: UnixTime;
  readonly expiresAt: UnixTime | null;
  readonly severity: number;
  readonly category: string;
  readonly receivedAt: UnixTime;
  readonly pardonedAt: UnixTime | null;
};

const time = (v: unknown): UnixTime | null =>
  v === null || v === undefined ? null : Number(v) as UnixTime;

/** admin view: every ban about a player, newest first */
export const reportsForUser = async (sql: Sql, userId: UserId): Promise<AdminReport[]> => {
  const { rows } = await sql.execute(stmt(Q.for_user, { userId }));
  return rows.map((r) => ({
    reportId: String(r.id) as ReportId,
    serverId: String(r.server_id) as ServerId,
    clientRef: String(r.client_ref),
    at: Number(r.at) as UnixTime,
    expiresAt: time(r.expires_at),
    severity: Number(r.severity),
    category: String(r.category),
    receivedAt: Number(r.received_at) as UnixTime,
    pardonedAt: time(r.pardoned_at),
  }));
};

/** erase all of a player's bans + their pardons. returns bans deleted */
export const deleteUserReports = async (sql: Sql, userId: UserId): Promise<number> => {
  const [, bans] = await sql.batch([
    stmt(Q.drop_user_pardons, { userId }),
    stmt(Q.drop_user_bans, { userId }),
  ], "write");
  return bans!.rowsAffected;
};

/** delete one ban + its pardons. false if there was no such ban */
export const deleteReport = async (sql: Sql, id: ReportId): Promise<boolean> => {
  const [, ban] = await sql.batch([
    stmt(Q.drop_pardons_of, { id }),
    stmt(Q.drop_ban, { id }),
  ], "write");
  return ban!.rowsAffected > 0;
};
