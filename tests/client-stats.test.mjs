import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

globalThis.window = { location: { origin: "https://web.example" } };
const { resetStats } = await import("../packages/client/src/net/stats.ts");
const { STATS_URL } = await import("../packages/client/src/net/endpoints.ts");

const DEVICE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NO_CONTENT = 204;
const SERVER_ERROR = 500;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("resetStats sends DELETE with the device id header", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: NO_CONTENT };
  };
  await resetStats(DEVICE_ID);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, STATS_URL);
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(calls[0].init.headers["x-device-id"], DEVICE_ID);
});

test("resetStats throws on a non-2xx answer", async () => {
  globalThis.fetch = async () => ({ ok: false, status: SERVER_ERROR });
  await assert.rejects(resetStats(DEVICE_ID), /stats reset failed: 500/);
});
