import { assertEquals } from "jsr:@std/assert@^1.0.19";
import { ADMIN_KEY, ban, harness, stats, T0 } from "./helpers.ts";

const USER = "76561198000000001@steam";

type Report = { reportId: string; serverId: string; pardonedAt: number | null };

Deno.test("admin: routes need the admin key", async () => {
  const h = harness();
  const { apiKey } = await h.register();
  for (
    const [m, p] of [
      ["GET", "/v1/servers"],
      ["GET", `/v1/players/${USER}/reports`],
      ["DELETE", `/v1/players/${USER}/reports`],
      ["DELETE", "/v1/reports/rep_x"],
    ]
  ) {
    assertEquals((await h.request(m!, p!)).status, 401, `${m} ${p}`);
    assertEquals((await h.request(m!, p!, { key: apiKey })).status, 401, `${m} ${p} server key`);
  }
});

Deno.test("admin: lists servers, revoked included", async () => {
  const h = harness();
  const a = await h.register("1.1.1.1");
  h.clock.now += 10;
  const b = await h.register("2.2.2.2");
  await h.request("POST", "/v1/reports", { key: a.apiKey, body: ban() });
  await h.request("PUT", "/v1/stats/2026-06-14", { key: a.apiKey, body: stats() });
  await h.request("DELETE", `/v1/servers/${b.serverId}`, { key: ADMIN_KEY });

  const r = await h.request("GET", "/v1/servers", { key: ADMIN_KEY });
  assertEquals(r.status, 200);
  assertEquals((r.body as { servers: unknown[] }).servers, [
    {
      serverId: b.serverId,
      address: "2.2.2.2",
      port: 7777,
      createdAt: T0 + 10,
      revokedAt: T0 + 10,
      bans: 0,
      lastStatsDay: null,
    },
    {
      serverId: a.serverId,
      address: "1.1.1.1",
      port: 7777,
      createdAt: T0,
      revokedAt: null,
      bans: 1,
      lastStatsDay: "2026-06-14",
    },
  ]);
});

Deno.test("admin: a player's reports include expired, pardoned and revoked", async () => {
  const h = harness();
  const [a, b] = [await h.register(), await h.register()];
  const { reportId } = (await h.request("POST", "/v1/reports", { key: a.apiKey, body: ban() }))
    .body as { reportId: string };
  await h.request("POST", "/v1/reports", {
    key: a.apiKey,
    body: { kind: "pardon", clientRef: "p-1", reportId, at: T0 },
  });
  await h.request("POST", "/v1/reports", {
    key: a.apiKey,
    body: ban({ clientRef: "p-2", at: T0 - 7200, duration: 60 }),
  });
  await h.request("POST", "/v1/reports", { key: b.apiKey, body: ban({ at: T0 - 60 }) });
  await h.request("DELETE", `/v1/servers/${b.serverId}`, { key: ADMIN_KEY });

  const r = await h.request("GET", `/v1/players/${encodeURIComponent(" " + USER)}/reports`, {
    key: ADMIN_KEY,
  });
  assertEquals(r.status, 200);
  const { userId, reports } = r.body as { userId: string; reports: Report[] };
  assertEquals(userId, USER);
  assertEquals(reports.length, 3);
  assertEquals(reports.map((x) => x.serverId), [b.serverId, a.serverId, a.serverId]);
  assertEquals(reports.find((x) => x.reportId === reportId)?.pardonedAt, T0);

  // none of them count for lookups
  const facts = await h.request("GET", `/v1/players/${USER}`, { key: a.apiKey });
  assertEquals((facts.body as { activeBans: number }).activeBans, 0);
});

Deno.test("admin: erasing a player deletes their bans + pardons only", async () => {
  const h = harness();
  const a = await h.register();
  const { reportId } = (await h.request("POST", "/v1/reports", { key: a.apiKey, body: ban() }))
    .body as { reportId: string };
  await h.request("POST", "/v1/reports", {
    key: a.apiKey,
    body: { kind: "pardon", clientRef: "p-1", reportId, at: T0 },
  });
  await h.request("POST", "/v1/reports", { key: a.apiKey, body: ban({ clientRef: "p-2" }) });
  await h.request("POST", "/v1/reports", {
    key: a.apiKey,
    body: ban({ clientRef: "p-3", userId: "2@discord" }),
  });

  const r = await h.request("DELETE", `/v1/players/${USER}/reports`, { key: ADMIN_KEY });
  assertEquals(r.body, { deleted: 2 });
  const { rows } = await h.sql.execute({ sql: "SELECT user_id, kind FROM reports", args: [] });
  assertEquals(rows.map((x) => [x.user_id, x.kind]), [["2@discord", "ban"]]);
  assertEquals(
    (await h.request("DELETE", `/v1/players/${USER}/reports`, { key: ADMIN_KEY })).body,
    { deleted: 0 },
  );
  assertEquals(
    (await h.request("GET", "/v1/players/nope/reports", { key: ADMIN_KEY })).status,
    400,
  );
});

Deno.test("admin: deleting one report takes its pardons with it", async () => {
  const h = harness();
  const a = await h.register();
  const { reportId } = (await h.request("POST", "/v1/reports", { key: a.apiKey, body: ban() }))
    .body as { reportId: string };
  await h.request("POST", "/v1/reports", {
    key: a.apiKey,
    body: { kind: "pardon", clientRef: "p-1", reportId, at: T0 },
  });
  await h.request("POST", "/v1/reports", { key: a.apiKey, body: ban({ clientRef: "p-2" }) });

  const del = (id: string) => h.request("DELETE", `/v1/reports/${id}`, { key: ADMIN_KEY });
  assertEquals((await del(reportId)).status, 204);
  assertEquals((await del(reportId)).status, 404);
  assertEquals((await del("not an id")).status, 404);
  const { rows } = await h.sql.execute({ sql: "SELECT client_ref, kind FROM reports", args: [] });
  assertEquals(rows.map((x) => [x.client_ref, x.kind]), [["p-2", "ban"]]);
});
