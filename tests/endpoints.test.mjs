import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.window = { location: { origin: "https://web.example" } };
const { httpUrlFor } = await import("../packages/client/src/net/endpoints.ts");

test("server endpoints follow the configured Colyseus host and transport", () => {
  assert.equal(httpUrlFor("ws://game.example:2567", "/stats"), "http://game.example:2567/stats");
  assert.equal(
    httpUrlFor("wss://game.example/colyseus?token=secret", "/stats"),
    "https://game.example/stats",
  );
  assert.equal(httpUrlFor("/colyseus", "/player-counts"), "https://web.example/player-counts");
});
