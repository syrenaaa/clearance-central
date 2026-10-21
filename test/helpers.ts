import { createClient } from "npm:@libsql/client-wasm@^0.15.15";
import { createApp } from "../src/app.ts";
import type { Sql } from "../src/db.ts";
import { ok } from "../src/result.ts";
import type { ServerList } from "../src/serverlist.ts";
import type { UnixTime } from "../src/types.ts";

export const ADMIN_KEY = "admin-key-for-tests-0123456789abcdef";
/** 2026-06-15T12:00:00Z */
export const T0 = 1_781_524_800;
export const SPEC = "openapi: 3.1.0\n";

export type Harness = {
  readonly sql: Sql;
  readonly clock: { now: number };
  /** server info by `address:port` */
  readonly listed: Map<string, string>;
  request(
    method: string,
    path: string,
    options?: { key?: string; body?: unknown },
  ): Promise<{ status: number; body: unknown; headers: Headers }>;
  /** register via the admin route */
  register(address?: string, port?: number): Promise<{ serverId: string; apiKey: string }>;
};

export const harness = (): Harness => {
  const sql = createClient({ url: ":memory:" }) as unknown as Sql;
  const clock = { now: T0 };
  const listed = new Map<string, string>();
  const serverList: ServerList = ({ address, port }) =>
    Promise.resolve(ok(listed.get(`${address}:${port}`)));
  const app = createApp({
    sql,
    now: () => clock.now as UnixTime,
    adminKey: ADMIN_KEY,
    serverList,
    spec: () => Promise.resolve(SPEC),
  });

  const request: Harness["request"] = async (method, path, options = {}) => {
    const headers = new Headers();
    if (options.key !== undefined) headers.set("authorization", `Bearer ${options.key}`);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    const response = await app(
      new Request(`http://central.test${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      }),
    );
    const text = await response.text();
    return {
      status: response.status,
      body: text === ""
        ? undefined
        : response.headers.get("content-type")?.startsWith("application/json")
        ? JSON.parse(text)
        : text,
      headers: response.headers,
    };
  };

  let next = 0;
  const register: Harness["register"] = async (address, port = 7777) => {
    const r = await request("POST", "/v1/servers", {
      key: ADMIN_KEY,
      body: { address: address ?? `10.0.0.${++next}`, port },
    });
    if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.body)}`);
    return r.body as { serverId: string; apiKey: string };
  };

  return { sql, clock, listed, request, register };
};
