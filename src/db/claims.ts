/** pending ownership claims */

import type { ServerAddress, ServerId, UnixTime } from "../types.ts";
import { upsertServer } from "./servers.ts";
import { type Sql, stmt } from "./sql.ts";

export type ClaimLimits = { readonly perAddress: number; readonly total: number };

export type StoredClaim = ServerAddress & { readonly token: string };

/** false when a limit is hit. expired claims don't count */
export const insertClaim = async (
  sql: Sql,
  idHash: string,
  claim: StoredClaim,
  expiresAt: UnixTime,
  now: UnixTime,
  limits: ClaimLimits,
): Promise<boolean> => {
  const [, inserted] = await sql.batch([
    stmt("DELETE FROM claims WHERE expires_at <= ?", now),
    stmt(
      `INSERT INTO claims (id_hash, token, address, port, expires_at)
        SELECT ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM claims WHERE address = ? AND port = ?) < ?
          AND (SELECT COUNT(*) FROM claims) < ?`,
      idHash,
      claim.token,
      claim.address,
      claim.port,
      expiresAt,
      claim.address,
      claim.port,
      limits.perAddress,
      limits.total,
    ),
  ], "write");
  return inserted!.rowsAffected > 0;
};

export const findClaim = async (
  sql: Sql,
  idHash: string,
  now: UnixTime,
): Promise<StoredClaim | undefined> => {
  const { rows } = await sql.execute(stmt(
    "SELECT token, address, port FROM claims WHERE id_hash = ? AND expires_at > ?",
    idHash,
    now,
  ));
  const row = rows[0];
  return row === undefined ? undefined : {
    token: String(row.token),
    address: String(row.address),
    port: Number(row.port),
  };
};

/** atomically drop the claim + register/re-key the server */
export const completeClaim = async (
  sql: Sql,
  idHash: string,
  newId: ServerId,
  keyHash: string,
  address: ServerAddress,
  now: UnixTime,
): Promise<ServerId> => {
  const [, upserted] = await sql.batch([
    stmt("DELETE FROM claims WHERE id_hash = ?", idHash),
    upsertServer(newId, keyHash, address, now),
  ], "write");
  return String(upserted!.rows[0]!.id) as ServerId;
};
