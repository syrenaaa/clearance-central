/** val town interval entry: report retention purge, run daily */

import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";
import { RETENTION_SECONDS } from "./src/app.ts";
import { migrate, purge } from "./src/db.ts";
import type { UnixTime } from "./src/types.ts";

export default async function (): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await migrate(sqlite);
  await purge(sqlite, (now - RETENTION_SECONDS) as UnixTime, now as UnixTime);
}
