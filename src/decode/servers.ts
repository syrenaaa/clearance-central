/** server address bodies (claims, admin register) */

import { ok } from "../result.ts";
import type { ServerAddress } from "../types.ts";
import { type Decoder, fail, integer, join, strictObject, string } from "./core.ts";

/** hostnames, ipv4, ipv6 literals (lowercased) */
const ADDRESS = /^[a-z0-9.:\[\]-]{1,253}$/;

export const serverAddress: Decoder<ServerAddress> = (input, path) => {
  const r = strictObject<ServerAddress>({
    address: string(253),
    port: integer(1, 65535),
  })(input, path);
  if (!r.ok) return r;
  const address = r.value.address.trim().toLowerCase();
  return ADDRESS.test(address)
    ? ok({ address, port: r.value.port })
    : fail(join(path, "address"), "must be a hostname or IP address");
};
