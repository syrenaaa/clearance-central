import { assertEquals, assertMatch } from "jsr:@std/assert@^1.0.19";
import { RETENTION_SECONDS } from "../src/limits.ts";
import { purge } from "../src/db/mod.ts";
import type { UnixTime } from "../src/types.ts";
import { ban, harness, stats, T0 } from "./helpers.ts";

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
  assertEquals((await post(ban({ duration: undefined }))).status, 400); // required, null = permanent
  assertEquals((await post(ban({ duration: 0 }))).status, 400);
  assertEquals((await post(ban({ duration: "1h" }))).status, 400);
  assertEquals((await post(ban({ category: "rudeness" }))).status, 400);
  assertEquals((await post(ban({ category: "exploiting" }))).status, 400);
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
    lastBan: { at: T0 - 100, expiresAt: null, severity: 5, category: "ban_evasion" },
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

Deno.test("players: expired bans stop counting", async () => {
  const h = harness();
  const a = await h.register();
  const user = "/v1/players/76561198000000001@steam";
  await h.request("POST", "/v1/reports", {
    key: a.apiKey,
    body: ban({ at: T0 - 600, duration: 3600 }),
  });
  // already over when it arrives (queued while offline): accepted, never counts
  await h.request("POST", "/v1/reports", {
    key: a.apiKey,
    body: ban({ clientRef: "p-2", at: T0 - 7200, duration: 60 }),
  });
  const running = await h.request("GET", user, { key: a.apiKey });
  assertEquals(running.body, {
    userId: "76561198000000001@steam",
    distinctServers: 1,
    activeBans: 1,
    lastBan: { at: T0 - 600, expiresAt: T0 + 3000, severity: 3, category: "cheating" },
  });

  h.clock.now = T0 + 3000;
  const over = await h.request("GET", user, { key: a.apiKey });
  assertEquals((over.body as { activeBans: number }).activeBans, 0);
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

  await h.request("PUT", "/v1/stats/2026-06-14", { key: a.apiKey, body: stats() });
  await h.request("PUT", "/v1/stats/2026-06-15", { key: a.apiKey, body: stats() });

  h.clock.now = T0 + RETENTION_SECONDS;
  const facts = await h.request("GET", "/v1/players/76561198000000001@steam", { key: a.apiKey });
  assertEquals((facts.body as { activeBans: number }).activeBans, 1);

  await purge(h.sql, (h.clock.now - RETENTION_SECONDS) as UnixTime, h.clock.now as UnixTime);
  const { rows } = await h.sql.execute({ sql: "SELECT kind FROM reports", args: [] });
  assertEquals(rows.map((r) => r.kind), ["ban"]);
  // stats days age out the same way
  const days = await h.sql.execute({ sql: "SELECT day FROM stats_days", args: [] });
  assertEquals(days.rows.map((r) => r.day), ["2026-06-15"]);
});
