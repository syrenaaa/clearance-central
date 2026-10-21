import { assert, assertEquals } from "jsr:@std/assert@^1.0.19";
import { ban, harness, SPEC } from "./helpers.ts";

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
