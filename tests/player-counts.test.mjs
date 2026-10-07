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
const { parsePlayerCounts } = await import("../packages/client/src/net/playerCounts.ts");

const TTL_MS = 5_000;
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
  const counts = cachedFor(async () => ++loads, TTL_MS, now);
  const first = await Promise.all([counts(), counts(), counts()]);
  assert.deepEqual(first, [1, 1, 1]);
  clock.now += TTL_MS - 1;
  assert.equal(await counts(), 1);
  assert.equal(loads, 1);
  clock.now += 1;
  assert.equal(await counts(), 2);
  assert.equal(loads, 2);
});

test("a failed load is not cached, so the next caller loads again", async () => {
  let loads = 0;
  const { now } = clockAt(1_000);
  const counts = cachedFor(
    async () => {
      loads++;
      if (loads === 1) throw new Error("query failed");
      return loads;
    },
    TTL_MS,
    now,
  );
  await assert.rejects(counts(), /query failed/);
  assert.equal(await counts(), 2);
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
