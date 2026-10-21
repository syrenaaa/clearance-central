/** pending ownership claims */

import type { ServerAddress, ServerId, UnixTime } from "../types.ts";
import text from "./claims.sql" with { type: "text" };
import { upsertServer } from "./servers.ts";
import { queries, type Sql, stmt } from "./sql.ts";

const Q = queries(text, ["drop_expired", "insert", "find", "drop"]);

export type ClaimLimits = { readonly perAddress: number; readonly total: number };

export type StoredClaim = ServerAddress & { readonly token: string };

/** false when a limit is hit. expired claims don't count */
export const insertClaim = async (
  sql: Sql,
  idHash: string,
  { token, address, port }: StoredClaim,
  expiresAt: UnixTime,
  now: UnixTime,
  { perAddress, total }: ClaimLimits,
): Promise<boolean> => {
  const [, ins] = await sql.batch([
    stmt(Q.drop_expired, { now }),
    stmt(Q.insert, { idHash, token, address, port, expiresAt, perAddress, total }),
  ], "write");
  return ins!.rowsAffected > 0;
};

export const findClaim = async (
  sql: Sql,
  idHash: string,
  now: UnixTime,
): Promise<StoredClaim | undefined> => {
  const { rows } = await sql.execute(stmt(Q.find, { idHash, now }));
  const row = rows[0];
  if (row === undefined) return undefined;
  return { token: String(row.token), address: String(row.address), port: Number(row.port) };
};

/** atomically drop the claim + register/re-key the server */
export const completeClaim = async (
  sql: Sql,
  idHash: string,
  id: ServerId,
  keyHash: string,
  address: ServerAddress,
  now: UnixTime,
): Promise<ServerId> => {
  const [, up] = await sql.batch([
    stmt(Q.drop, { idHash }),
    upsertServer(id, keyHash, address, now),
  ], "write");
  return String(up!.rows[0]!.id) as ServerId;
};
