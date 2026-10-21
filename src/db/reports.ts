/** ban + pardon reports */

import type { BanReport, PardonReport, ReportId, ServerId, UnixTime, UserId } from "../types.ts";
import text from "./reports.sql" with { type: "text" };
import { queries, type Sql, stmt } from "./sql.ts";

const Q = queries(text, ["insert_ban", "insert_pardon", "by_client_ref", "active_bans"]);

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
  { clientRef, userId, severity, category, at }: BanReport,
  now: UnixTime,
): Promise<StoredReport> => {
  const [, got] = await sql.batch([
    stmt(Q.insert_ban, { id, serverId, clientRef, userId, severity, category, at, now }),
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
  readonly severity: number;
  readonly category: string;
};

/** unpardoned bans from live servers since `since`, newest first */
export const activeBans = async (
  sql: Sql,
  userId: UserId,
  since: UnixTime,
): Promise<ActiveBan[]> => {
  const { rows } = await sql.execute(stmt(Q.active_bans, { userId, since }));
  return rows.map((r) => ({
    serverId: String(r.server_id) as ServerId,
    at: Number(r.at) as UnixTime,
    severity: Number(r.severity),
    category: String(r.category),
  }));
};
