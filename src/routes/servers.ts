/** /v1/servers: claims, admin list + register + revoke */

import type { Handler, Route } from "jsr:@std/http@^1.1.4/unstable-route";
import { ulid } from "jsr:@std/ulid@^1.0.0";
import { randomToken, sha256 } from "../crypto.ts";
import * as db from "../db/mod.ts";
import * as decode from "../decode/mod.ts";
import { fail, invalid, json, pathParam, pattern, readJson } from "../http.ts";
import { CLAIM_LIMITS, CLAIM_TTL_SECONDS } from "../limits.ts";
import type { ClaimId, ServerId, UnixTime } from "../types.ts";
import type { Ctx } from "./ctx.ts";

const newServerKey = async () => {
  const apiKey = randomToken("cck_", 32);
  return { apiKey, keyHash: await sha256(apiKey), newId: ulid() as ServerId };
};

export const serverRoutes = ({ sql, now, serverList, auth }: Ctx): Route[] => {
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

    const info = await serverList(claim);
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

  const listServers: Handler = async () => json(200, { servers: await db.listServers(sql) });

  const revokeServer: Handler = async (_req, p) => {
    const id = decode.serverId(pathParam(p.pathname.groups.serverId), "");
    if (!id.ok || !await db.revokeServer(sql, id.value, now())) {
      return fail(404, "server_not_found");
    }
    auth.forget();
    return new Response(null, { status: 204 });
  };

  return [
    { method: "GET", pattern: pattern("/v1/servers"), handler: auth.asAdmin(listServers) },
    { method: "POST", pattern: pattern("/v1/servers"), handler: auth.asAdmin(registerServer) },
    { method: "POST", pattern: pattern("/v1/servers/claims"), handler: createClaim },
    {
      method: "POST",
      pattern: pattern("/v1/servers/claims/:claimId/verify"),
      handler: verifyClaim,
    },
    {
      method: "DELETE",
      pattern: pattern("/v1/servers/:serverId"),
      handler: auth.asAdmin(revokeServer),
    },
  ];
};
