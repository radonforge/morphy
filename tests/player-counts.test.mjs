import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const databasePath = join(tmpdir(), `morphy-player-counts-${process.pid}.db`);
process.env.MORPHY_DB_PATH = databasePath;
globalThis.window = { location: { origin: "https://web.example" } };

const { MAP_CATALOG, PLAYER_COUNTS_PATH } = await import("../packages/shared/src/index.ts");
const { cachedFor, countPlayersByMap } = await import("../packages/server/src/playerCounts.ts");
const { registerPlayerCountsRoute } = await import("../packages/server/src/http.ts");
const { playerStats } = await import("../packages/server/src/stats/repository.ts");
const { fetchPlayerCounts, parsePlayerCounts } = await import(
  "../packages/client/src/net/playerCounts.ts"
);

const TTL_MS = 5_000;
const RETRY_MS = 2_000;
const SERVER_ERROR = 500;

after(() => {
  playerStats.close();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
});

function room(map, clients, extra = {}) {
  return { clients, private: false, locked: false, metadata: { map }, ...extra };
}

function counted(entries) {
  return Object.fromEntries(entries.map(({ map, players }) => [map, players]));
}

test("every catalog map is listed, in catalog order, at zero when nobody plays it", () => {
  const counts = countPlayersByMap([]);
  assert.deepEqual(
    counts.map((entry) => entry.map),
    MAP_CATALOG.map((info) => info.id),
  );
  assert.ok(counts.every((entry) => entry.players === 0));
});

test("public rooms add up per map, locked ones included", () => {
  const counts = counted(
    countPlayersByMap([
      room("urban", 3),
      room("urban", 2, { locked: true }),
      room("station", 4, { locked: true }),
    ]),
  );
  assert.equal(counts.urban, 5);
  assert.equal(counts.station, 4);
});

test("private rooms and rooms with no known map are never counted", () => {
  const counts = counted(
    countPlayersByMap([
      room("urban", 6, { private: true }),
      room("mars", 3),
      { clients: 2, private: false },
      room("station", 1),
    ]),
  );
  assert.equal(counts.urban, 0);
  assert.equal(counts.station, 1);
  assert.equal(Object.keys(counts).length, MAP_CATALOG.length);
});

function clockAt(start) {
  const clock = { now: start };
  return { clock, now: () => clock.now };
}

test("the cached load runs once per TTL however many callers ask", async () => {
  let loads = 0;
  const { clock, now } = clockAt(1_000);
  const counts = cachedFor(async () => ++loads, TTL_MS, RETRY_MS, now);
  const first = await Promise.all([counts(), counts(), counts()]);
  assert.deepEqual(first, [1, 1, 1]);
  clock.now += TTL_MS - 1;
  assert.equal(await counts(), 1);
  assert.equal(loads, 1);
  clock.now += 1;
  assert.equal(await counts(), 2);
  assert.equal(loads, 2);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("a load in flight is shared, so no second load starts until it settles", async () => {
  const loads = [];
  const { clock, now } = clockAt(1_000);
  const counts = cachedFor(
    () => {
      const load = deferred();
      loads.push(load);
      return load.promise;
    },
    TTL_MS,
    RETRY_MS,
    now,
  );
  const first = counts();
  clock.now += TTL_MS * 10;
  const second = counts();
  assert.equal(second, first);
  assert.equal(loads.length, 1);
  loads[0].resolve(7);
  assert.deepEqual(await Promise.all([first, second]), [7, 7]);
});

test("a failed load is kept for the retry window, then loaded again", async () => {
  let loads = 0;
  const { clock, now } = clockAt(1_000);
  const counts = cachedFor(
    async () => {
      loads++;
      if (loads === 1) throw new Error("query failed");
      return loads;
    },
    TTL_MS,
    RETRY_MS,
    now,
  );
  const failed = counts();
  await assert.rejects(failed, /query failed/);
  for (let call = 0; call < 100; call++) assert.equal(counts(), failed);
  clock.now += RETRY_MS - 1;
  await assert.rejects(counts(), /query failed/);
  assert.equal(loads, 1);
  clock.now += 1;
  assert.equal(await counts(), 2);
  assert.equal(loads, 2);
});

test("a success keeps the TTL and a failure the retry window, whichever came before", async () => {
  const outcomes = [1, "fail", 3, "fail"];
  let loads = 0;
  const { clock, now } = clockAt(1_000);
  const counts = cachedFor(
    async () => {
      const outcome = outcomes[loads++];
      if (outcome === "fail") throw new Error("query failed");
      return outcome;
    },
    TTL_MS,
    RETRY_MS,
    now,
  );
  assert.equal(await counts(), 1);
  clock.now += TTL_MS;
  await assert.rejects(counts(), /query failed/);
  clock.now += RETRY_MS;
  assert.equal(await counts(), 3);
  clock.now += TTL_MS - 1;
  assert.equal(await counts(), 3);
  assert.equal(loads, 3);
  clock.now += 1;
  await assert.rejects(counts(), /query failed/);
  assert.equal(loads, 4);
});

function mountRoute(counts) {
  let handler;
  registerPlayerCountsRoute(
    {
      get: (path, registered) => {
        assert.equal(path, PLAYER_COUNTS_PATH);
        handler = registered;
      },
    },
    counts,
  );
  return () =>
    new Promise((resolve) => {
      const response = { status: 200 };
      const res = {
        status(code) {
          response.status = code;
          return res;
        },
        json(body) {
          response.body = body;
          resolve(response);
        },
        end() {
          resolve(response);
        },
      };
      handler({ header: () => undefined }, res);
    });
}

test("the route serves the counts, and a 500 with no detail when the query fails", async () => {
  const body = countPlayersByMap([room("urban", 2)]);
  assert.deepEqual(await mountRoute(async () => body)(), { status: 200, body });
  const originalError = console.error;
  console.error = () => {};
  try {
    const failed = await mountRoute(async () => {
      throw new Error("driver down");
    })();
    assert.equal(failed.status, SERVER_ERROR);
    assert.doesNotMatch(JSON.stringify(failed.body), /driver down/);
  } finally {
    console.error = originalError;
  }
});

function rejected(reason) {
  const failure = Promise.reject(reason);
  failure.catch(() => {});
  return failure;
}

test("the route logs a cached failure once, and the next failure again", async () => {
  let failure = rejected("driver down");
  const route = mountRoute(() => failure);
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args);
  try {
    for (let call = 0; call < 3; call++) assert.equal((await route()).status, SERVER_ERROR);
    assert.equal(logged.length, 1);
    failure = rejected("driver down");
    assert.equal((await route()).status, SERVER_ERROR);
    assert.equal(logged.length, 2);
  } finally {
    console.error = originalError;
  }
});

test("the client warns once when the counts path answers with something other than JSON", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings = [];
  globalThis.fetch = async () =>
    new Response("<!doctype html>", { headers: { "content-type": "text/html" } });
  console.warn = (...args) => warnings.push(args);
  try {
    const signal = new AbortController().signal;
    await assert.rejects(fetchPlayerCounts(signal), /not JSON/);
    await assert.rejects(fetchPlayerCounts(signal), /not JSON/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /not proxied/);
});

test("the client reads the counts it knows and refuses a malformed body", () => {
  const counts = parsePlayerCounts([
    { map: "urban", players: 3 },
    { map: "station", players: 0 },
    { map: "moon", players: 9 },
  ]);
  assert.deepEqual(
    [...counts],
    [
      ["urban", 3],
      ["station", 0],
    ],
  );
  assert.throws(() => parsePlayerCounts({ urban: 3 }));
  assert.throws(() => parsePlayerCounts([{ map: "urban", players: -1 }]));
  assert.throws(() => parsePlayerCounts([{ map: "urban", players: "3" }]));
  assert.throws(() => parsePlayerCounts([null]));
});
