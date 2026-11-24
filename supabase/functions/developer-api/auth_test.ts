import { assertEquals } from "jsr:@std/assert";
import { extractBearerKey, sha256Hex } from "./auth.ts";
const k = "d360_live_" + "a".repeat(64);
Deno.test("missing header", () => assertEquals(extractBearerKey(null), null));
Deno.test("malformed", () => {
  assertEquals(extractBearerKey("Basic " + k), null);
  assertEquals(extractBearerKey("Bearer"), null);
  assertEquals(extractBearerKey("Bearer abc"), null);
});
Deno.test("valid", () => assertEquals(extractBearerKey("Bearer " + k), k));
Deno.test("sha256", async () =>
  assertEquals(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
