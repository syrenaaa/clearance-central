/** /v1/stats: daily uploads + network sums */

import type { Handler, Route } from "jsr:@std/http@^1.1.4/unstable-route";
import type { ServerHandler } from "../auth.ts";
import * as db from "../db/mod.ts";
import * as decode from "../decode/mod.ts";
import { networkStats } from "../facts.ts";
import { fail, invalid, json, pathParam, pattern, readJson } from "../http.ts";
import {
  CLOCK_SKEW_SECONDS,
  daySpan,
  MAX_RANGE_DAYS,
  MIN_CHECKS,
  MIN_SERVERS,
  RETENTION_SECONDS,
  utcDay,
} from "../limits.ts";
import type { Ctx } from "./ctx.ts";

export const statsRoutes = ({ sql, now, auth }: Ctx): Route[] => {
  const putStats: ServerHandler = async (req, p, server) => {
    const day = decode.day(pathParam(p.pathname.groups.day), "day");
    if (!day.ok) return invalid("invalid_day", day.error);
    if (day.value > utcDay(now() + CLOCK_SKEW_SECONDS)) {
      return fail(400, "invalid_day", "day is in the future");
    }
    if (day.value < utcDay(now() - RETENTION_SECONDS)) {
      return fail(400, "invalid_day", "day is older than the retention window");
    }
    const body = await readJson(req);
    if (!body.ok) return body.error;
    const stats = decode.dailyStats(body.value, "");
    if (!stats.ok) return invalid("invalid_stats", stats.error);

    const total = Object.values(stats.value.checks).reduce((a, n) => a + n, 0);
    const keep = total >= MIN_CHECKS;
    await db.replaceStatsDay(sql, server.id, day.value, keep ? stats.value : undefined, now());
    return json(200, keep ? { stored: true } : { stored: false, reason: "too_few_checks" });
  };

  const getNetworkStats: Handler = async (req) => {
    const q = new URL(req.url).searchParams;
    const from = decode.day(q.get("from") ?? undefined, "from");
    if (!from.ok) return invalid("invalid_range", from.error);
    const to = decode.day(q.get("to") ?? undefined, "to");
    if (!to.ok) return invalid("invalid_range", to.error);
    const span = daySpan(from.value, to.value);
    if (span < 0) return fail(400, "invalid_range", "from is after to");
    if (span >= MAX_RANGE_DAYS) return fail(400, "invalid_range", `at most ${MAX_RANGE_DAYS} days`);
    const rows = await db.sumStats(sql, from.value, to.value, MIN_SERVERS);
    return json(200, networkStats(from.value, to.value, rows));
  };

  return [
    {
      method: "GET",
      pattern: pattern("/v1/stats/network"),
      handler: getNetworkStats,
    },
    { method: "PUT", pattern: pattern("/v1/stats/:day"), handler: auth.asServer(putStats) },
  ];
};
