/** req/res helpers */

import type { DecodeError } from "./decode.ts";
import { err, ok, type Result } from "./result.ts";

export const json = (
  status: number,
  body: unknown,
  headers?: HeadersInit,
): Response => Response.json(body, { status, headers });

/** spec `Error` body */
export const fail = (
  status: number,
  error: string,
  message?: string,
  headers?: HeadersInit,
): Response => json(status, message === undefined ? { error } : { error, message }, headers);

export const invalid = (code: string, e: DecodeError): Response =>
  fail(400, code, e.path === "" ? e.message : `${e.path} ${e.message}`);

export const MAX_BODY_BYTES = 16 * 1024;

/** json body, or the 400/413/415 to send instead */
export const readJson = async (
  req: Request,
): Promise<Result<unknown, Response>> => {
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) {
    return err(fail(415, "unsupported_media_type", "send application/json"));
  }
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return err(fail(413, "body_too_large"));
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) return err(fail(413, "body_too_large"));
  try {
    return ok(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return err(fail(400, "invalid_json"));
  }
};

/** token from `Authorization: Bearer <token>` */
export const bearer = (req: Request): string | undefined => {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(
    req.headers.get("authorization") ?? "",
  );
  return match?.[1];
};

/** percent-decoded path segment, undefined if malformed */
export const pathParam = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
};
