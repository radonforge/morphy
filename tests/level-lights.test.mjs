import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  addLight,
  addRoom,
  compileLevel,
  DEFAULT_ROOM_LIGHT_COUNT,
  deckLightsFor,
  formatLevelDocument,
  LevelValidationError,
  moveLight,
  parseLevelDocument,
  pickDeckLights,
  proposeLights,
  removeLight,
  removeRoom,
  resizeRoom,
  toggleDoor,
  validateLevel,
} from "../packages/level/src/index.ts";
import { wallRects } from "../packages/level/src/walls.ts";
import { buildMap } from "../packages/server/src/maps/index.ts";
import { SPACE_CATALOG } from "../packages/server/src/spaceCatalog.ts";
import { ASSET_CARDS, ASSET_TAGS, parseMapDefinition } from "../packages/shared/src/index.ts";

const ROOM_COUNT = DEFAULT_ROOM_LIGHT_COUNT;
const SEEDS = [1, 7, 42];

function roomLights(map) {
  return pickDeckLights(map, ROOM_COUNT).filter((light) => light.kind === "room");
}

test("the station gets the asked number of room lights and one corridor light per hunter spawn", () => {
  for (const seed of SEEDS) {
    const map = buildMap("station", seed);
    const lights = pickDeckLights(map, ROOM_COUNT);
    assert.equal(lights.filter((light) => light.kind === "room").length, ROOM_COUNT);
    assert.deepEqual(
      lights.filter((light) => light.kind === "corridor").map(({ x, z }) => ({ x, z })),
      map.spawnPoints.hunters.map(({ x, z }) => ({ x, z })),
    );
  }
});

test("room lights hang clear of every wall", () => {
  const clearance = 2.9;
  for (const seed of SEEDS) {
    const map = buildMap("station", seed);
    const walls = map.colliders.filter((c) => c.position.y + c.size.y / 2 > 0);
    for (const light of roomLights(map)) {
      for (const wall of walls) {
        const dx = Math.max(Math.abs(light.x - wall.position.x) - wall.size.x / 2, 0);
        const dz = Math.max(Math.abs(light.z - wall.position.z) - wall.size.z / 2, 0);
        assert.ok(Math.hypot(dx, dz) >= clearance, `seed ${seed}: light at ${light.x},${light.z}`);
      }
    }
  }
});

test("the same layout always hangs the same lights", () => {
  const map = buildMap("station", 7);
  assert.deepEqual(pickDeckLights(map, ROOM_COUNT), pickDeckLights(map, ROOM_COUNT));
});

test("a map with no furniture gets its corridor lights only", () => {
  const map = { ...buildMap("station", 1), props: [] };
  assert.ok(pickDeckLights(map, ROOM_COUNT).every((light) => light.kind === "corridor"));
});

const CONTEXT = { catalog: SPACE_CATALOG, cards: ASSET_CARDS, tags: ASSET_TAGS };

/** Two rooms either side of a one-column hall, one door into each; the walls stand on x = -2 and x = 2. */
function hall(lights) {
  return {
    version: 1,
    id: "station",
    grid: { cols: 5, rows: 3 },
    rooms: [
      { id: "west", rects: [{ i0: 0, i1: 2, j0: 0, j1: 3 }] },
      { id: "hall", rects: [{ i0: 2, i1: 3, j0: 0, j1: 3 }] },
      { id: "east", rects: [{ i0: 3, i1: 5, j0: 0, j1: 3 }] },
    ],
    doors: [
      { axis: "v", line: 2, cell: 1 },
      { axis: "v", line: 3, cell: 1 },
    ],
    objects: [
      { id: "west-1", type: "chair", x: -7, z: -2, yaw: 0 },
      { id: "east-1", type: "table", x: 6, z: 1, yaw: 0 },
    ],
    spawns: { props: [{ x: -6, z: 2 }], hunters: [{ x: 0, z: 0 }] },
    ...(lights === undefined ? {} : { lights }),
  };
}

const LAMP = { id: "light-1", x: -6, z: 0, kind: "room" };

function parse(lights) {
  return parseLevelDocument(hall(lights), { catalog: SPACE_CATALOG });
}

function stationDocument(path = "../packages/server/src/maps/station.level.json") {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  return parseLevelDocument(JSON.parse(text), { catalog: SPACE_CATALOG, id: "station" });
}

test("a document parses its lights as written and stays without the field when it has none", () => {
  assert.deepEqual(parse([LAMP, { id: "beacon", x: 0, z: -4, kind: "corridor" }]).lights, [
    LAMP,
    { id: "beacon", x: 0, z: -4, kind: "corridor" },
  ]);
  assert.equal("lights" in parse(undefined), false);
  assert.deepEqual(parse([]).lights, []);
});

const BAD_LIGHTS = [
  ["a non-array", "lamps", "lights"],
  ["a missing id", [{ x: -6, z: 0, kind: "room" }], "lights[0]"],
  ["a repeated id", [LAMP, { ...LAMP, x: -5 }], 'light "light-1"'],
  ["an unknown kind", [{ ...LAMP, kind: "spot" }], 'light "light-1"'],
  ["a non-finite coordinate", [{ ...LAMP, x: Number.NaN }], 'light "light-1"'],
  ["a spot off the map", [{ ...LAMP, x: 11 }], 'light "light-1"'],
  ["a spot inside a wall", [{ ...LAMP, x: -2, z: -4 }], 'light "light-1"'],
  ["a spot inside the outer wall", [{ ...LAMP, x: -10, z: 0 }], 'light "light-1"'],
];

for (const [name, lights, entity] of BAD_LIGHTS) {
  test(`parsing refuses ${name}`, () => {
    assert.throws(
      () => parse(lights),
      (error) =>
        error instanceof LevelValidationError && error.entityId === entity && error.hint.length > 0,
    );
  });
}

test("a doorway is not a wall, so a light may hang in it", () => {
  assert.equal(parse([{ ...LAMP, x: -2, z: 0 }]).lights.length, 1);
});

test("compiling carries the document lights and adds no field without them", () => {
  const withLights = compileLevel(parse([LAMP]), { catalog: SPACE_CATALOG, seed: 1 });
  assert.deepEqual(withLights.lights, [LAMP]);
  assert.deepEqual(parseMapDefinition(JSON.parse(JSON.stringify(withLights))).lights, [LAMP]);
  const without = compileLevel(parse(undefined), { catalog: SPACE_CATALOG, seed: 1 });
  assert.equal("lights" in without, false);
  assert.equal("lights" in parseMapDefinition(JSON.parse(JSON.stringify(without))), false);
});

test("a map definition with a repeated light id is refused and extra light fields are dropped", () => {
  const map = compileLevel(parse(undefined), { catalog: SPACE_CATALOG, seed: 1 });
  assert.throws(
    () => parseMapDefinition({ ...map, lights: [LAMP, { ...LAMP, x: -5 }] }),
    /duplicate id/,
  );
  assert.deepEqual(parseMapDefinition({ ...map, lights: [{ ...LAMP, extra: 1 }] }).lights, [LAMP]);
});

test("a map definition with malformed lights is refused", () => {
  const map = compileLevel(parse(undefined), { catalog: SPACE_CATALOG, seed: 1 });
  for (const lights of [
    "x",
    [{ id: "a", x: 0, z: 0, kind: "spot" }],
    [{ x: 0, z: 0, kind: "room" }],
  ]) {
    assert.throws(() => parseMapDefinition({ ...map, lights }), /lights/);
  }
});

test("the seven-room station hangs exactly the lights the client used to pick", () => {
  const doc = stationDocument("./fixtures/station-seven-rooms.level.json");
  const picked = pickDeckLights(
    compileLevel({ ...doc, lights: undefined }, { catalog: SPACE_CATALOG, seed: 1 }),
    DEFAULT_ROOM_LIGHT_COUNT,
  );
  assert.equal(picked.length, 23);
  assert.deepEqual(doc.lights, picked);
});

test("every seed hangs the station document's own lights", () => {
  const { lights } = stationDocument();
  for (const seed of SEEDS) {
    const map = buildMap("station", seed);
    assert.deepEqual(map.lights, lights);
    assert.deepEqual(deckLightsFor(map, DEFAULT_ROOM_LIGHT_COUNT), lights);
  }
});

test("the station's lights raise no wall clearance finding", () => {
  const report = validateLevel(stationDocument(), CONTEXT);
  assert.deepEqual(
    report.findings.filter((finding) => finding.code === "light.wall-clearance"),
    [],
  );
});

test("a map without lights falls back to the picked ones", () => {
  const { lights: _lights, ...map } = buildMap("station", 1);
  assert.deepEqual(
    deckLightsFor(map, DEFAULT_ROOM_LIGHT_COUNT),
    pickDeckLights(map, DEFAULT_ROOM_LIGHT_COUNT),
  );
});

test("a map with an empty lights list hangs none instead of falling back", () => {
  const map = { ...buildMap("station", 1), lights: [] };
  assert.deepEqual(deckLightsFor(map, DEFAULT_ROOM_LIGHT_COUNT), []);
});

function clearance(doc) {
  return validateLevel(doc, CONTEXT).findings.filter(
    (entry) => entry.code === "light.wall-clearance",
  );
}

/** Two 12 x 20 m rooms side by side on a 6 x 5 grid: one wall on x = 0, far from the outer ones. */
function wide(lights) {
  return parseLevelDocument(
    {
      version: 1,
      id: "station",
      grid: { cols: 6, rows: 5 },
      rooms: [
        { id: "west", rects: [{ i0: 0, i1: 3, j0: 0, j1: 5 }] },
        { id: "east", rects: [{ i0: 3, i1: 6, j0: 0, j1: 5 }] },
      ],
      doors: [],
      objects: [],
      spawns: { props: [{ x: -6, z: 2 }], hunters: [{ x: 6, z: 2 }] },
      ...(lights === undefined ? {} : { lights }),
    },
    { catalog: SPACE_CATALOG },
  );
}

test("a room light hung near a wall is reported with a move that clears every wall", () => {
  const doc = parse([{ ...LAMP, x: -6, z: -5 }]);
  const [finding] = clearance(doc);
  assert.deepEqual(finding.entities, ["light-1"]);
  assert.equal(finding.hint, "pnpm level light move light-1 --to=-6,-2.5");
  const moved = moveLight(doc, { id: "light-1", to: { x: -6, z: -2.5 } });
  assert.deepEqual(clearance(moved.doc), []);
});

test("a room light on a wall face is pushed out through that face, not back into the wall", () => {
  const base = wide(undefined);
  const west = { ...base, lights: [{ ...LAMP, x: -0.5, z: 0 }] };
  const [finding] = clearance(west);
  assert.match(finding.message, /is 0 m from a wall/);
  assert.equal(finding.hint, "pnpm level light move light-1 --to=-3.5,0");
  assert.deepEqual(clearance(moveLight(west, { id: "light-1", to: { x: -3.5, z: 0 } }).doc), []);
  const east = { ...base, lights: [{ ...LAMP, x: 0.5, z: 3 }] };
  assert.equal(clearance(east)[0].hint, "pnpm level light move light-1 --to=3.5,3");
});

test("a room light a hair off a wall face gets the same push", () => {
  const doc = parseLevelDocument(
    { ...wide(undefined), lights: [{ ...LAMP, x: -0.5001, z: 0 }] },
    { catalog: SPACE_CATALOG },
  );
  assert.equal(clearance(doc)[0].hint, "pnpm level light move light-1 --to=-3.5,0");
});

test("when the push would land near another wall the hint gives a distance instead of a spot", () => {
  const doc = parse([{ ...LAMP, x: -2.5001, z: -4 }]);
  const [finding] = clearance(doc);
  assert.equal(finding.hint, "move it at least 3 m away from the wall");
});

test("a corridor light is not held to the wall clearance", () => {
  const doc = parse([{ id: "beacon", x: 0, z: 0, kind: "corridor" }]);
  assert.equal(
    validateLevel(doc, CONTEXT).findings.some((entry) => entry.code === "light.wall-clearance"),
    false,
  );
});

test("adding a light snaps it, names it by kind and refuses walls and repeated ids", () => {
  const first = addLight(parse(undefined), { at: { x: -6.2, z: 0.1 } });
  assert.ok(first.ok);
  assert.deepEqual(first.doc.lights, [LAMP]);
  const second = addLight(first.doc, { at: { x: 0, z: -4 }, kind: "corridor" });
  assert.equal(second.doc.lights[1].id, "light-2");
  const third = addLight(second.doc, { at: { x: -5, z: 0 } });
  assert.equal(third.doc.lights[2].id, "light-3");
  assert.equal(addLight(third.doc, { at: { x: 1, z: 1 }, id: "light-1" }).ok, false);
  const walled = addLight(third.doc, { at: { x: -2, z: -4 } });
  assert.equal(walled.ok, false);
  assert.equal(walled.findings[0].code, "op.blocked");
  assert.equal(walled.doc, third.doc);
  assert.equal(addLight(third.doc, { at: { x: 11, z: 0 } }).ok, false);
});

test("an added light is written in the order the parser reads it back", () => {
  const text = formatLevelDocument(addLight(parse(undefined), { at: { x: -6, z: 0 } }).doc);
  const reread = parseLevelDocument(JSON.parse(text), { catalog: SPACE_CATALOG });
  assert.equal(formatLevelDocument(reread), text);
});

test("adding or moving a light to a non-finite spot or with an empty id is refused by the op", () => {
  const doc = parse([LAMP]);
  assert.equal(addLight(doc, { at: { x: Number.NaN, z: 0 } }).findings[0].code, "op.invalid");
  assert.equal(addLight(doc, { at: { x: 1, z: 1 }, id: "" }).findings[0].code, "op.invalid");
  assert.equal(
    moveLight(doc, { id: "light-1", to: { x: Number.POSITIVE_INFINITY, z: 0 } }).ok,
    false,
  );
});

test("moving a light needs exactly one target and refuses a wall", () => {
  const doc = parse([LAMP]);
  const moved = moveLight(doc, { id: "light-1", by: { x: 1, z: 0.5 } });
  assert.deepEqual(moved.doc.lights, [{ ...LAMP, x: -5, z: 0.5 }]);
  assert.equal(moveLight(doc, { id: "light-1" }).ok, false);
  assert.equal(moveLight(doc, { id: "nope", to: { x: 0, z: 0 } }).ok, false);
  assert.equal(moveLight(doc, { id: "light-1", to: { x: -2, z: -4 } }).ok, false);
});

test("removing a light drops it and names a missing one", () => {
  const doc = parse([LAMP]);
  assert.deepEqual(removeLight(doc, { id: "light-1" }).doc.lights, []);
  assert.equal(removeLight(doc, { id: "nope" }).ok, false);
});

test("proposing replaces the lights with the picker's and rejects a bad count", () => {
  const doc = parse([LAMP]);
  const proposed = proposeLights(doc, { roomCount: 2 });
  assert.ok(proposed.ok);
  assert.equal(proposed.doc.lights.filter((light) => light.kind === "room").length, 2);
  assert.equal(proposed.doc.lights.filter((light) => light.kind === "corridor").length, 1);
  assert.deepEqual(
    parseLevelDocument(JSON.parse(JSON.stringify(proposed.doc)), { catalog: SPACE_CATALOG }),
    proposed.doc,
  );
  assert.equal(proposeLights(doc, { roomCount: -1 }).ok, false);
});

test("proposing refuses a proposal that would put a light inside a wall", () => {
  const raw = hall(undefined);
  raw.spawns.hunters = [{ x: -2, z: -4 }];
  const doc = parseLevelDocument(raw, { catalog: SPACE_CATALOG });
  const result = proposeLights(doc, { roomCount: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.findings[0].code, "op.blocked");
  assert.equal(result.doc, doc);
});

test("an edit that would raise a wall over a light is refused", () => {
  const doc = parse([{ id: "beacon", x: -2, z: 0, kind: "corridor" }]);
  const closed = toggleDoor(doc, { axis: "v", line: 2, cell: 1 });
  assert.equal(closed.ok, false);
  assert.equal(closed.findings[0].code, "op.blocked");
  assert.equal(closed.doc, doc);
});

test("walls are kept while only lights or objects change and rebuilt when a room or door does", () => {
  const doc = parse([LAMP]);
  const walls = wallRects(doc);
  assert.equal(wallRects(moveLight(doc, { id: "light-1", by: { x: 1, z: 0 } }).doc), walls);
  assert.equal(wallRects({ ...doc, objects: [] }), walls);
  assert.notEqual(wallRects(toggleDoor(doc, { axis: "v", line: 2, cell: 1 }).doc), walls);
  assert.equal(wallRects(parse([LAMP])).length, walls.length);
});

/** A west and an east room with a column of open ground between them; the ground has no walls of its own. */
function gap(lights) {
  return parseLevelDocument(
    {
      version: 1,
      id: "station",
      grid: { cols: 5, rows: 3 },
      rooms: [
        { id: "west", rects: [{ i0: 0, i1: 2, j0: 0, j1: 3 }] },
        { id: "east", rects: [{ i0: 3, i1: 5, j0: 0, j1: 3 }] },
      ],
      doors: [],
      objects: [],
      spawns: { props: [{ x: -6, z: 2 }], hunters: [{ x: 6, z: 2 }] },
      lights,
    },
    { catalog: SPACE_CATALOG },
  );
}

function refusedFor(result, doc) {
  assert.equal(result.ok, false);
  assert.equal(result.doc, doc);
  assert.equal(result.findings[0].code, "op.blocked");
  assert.match(result.findings[0].message, /light-1 .* inside a wall the edit would raise/);
}

test("adding a room is refused when its walls would bury a light and allowed otherwise", () => {
  const doc = gap([{ id: "light-1", x: 0, z: -2, kind: "corridor" }]);
  const rect = { i0: 2, i1: 3, j0: 0, j1: 1 };
  refusedFor(addRoom(doc, { id: "mid", rect }), doc);
  const away = gap([{ id: "light-1", x: 0, z: 2, kind: "corridor" }]);
  const added = addRoom(away, { id: "mid", rect });
  assert.ok(added.ok);
  assert.deepEqual(added.doc.lights, away.lights);
});

test("resizing a room is refused when its new wall would bury a light and allowed otherwise", () => {
  const doc = gap([{ id: "light-1", x: -6, z: 0, kind: "room" }]);
  refusedFor(resizeRoom(doc, { id: "west", rect: { i0: 0, i1: 1, j0: 0, j1: 3 } }), doc);
  const shrunk = resizeRoom(doc, { id: "west", rect: { i0: 0, i1: 2, j0: 1, j1: 3 } });
  assert.ok(shrunk.ok);
  assert.deepEqual(shrunk.doc.lights, doc.lights);
});

test("removing a room never raises a wall, so a light stays valid and the document parses", () => {
  const doc = gap([{ id: "light-1", x: -6, z: 0, kind: "room" }]);
  const removed = removeRoom(doc, { id: "east" });
  assert.ok(removed.ok);
  assert.deepEqual(removed.doc.lights, doc.lights);
  assert.deepEqual(
    parseLevelDocument(JSON.parse(JSON.stringify(removed.doc)), { catalog: SPACE_CATALOG }),
    removed.doc,
  );
});
