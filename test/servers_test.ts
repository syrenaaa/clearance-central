import { assertEquals, assertMatch } from "jsr:@std/assert@^1.0.19";
import { ADMIN_KEY, ban, harness, T0 } from "./helpers.ts";

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
