import { assertEquals } from "jsr:@std/assert@^1.0.19";
import { MIN_SERVERS } from "../src/limits.ts";
import { ADMIN_KEY, harness, stats } from "./helpers.ts";

const network = (h: ReturnType<typeof harness>, key: string, from: string, to = from) =>
  h.request("GET", `/v1/stats/network?from=${from}&to=${to}`, { key }).then((r) =>
    r.body as { servers: number; days: number; checks: object }
  );

Deno.test("stats: stores, replaces and sums days", async () => {
  const h = harness();
  const [a, ...rest] = await h.registerMany(MIN_SERVERS);

  const put = await h.request("PUT", "/v1/stats/2026-06-14", { key: a!.apiKey, body: stats() });
  assertEquals(put.status, 200);
  assertEquals(put.body, { stored: true });
  // re-upload replaces, doesn't add
  await h.request("PUT", "/v1/stats/2026-06-14", { key: a!.apiKey, body: stats() });
  for (const s of rest) {
    await h.request("PUT", "/v1/stats/2026-06-14", { key: s.apiKey, body: stats() });
  }
  // a lone day is left out
  await h.request("PUT", "/v1/stats/2026-06-15", { key: a!.apiKey, body: stats() });

  const r = await h.request("GET", "/v1/stats/network?from=2026-06-01&to=2026-06-15", {
    key: a!.apiKey,
  });
  assertEquals(r.status, 200);
  assertEquals(r.body, {
    from: "2026-06-01",
    to: "2026-06-15",
    servers: 5,
    days: 1,
    checks: { allow: 100, flag: 20, deny: 5, bypass: 10 },
    scores: { "0": 50, "30": 50, "60": 20, "100": 5 },
    bansByJoinScore: { "60": 5, "100": 5 },
    banRateByScore: { "0": 0, "30": 0, "60": 0.25, "100": 1 },
  });
});

Deno.test("stats: days with too few servers aren't summed, so they can't be differenced", async () => {
  const h = harness();
  const servers = await h.registerMany(MIN_SERVERS);
  for (const s of servers.slice(1)) {
    await h.request("PUT", "/v1/stats/2026-06-14", { key: s.apiKey, body: stats() });
  }
  const key = servers[0]!.apiKey;
  const few = await network(h, key, "2026-06-14");
  assertEquals([few.servers, few.days, few.checks], [0, 0, {}]);
  await h.request("PUT", "/v1/stats/2026-06-14", { key, body: stats() });
  assertEquals((await network(h, key, "2026-06-14")).days, 1);
});

Deno.test("stats: small days are accepted, not stored, and clear an earlier upload", async () => {
  const h = harness();
  const a = await h.register();
  await h.request("PUT", "/v1/stats/2026-06-14", { key: a.apiKey, body: stats() });
  const small = await h.request("PUT", "/v1/stats/2026-06-14", {
    key: a.apiKey,
    body: stats({ checks: { allow: 19 } }),
  });
  assertEquals(small.status, 200);
  assertEquals(small.body, { stored: false, reason: "too_few_checks" });
  for (const table of ["stats_days", "stats_counts"]) {
    const { rows } = await h.sql.execute({ sql: `SELECT COUNT(*) AS n FROM ${table}`, args: [] });
    assertEquals(Number(rows[0]!.n), 0, table);
  }
});

Deno.test("stats: revoked servers don't count", async () => {
  const h = harness();
  const servers = await h.registerMany(MIN_SERVERS + 1);
  for (const s of servers.slice(0, MIN_SERVERS)) {
    await h.request("PUT", "/v1/stats/2026-06-14", { key: s.apiKey, body: stats() });
  }
  const key = servers[MIN_SERVERS]!.apiKey;
  assertEquals((await network(h, key, "2026-06-14")).servers, MIN_SERVERS);
  await h.request("DELETE", `/v1/servers/${servers[0]!.serverId}`, { key: ADMIN_KEY });
  assertEquals((await network(h, key, "2026-06-14")).servers, 0);
});

Deno.test("stats: validation", async () => {
  const h = harness();
  const { apiKey } = await h.register();
  const put = (day: string, body: unknown) =>
    h.request("PUT", `/v1/stats/${day}`, { key: apiKey, body });

  assertEquals((await put("2026-02-30", stats())).status, 400);
  assertEquals((await put("2026-06-16", stats())).status, 400); // future
  assertEquals((await put("2024-06-01", stats())).status, 400); // past retention
  assertEquals((await put("2026-06-14", stats({ extra: 1 }))).status, 400);
  assertEquals((await put("2026-06-14", stats({ scores: { "5": 1 } }))).status, 400);
  // 130 is open ended, the plugin clamps
  assertEquals((await put("2026-06-14", stats({ scores: { "130": 1 } }))).status, 200);
  assertEquals((await put("2026-06-14", stats({ scores: { "140": 1 } }))).status, 400);
  assertEquals((await put("2026-06-14", stats({ checks: { allow: -1 } }))).status, 400);
  assertEquals((await put("2026-06-14", stats({ checks: { maybe: 1 } }))).status, 400);
  const missing = await put("2026-06-14", { pluginVersion: "1" });
  assertEquals(missing.body, { error: "invalid_stats", message: "enforce is required" });

  const range = (q: string) => h.request("GET", `/v1/stats/network?${q}`, { key: apiKey });
  assertEquals((await range("from=2026-06-02&to=2026-06-01")).status, 400);
  assertEquals((await range("from=2025-01-01&to=2026-06-01")).status, 400);
  assertEquals((await range("from=2026-06-01")).status, 400);
});

Deno.test("stats: network sums are public, uploads aren't", async () => {
  const h = harness();
  const r = await h.request("GET", "/v1/stats/network?from=2026-06-01&to=2026-06-15");
  assertEquals(r.status, 200);
  assertEquals((r.body as { days: number }).days, 0);
  assertEquals((await h.request("PUT", "/v1/stats/2026-06-14", { body: stats() })).status, 401);
});
