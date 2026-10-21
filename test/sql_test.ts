import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.19";
import { compile, queries, statements, stmt } from "../src/db/sql.ts";

Deno.test("compile turns :names into ?, skipping strings + comments", () => {
  const q = compile(
    "-- since :since\nSELECT ':x', \"a:b\" FROM t WHERE a = :a OR b = :a AND c = :c",
  );
  assertEquals(q.names, ["a", "a", "c"]);
  assertEquals(
    q.sql,
    "-- since :since\nSELECT ':x', \"a:b\" FROM t WHERE a = ? OR b = ? AND c = ?",
  );
});

Deno.test("stmt binds by name and throws on a missing arg", () => {
  const q = compile("SELECT :a, :b, :a");
  assertEquals(stmt(q, { a: 1, b: null }).args, [1, null, 1]);
  assertThrows(() => stmt(q, { a: 1 }), Error, "missing arg :b");
});

Deno.test("queries splits named sections", () => {
  const q = queries("-- name: a\nSELECT 1;\n\n-- name: b\n-- note\nSELECT :x;\n", ["a", "b"]);
  assertEquals(q.a, { sql: "SELECT 1;", names: [] });
  assertEquals(q.b, { sql: "-- note\nSELECT ?;", names: ["x"] });
});

Deno.test("queries throws on a missing name", () => {
  assertThrows(() => queries("-- name: a\nSELECT 1;\n", ["a", "b"]), Error, "missing query: b");
});

Deno.test("statements drops comment-only chunks", () => {
  assertEquals(
    statements("-- hi\n\nCREATE TABLE a (x);\n\n-- why\nCREATE INDEX i ON a (x);\n").map((q) =>
      q.sql
    ),
    ["-- hi\n\nCREATE TABLE a (x)", "-- why\nCREATE INDEX i ON a (x)"],
  );
});
