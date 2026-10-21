/** random ids/secrets + hashing. web crypto only */

import { encodeBase64Url } from "jsr:@std/encoding@^1.0.10/base64url";
import { encodeHex } from "jsr:@std/encoding@^1.0.10/hex";

/** `prefix` + `n` random bytes, base64url */
export const randomToken = (prefix: string, n: number): string =>
  prefix + encodeBase64Url(crypto.getRandomValues(new Uint8Array(n)));

/** hex sha-256. secrets are high-entropy, so no slow hash needed */
export const sha256 = async (text: string): Promise<string> =>
  encodeHex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );

/** constant-time secret compare */
export const secretsEqual = async (a: string, b: string): Promise<boolean> => {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
};
