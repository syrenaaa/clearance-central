/** /v1/reports + /v1/players: ban sharing, plus admin access / erasure */

import type { Handler, Route } from "jsr:@std/http@^1.1.4/unstable-route";
import type { ServerHandler } from "../auth.ts";
import { randomToken } from "../crypto.ts";
import * as db from "../db/mod.ts";
import * as decode from "../decode/mod.ts";
import { playerFacts } from "../facts.ts";
import { fail, invalid, json, pathParam, pattern, readJson } from "../http.ts";
import { CLOCK_SKEW_SECONDS, RETENTION_SECONDS } from "../limits.ts";
import type { ReportId, UnixTime } from "../types.ts";
import type { Ctx } from "./ctx.ts";

export const reportRoutes = ({ sql, now, auth }: Ctx): Route[] => {
  const postReport: ServerHandler = async (req, _p, server) => {
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
    const t = now();
    const bans = await db.activeBans(sql, userId.value, (t - RETENTION_SECONDS) as UnixTime, t);
    return json(200, playerFacts(userId.value, bans));
  };

  // admin: privacy access + erasure requests

  const userReports: Handler = async (_req, p) => {
    const userId = decode.userId(pathParam(p.pathname.groups.userId), "userId");
    if (!userId.ok) return invalid("invalid_user_id", userId.error);
    return json(200, { userId: userId.value, reports: await db.reportsForUser(sql, userId.value) });
  };

  const eraseUser: Handler = async (_req, p) => {
    const userId = decode.userId(pathParam(p.pathname.groups.userId), "userId");
    if (!userId.ok) return invalid("invalid_user_id", userId.error);
    return json(200, { deleted: await db.deleteUserReports(sql, userId.value) });
  };

  const deleteReport: Handler = async (_req, p) => {
    const id = decode.reportId(pathParam(p.pathname.groups.reportId), "");
    if (!id.ok || !await db.deleteReport(sql, id.value)) return fail(404, "report_not_found");
    return new Response(null, { status: 204 });
  };

  const reports = pattern("/v1/players/:userId/reports");
  return [
    { method: "POST", pattern: pattern("/v1/reports"), handler: auth.asServer(postReport) },
    { method: "GET", pattern: pattern("/v1/players/:userId"), handler: auth.asServer(getPlayer) },
    { method: "GET", pattern: reports, handler: auth.asAdmin(userReports) },
    { method: "DELETE", pattern: reports, handler: auth.asAdmin(eraseUser) },
    {
      method: "DELETE",
      pattern: pattern("/v1/reports/:reportId"),
      handler: auth.asAdmin(deleteReport),
    },
  ];
};
