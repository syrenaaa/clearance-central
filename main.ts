/** val town http entry. set CENTRAL_ADMIN_KEY (32+ chars) to enable admin routes */

import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";
import { createApp } from "./src/app.ts";
import { unavailableServerList } from "./src/serverlist.ts";
import type { UnixTime } from "./src/types.ts";

export default createApp({
  sql: sqlite,
  now: () => Math.floor(Date.now() / 1000) as UnixTime,
  adminKey: Deno.env.get("CENTRAL_ADMIN_KEY"),
  serverList: unavailableServerList,
});
