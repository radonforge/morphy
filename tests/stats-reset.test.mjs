import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const databasePath = join(tmpdir(), `morphy-stats-reset-${process.pid}.db`);
process.env.MORPHY_DB_PATH = databasePath;

const { registerStatsRoute } = await import("../packages/server/src/http.ts");
const { playerStats } = await import("../packages/server/src/stats/repository.ts");

const DEVICE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_DEVICE_ID = "11111111-2222-4333-8444-555555555555";
const WON_ROUND = { won: true, kills: 2, survived: true };
const ZERO = { rounds: 0, wins: 0, kills: 0, survivals: 0 };
const NO_CONTENT = 204;
const BAD_REQUEST = 400;
const SERVER_ERROR = 500;

after(() => {
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
});

function mountRoutes() {
  const handlers = {};
  registerStatsRoute({
    get: (path, handler) => {
      handlers[`GET ${path}`] = handler;
    },
    delete: (path, handler) => {
      handlers[`DELETE ${path}`] = handler;
    },
  });
  return handlers;
}

function call(handler, deviceId) {
  const result = { status: 200, body: undefined, ended: false };
  const res = {
    status(code) {
      result.status = code;
      return res;
    },
    json(body) {
      result.body = body;
    },
    end() {
      result.ended = true;
    },
  };
  handler({ header: () => deviceId }, res);
  return result;
}

test("repository delete erases one device and leaves the others", () => {
  playerStats.recordRound(DEVICE_ID, "Alpha", WON_ROUND);
  playerStats.recordRound(OTHER_DEVICE_ID, "Beta", WON_ROUND);
  playerStats.delete(DEVICE_ID);
  assert.deepEqual(playerStats.get(DEVICE_ID), ZERO);
  assert.equal(playerStats.get(OTHER_DEVICE_ID).rounds, 1);
  playerStats.delete(OTHER_DEVICE_ID);
});

test("repository delete of a device that never played is a no-op", () => {
  assert.doesNotThrow(() => playerStats.delete(DEVICE_ID));
});

test("a device that played again after a delete starts from zero", () => {
  playerStats.recordRound(DEVICE_ID, "Alpha", WON_ROUND);
  playerStats.delete(DEVICE_ID);
  assert.deepEqual(playerStats.recordRound(DEVICE_ID, "Alpha", WON_ROUND), {
    rounds: 1,
    wins: 1,
    kills: 2,
    survivals: 1,
  });
  playerStats.delete(DEVICE_ID);
});

test("DELETE /stats answers 204 and zeroes the device's totals", () => {
  const routes = mountRoutes();
  playerStats.recordRound(DEVICE_ID, "Alpha", WON_ROUND);
  const result = call(routes["DELETE /stats"], DEVICE_ID);
  assert.equal(result.status, NO_CONTENT);
  assert.equal(result.ended, true);
  assert.deepEqual(call(routes["GET /stats"], DEVICE_ID).body, ZERO);
});

test("DELETE /stats for an unknown device is still 204", () => {
  const result = call(mountRoutes()["DELETE /stats"], OTHER_DEVICE_ID);
  assert.equal(result.status, NO_CONTENT);
});

test("DELETE /stats rejects a missing or malformed device id with 400", () => {
  const handler = mountRoutes()["DELETE /stats"];
  for (const bad of [undefined, "", "short", "has spaces in it!!", "x".repeat(65)]) {
    const result = call(handler, bad);
    assert.equal(result.status, BAD_REQUEST);
    assert.equal(result.ended, false);
  }
});

test("DELETE /stats answers 500 and logs only a truncated id when the store fails", () => {
  const handler = mountRoutes()["DELETE /stats"];
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.map(String).join(" "));
  playerStats.close();
  try {
    const result = call(handler, DEVICE_ID);
    assert.equal(result.status, SERVER_ERROR);
    assert.deepEqual(result.body, { error: "stats unavailable" });
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.ok(logged[0].includes(DEVICE_ID.slice(0, 8)));
  assert.ok(!logged[0].includes(DEVICE_ID));
});
