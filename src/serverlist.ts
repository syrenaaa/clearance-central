/** server info lookup for claims. one fn type so the source can be swapped (see AGENTS.md open questions) */

import { err, type Result } from "./result.ts";
import type { ServerAddress } from "./types.ts";

/** server info text, undefined if unlisted, `unavailable` if the list can't be read */
export type ServerList = (
  address: ServerAddress,
) => Promise<Result<string | undefined, "unavailable">>;

/** placeholder until a real source exists: verify always 503s */
export const unavailableServerList: ServerList = () => Promise.resolve(err("unavailable"));
