import { assert, assertEquals, assertMatch } from "jsr:@std/assert@^1.0.19";
import { RETENTION_SECONDS } from "../src/app.ts";
import { purge } from "../src/db.ts";
import type { UnixTime } from "../src/types.ts";
import { ADMIN_KEY, harness, SPEC, T0 } from "./helpers.ts";

const stats = (overrides: Record<string, unknown> = {}) => ({
  pluginVersion: "1.0.0",
  enforce: true,
  thresholds: { allowScore: 40, flagScore: 70 },
  checks: { allow: 20, flag: 4, deny: 1, bypass: 2 },
  scores: { "0": 10, "30": 10, "60": 4, "100": 1 },
  bansByJoinScore: { "60": 1, "100": 1 },
  ...overrides,
});

const ban = (overrides: Record<string, unknown> = {}) => ({
  kind: "ban",
  clientRef: "p-1",
  userId: "76561198000000001@steam",
  at: T0 - 3600,
  severity: 3,
  category: "cheating",
  ...overrides,
});

Deno.test("auth: server routes need a live key", async () => {
  const h = harness();
  const none = await h.request("GET", "/v1/players/1@steam");
  assertEquals(none.status, 401);
  assertEquals(none.headers.get("www-authenticate"), "Bearer");
  assertEquals((await h.request("GET", "/v1/players/1@steam", { key: "nope" })).status, 401);
  const { apiKey } = await h.register();
  assertEquals((await h.request("GET", "/v1/players/1@steam", { key: apiKey })).status, 200);
});

Deno.test("auth: admin routes need the admin key", async () => {
  const h = harness();
  const { apiKey } = await h.register();
  const r = await h.request("POST", "/v1/servers", {
    key: apiKey,
    body: { address: "1.2.3.4", port: 7777 },
  });
  assertEquals(r.status, 401);
});

Deno.test("unknown routes are 404 with an error body", async () => {
  const h = harness();
  const r = await h.request("GET", "/nope");
  assertEquals(r.status, 404);
  assertEquals(r.body, { error: "not_found" });
});

Deno.test("servers: registering the same address again rotates the key", async () => {
  const h = harness();
  const a = await h.register("play.example.com", 7777);
  const b = await h.register("PLAY.example.com", 7777);
  assertEquals(a.serverId, b.serverId);
  assertMatch(a.serverId, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assertMatch(b.apiKey, /^cck_/);
  assertEquals((await h.request("GET", "/v1/players/1@steam", { key: a.apiKey })).status, 401);
  assertEquals((await h.request("GET", "/v1/players/1@steam", { key: b.apiKey })).status, 200);
});

Deno.test("servers: revoking hides the key and the reports", async () => {
  const h = harness();
  const a = await h.register();
  const b = await h.register();
  await h.request("POST", "/v1/reports", { key: a.apiKey, body: ban() });

  const before = await h.request("GET", "/v1/players/76561198000000001@steam", { key: b.apiKey });
  assertEquals((before.body as { activeBans: number }).activeBans, 1);

  const revoke = await h.request("DELETE", `/v1/servers/${a.serverId}`, { key: ADMIN_KEY });
  assertEquals(revoke.status, 204);
  assertEquals(
    (await h.request("DELETE", `/v1/servers/${a.serverId}`, { key: ADMIN_KEY })).status,
    404,
  );
  assertEquals((await h.request("GET", "/v1/players/1@steam", { key: a.apiKey })).status, 401);

  const after = await h.request("GET", "/v1/players/76561198000000001@steam", { key: b.apiKey });
  assertEquals((after.body as { activeBans: number }).activeBans, 0);
});

Deno.test("claims: verify checks the token in the Server Info", async () => {
  const h = harness();
  const claim = await h.request("POST", "/v1/servers/claims", {
    body: { address: "5.6.7.8", port: 7777 },
  });
  assertEquals(claim.status, 201);
  const { claimId, token, expiresAt } = claim.body as {
    claimId: string;
    token: string;
    expiresAt: number;
  };
  assertEquals(expiresAt, T0 + 3600);

  const notListed = await h.request("POST", `/v1/servers/claims/${claimId}/verify`);
  assertEquals(notListed.status, 409);
  assertEquals((notListed.body as { error: string }).error, "server_not_listed");

  h.listed.set("5.6.7.8:7777", "Welcome!");
  const noToken = await h.request("POST", `/v1/servers/claims/${claimId}/verify`);
  assertEquals((noToken.body as { error: string }).error, "token_not_found");

  h.listed.set("5.6.7.8:7777", `Welcome! <size=0>${token}</size>`);
  const ok = await h.request("POST", `/v1/servers/claims/${claimId}/verify`);
  assertEquals(ok.status, 200);
  const { apiKey } = ok.body as { apiKey: string };
  assertEquals((await h.request("GET", "/v1/players/1@steam", { key: apiKey })).status, 200);

  // single use
  assertEquals((await h.request("POST", `/v1/servers/claims/${claimId}/verify`)).status, 404);
});

Deno.test("claims: expire and are limited per address", async () => {
  const h = harness();
  const make = () =>
    h.request("POST", "/v1/servers/claims", { body: { address: "5.6.7.8", port: 7777 } });
  const first = await make();
  for (let i = 0; i < 4; i++) assertEquals((await make()).status, 201);
  const limited = await make();
  assertEquals(limited.status, 429);
  assertEquals(limited.headers.get("retry-after"), "3600");

  h.clock.now += 3600;
  const { claimId } = first.body as { claimId: string };
  assertEquals((await h.request("POST", `/v1/servers/claims/${claimId}/verify`)).status, 404);
  assertEquals((await make()).status, 201);
});

Deno.test("claims: bad input", async () => {
  const h = harness();
  const r = await h.request("POST", "/v1/servers/claims", {
    body: { address: "bad address!", port: 7777 },
  });
  assertEquals(r.status, 400);
  assertEquals((await h.request("POST", "/v1/servers/claims", { body: { port: 0 } })).status, 400);
});

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

Deno.test("reports: bans are idempotent per clientRef", async () => {
  const h = harness();
  const { apiKey } = await h.register();
  const first = await h.request("POST", "/v1/reports", { key: apiKey, body: ban() });
  assertEquals(first.status, 201);
  const report = first.body as { reportId: string; kind: string; receivedAt: number };
  assertMatch(report.reportId, /^rep_/);
  assertEquals(report.kind, "ban");
  assertEquals(report.receivedAt, T0);

  h.clock.now += 10;
  const again = await h.request("POST", "/v1/reports", { key: apiKey, body: ban() });
  assertEquals(again.status, 200);
  assertEquals(again.body, report);
});

Deno.test("reports: pardons", async () => {
  const h = harness();
  const a = await h.register();
  const b = await h.register();
  const { reportId } = (await h.request("POST", "/v1/reports", { key: a.apiKey, body: ban() }))
    .body as { reportId: string };

  // only the reporting server can pardon
  const pardon = { kind: "pardon", clientRef: "p-1", reportId, at: T0 };
  const foreign = await h.request("POST", "/v1/reports", { key: b.apiKey, body: pardon });
  assertEquals(foreign.status, 404);
  const unknown = await h.request("POST", "/v1/reports", {
    key: a.apiKey,
    body: { ...pardon, reportId: "rep_nope" },
  });
  assertEquals(unknown.status, 404);

  // same clientRef as the ban is fine, uniqueness is per kind
  const ok = await h.request("POST", "/v1/reports", { key: a.apiKey, body: pardon });
  assertEquals(ok.status, 201);
  assertEquals((ok.body as { kind: string }).kind, "pardon");
  assertEquals(
    (await h.request("POST", "/v1/reports", { key: a.apiKey, body: pardon })).status,
    200,
  );

  const facts = await h.request("GET", "/v1/players/76561198000000001@steam", { key: b.apiKey });
  assertEquals((facts.body as { activeBans: number }).activeBans, 0);
});

Deno.test("reports: validation", async () => {
  const h = harness();
  const { apiKey } = await h.register();
  const post = (body: unknown) => h.request("POST", "/v1/reports", { key: apiKey, body });

  assertEquals((await post(ban({ kind: "warn" }))).status, 400);
  assertEquals((await post(ban({ severity: 6 }))).status, 400);
  assertEquals((await post(ban({ category: "rudeness" }))).status, 400);
  assertEquals((await post(ban({ userId: "someone" }))).status, 400);
  assertEquals((await post(ban({ ip: "1.2.3.4" }))).status, 400);
  assertEquals((await post(ban({ at: T0 + 3600 }))).status, 400);
  assertEquals((await post(ban({ at: T0 - RETENTION_SECONDS - 1 }))).status, 400);
  assertEquals((await post({ kind: "pardon", clientRef: "x", at: T0 })).status, 400);

  const notJson = await h.request("POST", "/v1/reports", { key: apiKey });
  assertEquals(notJson.status, 415);
});

Deno.test("players: facts across servers", async () => {
  const h = harness();
  const [a, b, c] = [await h.register(), await h.register(), await h.register()];
  const user = "76561198000000001@steam";
  await h.request("POST", "/v1/reports", { key: a.apiKey, body: ban({ at: T0 - 300 }) });
  await h.request("POST", "/v1/reports", {
    key: a.apiKey,
    body: ban({ clientRef: "p-2", at: T0 - 200, severity: 1, category: "griefing" }),
  });
  await h.request("POST", "/v1/reports", {
    key: b.apiKey,
    body: ban({ at: T0 - 100, severity: 5, category: "ban_evasion" }),
  });

  // trimmed + lowercased like the plugin
  const r = await h.request("GET", `/v1/players/${encodeURIComponent(" " + user.toUpperCase())}`, {
    key: c.apiKey,
  });
  assertEquals(r.status, 200);
  assertEquals(r.body, {
    userId: user,
    distinctServers: 2,
    activeBans: 3,
    lastBan: { at: T0 - 100, severity: 5, category: "ban_evasion" },
  });

  const nobody = await h.request("GET", "/v1/players/2@discord", { key: c.apiKey });
  assertEquals(nobody.body, {
    userId: "2@discord",
    distinctServers: 0,
    activeBans: 0,
    lastBan: null,
  });
  assertEquals((await h.request("GET", "/v1/players/nobody", { key: c.apiKey })).status, 400);
});

Deno.test("retention: old bans stop counting and get purged", async () => {
  const h = harness();
  const a = await h.register();
  const { reportId } = (await h.request("POST", "/v1/reports", { key: a.apiKey, body: ban() }))
    .body as { reportId: string };
  await h.request("POST", "/v1/reports", {
    key: a.apiKey,
    body: { kind: "pardon", clientRef: "x", reportId, at: T0 },
  });
  await h.request("POST", "/v1/reports", {
    key: a.apiKey,
    body: ban({ clientRef: "p-2", at: T0 }),
  });

  h.clock.now = T0 + RETENTION_SECONDS;
  const facts = await h.request("GET", "/v1/players/76561198000000001@steam", { key: a.apiKey });
  assertEquals((facts.body as { activeBans: number }).activeBans, 1);

  await purge(h.sql, (h.clock.now - RETENTION_SECONDS) as UnixTime, h.clock.now as UnixTime);
  const { rows } = await h.sql.execute({ sql: "SELECT kind FROM reports", args: [] });
  assertEquals(rows.map((r) => r.kind), ["ban"]);
});

Deno.test("database errors become a 500 the plugin can retry", async () => {
  const h = harness();
  const { apiKey } = await h.register();
  await h.sql.execute({ sql: "DROP TABLE reports", args: [] });
  const error = console.error;
  console.error = () => {};
  try {
    const r = await h.request("POST", "/v1/reports", { key: apiKey, body: ban() });
    assertEquals(r.status, 500);
    assert(typeof (r.body as { error: string }).error === "string");
  } finally {
    console.error = error;
  }
});

Deno.test("docs: scalar ui and the spec, no auth, no db", async () => {
  const h = harness();
  await h.sql.execute({ sql: "DROP TABLE IF EXISTS servers", args: [] });
  const page = await h.request("GET", "/");
  assertEquals(page.status, 200);
  assertEquals(page.headers.get("content-type"), "text/html; charset=utf-8");
  const spec = await h.request("GET", "/openapi.yaml");
  assertEquals(spec.status, 200);
  assertEquals(spec.body, SPEC);
});
