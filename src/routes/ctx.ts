/** what every route module gets from the app */

import type { Auth } from "../auth.ts";
import type { Sql } from "../db/mod.ts";
import type { ServerList } from "../serverlist.ts";
import type { UnixTime } from "../types.ts";

export type Ctx = {
  readonly sql: Sql;
  /** unix secs */
  readonly now: () => UnixTime;
  readonly serverList: ServerList;
  readonly auth: Auth;
};
