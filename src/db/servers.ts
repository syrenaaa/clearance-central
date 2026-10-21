/** game servers and their key hashes */

import type { Day, Server, ServerAddress, ServerId, UnixTime } from "../types.ts";
import text from "./servers.sql" with { type: "text" };
import { queries, type Sql, stmt } from "./sql.ts";

const Q = queries(text, ["find_by_key_hash", "upsert", "revoke", "list"]);

export const findServerByKeyHash = async (
  sql: Sql,
  keyHash: string,
): Promise<Server | undefined> => {
  const { rows } = await sql.execute(stmt(Q.find_by_key_hash, { keyHash }));
  const row = rows[0];
  if (row === undefined) return undefined;
  return { id: String(row.id) as ServerId };
};

/** new server, or re-key the live one at the same address */
export const upsertServer = (
  id: ServerId,
  keyHash: string,
  { address, port }: ServerAddress,
  now: UnixTime,
) => stmt(Q.upsert, { id, keyHash, address, port, now });

/** id of the server that now has `keyHash` */
export const upsertServerKey = async (
  sql: Sql,
  id: ServerId,
  keyHash: string,
  address: ServerAddress,
  now: UnixTime,
): Promise<ServerId> => {
  const { rows } = await sql.execute(upsertServer(id, keyHash, address, now));
  return String(rows[0]!.id) as ServerId;
};

/** false if no live server had that id */
export const revokeServer = async (sql: Sql, id: ServerId, now: UnixTime): Promise<boolean> => {
  const { rowsAffected } = await sql.execute(stmt(Q.revoke, { id, now }));
  return rowsAffected > 0;
};

export type AdminServer = {
  readonly serverId: ServerId;
  readonly address: string;
  readonly port: number;
  readonly createdAt: UnixTime;
  readonly revokedAt: UnixTime | null;
  readonly bans: number;
  readonly lastStatsDay: Day | null;
};

const orNull = <T>(v: unknown, f: (v: unknown) => T): T | null =>
  v === null || v === undefined ? null : f(v);

/** admin view, newest first, revoked included */
export const listServers = async (sql: Sql): Promise<AdminServer[]> => {
  const { rows } = await sql.execute(stmt(Q.list));
  return rows.map((r) => ({
    serverId: String(r.id) as ServerId,
    address: String(r.address),
    port: Number(r.port),
    createdAt: Number(r.created_at) as UnixTime,
    revokedAt: orNull(r.revoked_at, (v) => Number(v) as UnixTime),
    bans: Number(r.bans),
    lastStatsDay: orNull(r.last_stats_day, (v) => String(v) as Day),
  }));
};
