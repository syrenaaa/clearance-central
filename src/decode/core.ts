/** shared decoder primitives */

import { err, ok, type Result } from "../result.ts";

/** what failed and where, e.g. path `checks.allow` */
export type DecodeError = { readonly path: string; readonly message: string };

export type Decoder<T> = (input: unknown, path: string) => Result<T, DecodeError>;

export const fail = (path: string, message: string) => err({ path, message });

export const string = (max: number): Decoder<string> => (input, path) => {
  if (typeof input !== "string") return fail(path, "must be a string");
  if (input.length === 0 || input.length > max) return fail(path, `must be 1..${max} characters`);
  return ok(input);
};

export const integer = (min: number, max: number): Decoder<number> => (input, path) => {
  if (typeof input !== "number" || !Number.isInteger(input)) {
    return fail(path, "must be an integer");
  }
  if (input < min || input > max) return fail(path, `must be in ${min}..${max}`);
  return ok(input);
};

export const boolean: Decoder<boolean> = (input, path) =>
  typeof input === "boolean" ? ok(input) : fail(path, "must be a boolean");

export const literal =
  <const T extends string>(values: readonly T[]): Decoder<T> => (input, path) =>
    typeof input === "string" && (values as readonly string[]).includes(input)
      ? ok(input as T)
      : fail(path, `must be one of ${values.join(", ")}`);

export const isRecord = (input: unknown): input is Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input);

export const join = (path: string, key: string) => path === "" ? key : `${path}.${key}`;

type Fields<T> = { readonly [K in keyof T]-?: Decoder<T[K]> };

/** exactly these keys, all required (`additionalProperties: false`) */
export const strictObject = <T>(fields: Fields<T>): Decoder<T> => (input, path) => {
  if (!isRecord(input)) return fail(path, "must be an object");
  const unknown = Object.keys(input).find((k) => !Object.hasOwn(fields, k));
  if (unknown !== undefined) return fail(join(path, unknown), "is not allowed");
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(fields) as (keyof T & string)[]) {
    if (!Object.hasOwn(input, key)) return fail(join(path, key), "is required");
    const field = fields[key](input[key], join(path, key));
    if (!field.ok) return field;
    out[key] = field.value;
  }
  return ok(out as T);
};
