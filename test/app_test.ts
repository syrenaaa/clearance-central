import { assert, assertEquals } from "jsr:@std/assert@^1.0.19";
import spec from "../openapi.yaml" with { type: "text" };
import { ban, harness } from "./helpers.ts";

Deno.test("unknown routes are 404 with an error body", async () => {
  const h = harness();
  const r = await h.request("GET", "/nope");
  assertEquals(r.status, 404);
  assertEquals(r.body, { error: "not_found" });
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

Deno.test("pages: index, stats, scalar ui, css and the spec, no auth, no db", async () => {
  const h = harness();
  await h.sql.execute({ sql: "DROP TABLE IF EXISTS servers", args: [] });
  for (const path of ["/", "/stats", "/privacy", "/docs"]) {
    const page = await h.request("GET", path);
    assertEquals(page.status, 200, path);
    assertEquals(page.headers.get("content-type"), "text/html; charset=utf-8");
  }
  assert(String((await h.request("GET", "/")).body).includes('href="/docs"'));
  assert(String((await h.request("GET", "/docs")).body).includes("createApiReference"));
  assert(String((await h.request("GET", "/stats")).body).includes("/v1/stats/network"));
  const css = await h.request("GET", "/style.css");
  assertEquals(css.headers.get("content-type"), "text/css; charset=utf-8");
  const yaml = await h.request("GET", "/openapi.yaml");
  assertEquals(yaml.status, 200);
  assertEquals(yaml.body, spec);
});

Deno.test("privacy policy has no unfilled placeholders", async () => {
  const page = await harness().request("GET", "/privacy");
  const left = String(page.body).match(/\[\[\w+\]\]/g) ?? [];
  assertEquals(left, [], "fill these in before deploying");
});

Deno.test("admin page is locked down with a strict csp", async () => {
  const h = harness();
  const page = await h.request("GET", "/admin");
  assertEquals(page.status, 200);
  const csp = page.headers.get("content-security-policy") ?? "";
  assert(csp.includes("script-src 'self'") && !csp.includes("unsafe-inline"), csp);
  assert(csp.includes("frame-ancestors 'none'"), csp);
  assertEquals(page.headers.get("cache-control"), "no-store");
  assert(!String(page.body).includes("<script>"), "no inline scripts");
  const js = await h.request("GET", "/admin.js");
  assertEquals(js.headers.get("content-type"), "text/javascript; charset=utf-8");
});
