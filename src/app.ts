/** the http api from openapi.yaml. all effects are injected via `Deps` */

import {
  type Handler,
  type RequestHandler,
  type Route,
  route,
} from "jsr:@std/http@^1.1.4/unstable-route";
import { ulid } from "jsr:@std/ulid@^1.0.0";
import { randomToken, secretsEqual, sha256 } from "./crypto.ts";
import * as db from "./db.ts";
import * as decode from "./decode.ts";
import { docsRoutes } from "./docs.ts";
import { networkStats, playerFacts } from "./facts.ts";
import { bearer, fail, invalid, json, pathParam, readJson } from "./http.ts";
import type { ServerList } from "./serverlist.ts";
import type { ClaimId, Day, ReportId, Server, ServerId, UnixTime } from "./types.ts";

export type Deps = {
  readonly sql: db.Sql;
  /** unix secs */
  readonly now: () => UnixTime;
  /** admin routes are 401 while unset */
  readonly adminKey: string | undefined;
  readonly serverList: ServerList;
  /** openapi.yaml text, served with the docs */
  readonly spec: () => Promise<string>;
};

const DAY_SECONDS = 86_400;

/** bans older than this don't count and get purged */
export const RETENTION_SECONDS = 730 * DAY_SECONDS;
/** days below this are accepted, not stored */
export const MIN_CHECKS = 20;
/** max client clock drift into the future */
const CLOCK_SKEW_SECONDS = 300;
const MAX_RANGE_DAYS = 366;
const CLAIM_TTL_SECONDS = 3600;
const CLAIM_LIMITS: db.ClaimLimits = { perAddress: 5, total: 1000 };
/** in-memory key cache ttl, bounds revocation delay */
const AUTH_CACHE_SECONDS = 60;
const AUTH_CACHE_MAX = 1000;

const utcDay = (t: number): Day => new Date(t * 1000).toISOString().slice(0, 10) as Day;

const daySpan = (from: Day, to: Day): number =>
  (Date.parse(to) - Date.parse(from)) / (DAY_SECONDS * 1000);

const pattern = (pathname: string) => new URLPattern({ pathname });

/** handler for an authed game server */
type ServerHandler = (
  req: Request,
  p: URLPatternResult,
  server: Server,
) => Promise<Response>;

export const createApp = (deps: Deps): RequestHandler => {
  const { sql, now } = deps;

  let schema: Promise<void> | undefined;
  const ready = () =>
    schema ??= db.migrate(sql).catch((e) => {
      schema = undefined;
      throw e;
    });

  // key hash -> server, so pre-auth lookups cost 1 query not 2
  const authCache = new Map<string, { server: Server; until: number }>();

  const authenticate = async (req: Request): Promise<Server | undefined> => {
    const key = bearer(req);
    if (key === undefined) return undefined;
    const hash = await sha256(key);
    const cached = authCache.get(hash);
    if (cached !== undefined && cached.until > now()) return cached.server;
    const server = await db.findServerByKeyHash(sql, hash);
    if (server === undefined) {
      authCache.delete(hash);
      return undefined;
    }
    if (authCache.size >= AUTH_CACHE_MAX) authCache.clear();
    authCache.set(hash, { server, until: now() + AUTH_CACHE_SECONDS });
    return server;
  };

  const isAdmin = async (req: Request): Promise<boolean> => {
    const key = bearer(req);
    return deps.adminKey !== undefined && deps.adminKey.length >= 32 &&
      key !== undefined && await secretsEqual(key, deps.adminKey);
  };

  const unauthorized = () =>
    fail(401, "unauthorized", "missing, wrong or revoked key", {
      "www-authenticate": "Bearer",
    });

  const asServer = (handler: ServerHandler): Handler => async (req, p) => {
    const server = await authenticate(req);
    return server === undefined ? unauthorized() : handler(req, p, server);
  };

  const asAdmin = (handler: Handler): Handler => async (req, p) =>
    await isAdmin(req) ? handler(req, p) : unauthorized();

  const newServerKey = async () => {
    const apiKey = randomToken("cck_", 32);
    return {
      apiKey,
      keyHash: await sha256(apiKey),
      newId: ulid() as ServerId,
    };
  };

  // servers

  const createClaim: Handler = async (req) => {
    const body = await readJson(req);
    if (!body.ok) return body.error;
    const address = decode.serverAddress(body.value, "");
    if (!address.ok) return invalid("invalid_claim", address.error);

    const claimId = randomToken("clm_", 24) as ClaimId;
    const token = randomToken("clearance-", 12);
    const expiresAt = (now() + CLAIM_TTL_SECONDS) as UnixTime;
    const stored = await db.insertClaim(
      sql,
      await sha256(claimId),
      { ...address.value, token },
      expiresAt,
      now(),
      CLAIM_LIMITS,
    );
    if (!stored) {
      return fail(429, "too_many_claims", "try again later", {
        "retry-after": String(CLAIM_TTL_SECONDS),
      });
    }
    return json(201, { claimId, token, expiresAt });
  };

  const verifyClaim: Handler = async (_req, p) => {
    const claimId = decode.claimId(pathParam(p.pathname.groups.claimId), "");
    if (!claimId.ok) return fail(404, "claim_not_found");
    const idHash = await sha256(claimId.value);
    const claim = await db.findClaim(sql, idHash, now());
    if (claim === undefined) return fail(404, "claim_not_found");

    const info = await deps.serverList(claim);
    if (!info.ok) {
      return fail(
        503,
        "server_list_unavailable",
        "the verified server list can't be read right now",
        { "retry-after": "60" },
      );
    }
    if (info.value === undefined) {
      return fail(409, "server_not_listed", "the server is not on the verified list");
    }
    if (!info.value.includes(claim.token)) {
      return fail(409, "token_not_found", "the token is not in the Server Info");
    }

    const { apiKey, keyHash, newId } = await newServerKey();
    const serverId = await db.completeClaim(sql, idHash, newId, keyHash, claim, now());
    return json(200, { serverId, apiKey });
  };

  const registerServer: Handler = async (req) => {
    const body = await readJson(req);
    if (!body.ok) return body.error;
    const address = decode.serverAddress(body.value, "");
    if (!address.ok) return invalid("invalid_server", address.error);
    const { apiKey, keyHash, newId } = await newServerKey();
    const serverId = await db.upsertServerKey(sql, newId, keyHash, address.value, now());
    return json(201, { serverId, apiKey });
  };

  const revokeServer: Handler = async (_req, p) => {
    const id = decode.serverId(pathParam(p.pathname.groups.serverId), "");
    if (!id.ok || !await db.revokeServer(sql, id.value, now())) {
      return fail(404, "server_not_found");
    }
    authCache.clear();
    return new Response(null, { status: 204 });
  };

  // stats

  const putStats: ServerHandler = async (req, p, server) => {
    const day = decode.day(pathParam(p.pathname.groups.day), "day");
    if (!day.ok) return invalid("invalid_day", day.error);
    if (day.value > utcDay(now() + CLOCK_SKEW_SECONDS)) {
      return fail(400, "invalid_day", "day is in the future");
    }
    const body = await readJson(req);
    if (!body.ok) return body.error;
    const stats = decode.dailyStats(body.value, "");
    if (!stats.ok) return invalid("invalid_stats", stats.error);

    const total = Object.values(stats.value.checks).reduce((a, n) => a + n, 0);
    const keep = total >= MIN_CHECKS;
    await db.replaceStatsDay(
      sql,
      server.id,
      day.value,
      keep ? stats.value : undefined,
      now(),
    );
    return json(200, keep ? { stored: true } : { stored: false, reason: "too_few_checks" });
  };

  const getNetworkStats: ServerHandler = async (req) => {
    const query = new URL(req.url).searchParams;
    const from = decode.day(query.get("from") ?? undefined, "from");
    if (!from.ok) return invalid("invalid_range", from.error);
    const to = decode.day(query.get("to") ?? undefined, "to");
    if (!to.ok) return invalid("invalid_range", to.error);
    const span = daySpan(from.value, to.value);
    if (span < 0) return fail(400, "invalid_range", "from is after to");
    if (span >= MAX_RANGE_DAYS) {
      return fail(400, "invalid_range", `at most ${MAX_RANGE_DAYS} days`);
    }
    const rows = await db.sumStats(sql, from.value, to.value);
    return json(200, networkStats(from.value, to.value, rows));
  };

  // reports

  const postReport: ServerHandler = async (req, _params, server) => {
    const body = await readJson(req);
    if (!body.ok) return body.error;
    const report = decode.reportRequest(body.value, "");
    if (!report.ok) return invalid("invalid_report", report.error);
    const t = now();
    if (report.value.at > t + CLOCK_SKEW_SECONDS) {
      return fail(400, "invalid_report", "at is in the future");
    }

    const newId = randomToken("rep_", 12) as ReportId;
    if (report.value.kind === "ban") {
      if (report.value.at < t - RETENTION_SECONDS) {
        return fail(400, "invalid_report", "at is older than the retention window");
      }
      const stored = await db.insertBan(sql, newId, server.id, report.value, t);
      return json(stored.reportId === newId ? 201 : 200, stored);
    }
    const stored = await db.insertPardon(sql, newId, server.id, report.value, t);
    if (stored === undefined) {
      return fail(404, "ban_not_found", "this server reported no ban with that reportId");
    }
    return json(stored.reportId === newId ? 201 : 200, stored);
  };

  const getPlayer: ServerHandler = async (_req, p) => {
    const userId = decode.userId(pathParam(p.pathname.groups.userId), "userId");
    if (!userId.ok) return invalid("invalid_user_id", userId.error);
    const since = (now() - RETENTION_SECONDS) as UnixTime;
    const bans = await db.activeBans(sql, userId.value, since);
    return json(200, playerFacts(userId.value, bans));
  };

  // routing

  const routes: Route[] = [
    { method: "POST", pattern: pattern("/v1/servers"), handler: asAdmin(registerServer) },
    { method: "POST", pattern: pattern("/v1/servers/claims"), handler: createClaim },
    {
      method: "POST",
      pattern: pattern("/v1/servers/claims/:claimId/verify"),
      handler: verifyClaim,
    },
    {
      method: "DELETE",
      pattern: pattern("/v1/servers/:serverId"),
      handler: asAdmin(revokeServer),
    },
    { method: "GET", pattern: pattern("/v1/stats/network"), handler: asServer(getNetworkStats) },
    { method: "PUT", pattern: pattern("/v1/stats/:day"), handler: asServer(putStats) },
    { method: "POST", pattern: pattern("/v1/reports"), handler: asServer(postReport) },
    { method: "GET", pattern: pattern("/v1/players/:userId"), handler: asServer(getPlayer) },
  ];

  const notFound: RequestHandler = () => fail(404, "not_found");
  const api = route(routes, notFound);

  // docs come first so they don't wait on the schema
  const router = route(docsRoutes(deps.spec), async (req, info) => {
    await ready();
    return api(req, info);
  });

  return async (req, info) => {
    try {
      return await router(req, info);
    } catch (e) {
      console.error(e);
      return fail(500, "internal", "try again later");
    }
  };
};
