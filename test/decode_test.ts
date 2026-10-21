import { assertEquals } from "jsr:@std/assert@^1.0.19";
import { day, scoreBuckets, serverAddress, userId } from "../src/decode/mod.ts";
import { banRates } from "../src/facts.ts";

Deno.test("userId normalizes like the plugin", () => {
  const r = userId("  76561198000000000@STEAM ", "");
  assertEquals(r.ok && String(r.value), "76561198000000000@steam");
  assertEquals(userId("name@northwood", "").ok, true);
  assertEquals(userId("123@discord", "").ok, true);
  for (const bad of ["", "x", "a@b@steam", "a b@steam", "1@epic", 1, null]) {
    assertEquals(userId(bad, "").ok, false, String(bad));
  }
});

Deno.test("day accepts only real calendar days", () => {
  assertEquals(day("2024-02-29", "").ok, true);
  for (const bad of ["2023-02-29", "2026-13-01", "2026-1-01", "20260101", ""]) {
    assertEquals(day(bad, "").ok, false, bad);
  }
});

Deno.test("scoreBuckets keys are multiples of 10 up to 130", () => {
  assertEquals(scoreBuckets({ "0": 1, "130": 2 }, "s"), { ok: true, value: { 0: 1, 130: 2 } });
  for (const key of ["05", "-10", "140", "1e1", "x"]) {
    assertEquals(scoreBuckets({ [key]: 1 }, "s").ok, false, key);
  }
  assertEquals(scoreBuckets({ "10": 1.5 }, "s"), {
    ok: false,
    error: { path: "s.10", message: "must be an integer" },
  });
});

Deno.test("serverAddress lowercases and rejects junk", () => {
  assertEquals(serverAddress({ address: " Play.Example.COM ", port: 7777 }, ""), {
    ok: true,
    value: { address: "play.example.com", port: 7777 },
  });
  assertEquals(serverAddress({ address: "[2001:db8::1]", port: 1 }, "").ok, true);
  assertEquals(serverAddress({ address: "a/b", port: 1 }, "").ok, false);
  assertEquals(serverAddress({ address: "a", port: 65536 }, "").ok, false);
});

Deno.test("banRates skips buckets without scored checks", () => {
  assertEquals(banRates({ "0": 0, "10": 4 }, { "10": 1, "20": 3 }), { "10": 0.25 });
});
