import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.window = { location: { origin: "https://web.example" } };
const { statsUrlFor } = await import("../packages/client/src/net/endpoints.ts");

test("stats endpoint follows the configured Colyseus host and transport", () => {
  assert.equal(statsUrlFor("ws://game.example:2567"), "http://game.example:2567/stats");
  assert.equal(
    statsUrlFor("wss://game.example/colyseus?token=secret"),
    "https://game.example/stats",
  );
  assert.equal(statsUrlFor("/colyseus"), "https://web.example/stats");
});
