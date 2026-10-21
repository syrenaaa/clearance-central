/** ban + pardon reports */

import type { BanReport, PardonReport, ReportId, ServerId, UnixTime, UserId } from "../types.ts";
import { type Sql, stmt } from "./sql.ts";

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

const selectByClientRef = (
  serverId: ServerId,
  kind: "ban" | "pardon",
  clientRef: string,
) =>
  stmt(
    `SELECT id, kind, received_at FROM reports
      WHERE server_id = ? AND kind = ? AND client_ref = ?`,
    serverId,
    kind,
    clientRef,
  );

/** insert a ban, or return this server's existing one with the same clientRef */
export const insertBan = async (
  sql: Sql,
  newId: ReportId,
  serverId: ServerId,
  ban: BanReport,
  now: UnixTime,
): Promise<StoredReport> => {
  const [, existing] = await sql.batch([
    stmt(
      `INSERT INTO reports
        (id, server_id, kind, client_ref, user_id, severity, category, at, received_at)
        VALUES (?, ?, 'ban', ?, ?, ?, ?, ?, ?)
        ON CONFLICT (server_id, kind, client_ref) DO NOTHING`,
      newId,
      serverId,
      ban.clientRef,
      ban.userId,
      ban.severity,
      ban.category,
      ban.at,
      now,
    ),
    selectByClientRef(serverId, "ban", ban.clientRef),
  ], "write");
  return toStoredReport(existing!.rows[0]!);
};

/** pardon one of this server's bans (or return the existing one by clientRef). undefined if no such ban */
export const insertPardon = async (
  sql: Sql,
  newId: ReportId,
  serverId: ServerId,
  pardon: PardonReport,
  now: UnixTime,
): Promise<StoredReport | undefined> => {
  const [, existing] = await sql.batch([
    stmt(
      `INSERT INTO reports (id, server_id, kind, client_ref, target_id, at, received_at)
        SELECT ?, ?, 'pardon', ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM reports WHERE id = ? AND server_id = ? AND kind = 'ban'
        )
        ON CONFLICT (server_id, kind, client_ref) DO NOTHING`,
      newId,
      serverId,
      pardon.clientRef,
      pardon.reportId,
      pardon.at,
      now,
      pardon.reportId,
      serverId,
    ),
    selectByClientRef(serverId, "pardon", pardon.clientRef),
  ], "write");
  const row = existing!.rows[0];
  return row === undefined ? undefined : toStoredReport(row);
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
  const { rows } = await sql.execute(stmt(
    `SELECT r.server_id, r.at, r.severity, r.category
      FROM reports r JOIN servers s ON s.id = r.server_id
      WHERE r.kind = 'ban' AND r.user_id = ? AND r.at >= ?
        AND s.revoked_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM reports p WHERE p.kind = 'pardon' AND p.target_id = r.id
        )
      ORDER BY r.at DESC
      LIMIT 1000`,
    userId,
    since,
  ));
  return rows.map((r) => ({
    serverId: String(r.server_id) as ServerId,
    at: Number(r.at) as UnixTime,
    severity: Number(r.severity),
    category: String(r.category),
  }));
};
