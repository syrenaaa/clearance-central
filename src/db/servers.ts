/** game servers and their key hashes */

import type { Server, ServerAddress, ServerId, UnixTime } from "../types.ts";
import { type Sql, stmt } from "./sql.ts";

export const findServerByKeyHash = async (
  sql: Sql,
  keyHash: string,
): Promise<Server | undefined> => {
  const { rows } = await sql.execute(
    stmt(
      "SELECT id FROM servers WHERE key_hash = ? AND revoked_at IS NULL",
      keyHash,
    ),
  );
  const row = rows[0];
  return row === undefined ? undefined : { id: String(row.id) as ServerId };
};

/** new server, or re-key the live one at the same address */
export const upsertServer = (
  newId: ServerId,
  keyHash: string,
  { address, port }: ServerAddress,
  now: UnixTime,
) =>
  stmt(
    `INSERT INTO servers (id, key_hash, address, port, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (address, port) WHERE revoked_at IS NULL
      DO UPDATE SET key_hash = excluded.key_hash
      RETURNING id`,
    newId,
    keyHash,
    address,
    port,
    now,
  );

/** id of the server that now has `keyHash` */
export const upsertServerKey = async (
  sql: Sql,
  newId: ServerId,
  keyHash: string,
  address: ServerAddress,
  now: UnixTime,
): Promise<ServerId> => {
  const { rows } = await sql.execute(upsertServer(newId, keyHash, address, now));
  return String(rows[0]!.id) as ServerId;
};

/** false if no live server had that id */
export const revokeServer = async (
  sql: Sql,
  id: ServerId,
  now: UnixTime,
): Promise<boolean> => {
  const { rowsAffected } = await sql.execute(stmt(
    "UPDATE servers SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    now,
    id,
  ));
  return rowsAffected > 0;
};
