/** bearer auth for game servers (cached key lookups) and the admin */

import type { Handler } from "jsr:@std/http@^1.1.4/unstable-route";
import { secretsEqual, sha256 } from "./crypto.ts";
import { findServerByKeyHash, type Sql } from "./db/mod.ts";
import { bearer, fail } from "./http.ts";
import { AUTH_CACHE_MAX, AUTH_CACHE_SECONDS } from "./limits.ts";
import type { Server, UnixTime } from "./types.ts";

/** handler for an authed game server */
export type ServerHandler = (
  req: Request,
  p: URLPatternResult,
  server: Server,
) => Promise<Response>;

export type Auth = {
  readonly asServer: (h: ServerHandler) => Handler;
  readonly asAdmin: (h: Handler) => Handler;
  /** drop cached keys, e.g. after a revoke */
  readonly forget: () => void;
};

const unauthorized = () =>
  fail(401, "unauthorized", "missing, wrong or revoked key", { "www-authenticate": "Bearer" });

export const createAuth = (
  sql: Sql,
  now: () => UnixTime,
  adminKey: string | undefined,
): Auth => {
  // key hash -> server, so pre-auth lookups cost 1 query not 2
  const cache = new Map<string, { server: Server; until: number }>();

  const lookup = async (req: Request): Promise<Server | undefined> => {
    const key = bearer(req);
    if (key === undefined) return undefined;
    const hash = await sha256(key);
    const hit = cache.get(hash);
    if (hit !== undefined && hit.until > now()) return hit.server;
    const server = await findServerByKeyHash(sql, hash);
    if (server === undefined) {
      cache.delete(hash);
      return undefined;
    }
    if (cache.size >= AUTH_CACHE_MAX) cache.clear();
    cache.set(hash, { server, until: now() + AUTH_CACHE_SECONDS });
    return server;
  };

  const isAdmin = async (req: Request): Promise<boolean> => {
    const key = bearer(req);
    if (adminKey === undefined || adminKey.length < 32 || key === undefined) return false;
    return await secretsEqual(key, adminKey);
  };

  return {
    asServer: (h) => async (req, p) => {
      const server = await lookup(req);
      if (server === undefined) return unauthorized();
      return h(req, p, server);
    },
    asAdmin: (h) => async (req, p) => {
      if (!await isAdmin(req)) return unauthorized();
      return h(req, p);
    },
    forget: () => cache.clear(),
  };
};
