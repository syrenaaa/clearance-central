import { assertEquals } from "jsr:@std/assert@^1.0.19";
import { ADMIN_KEY, harness, stats } from "./helpers.ts";

Deno.test("stats: stores, replaces and sums days", async () => {
  const h = harness();
  const a = await h.register();
  const b = await h.register();

  const put = await h.request("PUT", "/v1/stats/2026-06-14", { key: a.apiKey, body: stats() });
  assertEquals(put.status, 200);
  assertEquals(put.body, { stored: true });
  // re-upload replaces, doesn't add
  await h.request("PUT", "/v1/stats/2026-06-14", { key: a.apiKey, body: stats() });
  await h.request("PUT", "/v1/stats/2026-06-15", { key: b.apiKey, body: stats() });

  const r = await h.request("GET", "/v1/stats/network?from=2026-06-01&to=2026-06-15", {
    key: a.apiKey,
  });
  assertEquals(r.status, 200);
  assertEquals(r.body, {
    from: "2026-06-01",
    to: "2026-06-15",
    servers: 2,
    checks: { allow: 40, flag: 8, deny: 2, bypass: 4 },
    scores: { "0": 20, "30": 20, "60": 8, "100": 2 },
    bansByJoinScore: { "60": 2, "100": 2 },
    banRateByScore: { "0": 0, "30": 0, "60": 0.25, "100": 1 },
  });

  const one = await h.request("GET", "/v1/stats/network?from=2026-06-15&to=2026-06-15", {
    key: a.apiKey,
  });
  assertEquals((one.body as { servers: number }).servers, 1);
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
  const r = await h.request("GET", "/v1/stats/network?from=2026-06-14&to=2026-06-14", {
    key: a.apiKey,
  });
  assertEquals((r.body as { servers: number }).servers, 0);
  assertEquals((r.body as { checks: object }).checks, {});
});

Deno.test("stats: revoked servers don't count", async () => {
  const h = harness();
  const a = await h.register();
  const b = await h.register();
  await h.request("PUT", "/v1/stats/2026-06-14", { key: a.apiKey, body: stats() });
  await h.request("DELETE", `/v1/servers/${a.serverId}`, { key: ADMIN_KEY });
  const r = await h.request("GET", "/v1/stats/network?from=2026-06-14&to=2026-06-14", {
    key: b.apiKey,
  });
  assertEquals((r.body as { servers: number }).servers, 0);
});

Deno.test("stats: validation", async () => {
  const h = harness();
  const { apiKey } = await h.register();
  const put = (day: string, body: unknown) =>
    h.request("PUT", `/v1/stats/${day}`, { key: apiKey, body });

  assertEquals((await put("2026-02-30", stats())).status, 400);
  assertEquals((await put("2026-06-16", stats())).status, 400); // future
  assertEquals((await put("2026-06-14", stats({ extra: 1 }))).status, 400);
  assertEquals((await put("2026-06-14", stats({ scores: { "5": 1 } }))).status, 400);
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
