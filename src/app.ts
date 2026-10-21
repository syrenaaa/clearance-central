/** the http api from openapi.yaml. all effects are injected via `Deps` */

import { type RequestHandler, route } from "jsr:@std/http@^1.1.4/unstable-route";
import { createAuth } from "./auth.ts";
import { migrate, type Sql } from "./db/mod.ts";
import { fail } from "./http.ts";
import { pageRoutes } from "./pages/routes.ts";
import type { Ctx } from "./routes/ctx.ts";
import { reportRoutes } from "./routes/reports.ts";
import { serverRoutes } from "./routes/servers.ts";
import { statsRoutes } from "./routes/stats.ts";
import type { ServerList } from "./serverlist.ts";
import type { UnixTime } from "./types.ts";

export type Deps = {
  readonly sql: Sql;
  /** unix secs */
  readonly now: () => UnixTime;
  /** admin routes are 401 while unset */
  readonly adminKey: string | undefined;
  readonly serverList: ServerList;
};

export const createApp = (deps: Deps): RequestHandler => {
  const { sql, now, serverList } = deps;
  const ctx: Ctx = { sql, now, serverList, auth: createAuth(sql, now, deps.adminKey) };

  let schema: Promise<void> | undefined;
  const ready = () =>
    schema ??= migrate(sql).catch((e) => {
      schema = undefined;
      throw e;
    });

  const api = route(
    [...serverRoutes(ctx), ...statsRoutes(ctx), ...reportRoutes(ctx)],
    () => fail(404, "not_found"),
  );

  // static pages come first so they don't wait on the schema
  const router = route(pageRoutes, async (req, info) => {
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
