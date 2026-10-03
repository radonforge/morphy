import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  compileLevel,
  LevelValidationError,
  parseLevelDocument,
  TILE,
  WALL_HEIGHT,
} from "../packages/level/src/index.ts";
import { SPACE_CATALOG } from "../packages/server/src/spaceCatalog.ts";
import { parseMapDefinition } from "../packages/shared/src/index.ts";

const GATE_MODEL = "/models/space/modular/gate.glb";
const VARIANT_FAMILIES = [/template-floor/, /template-wall/];

/** Two rooms either side of a one-column corridor, one door into each. */
function fixture() {
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
      { id: "east-1", type: "table", x: 6, z: 1, yaw: Math.PI / 2 },
    ],
    spawns: { props: [{ x: -6, z: 2 }], hunters: [{ x: 0, z: 0 }] },
  };
}

const OPTIONS = { catalog: SPACE_CATALOG };

test("a valid document parses to the same data", () => {
  assert.deepEqual(parseLevelDocument(fixture(), OPTIONS), fixture());
});

const edit = (change) => (doc) => {
  change(doc);
  return doc;
};

const INVALID = [
  ["a non-object root", () => 42, "document"],
  ["an unknown map id", edit((d) => Object.assign(d, { id: "no-such-map" })), "document"],
  ["an unsupported version", edit((d) => Object.assign(d, { version: 2 })), "document"],
  ["a non-integer grid", edit((d) => Object.assign(d, { grid: { cols: 2.5, rows: 3 } })), "grid"],
  ["an oversized grid", edit((d) => Object.assign(d, { grid: { cols: 1e9, rows: 3 } })), "grid"],
  ["no rooms", edit((d) => Object.assign(d, { rooms: [] })), "rooms"],
  ["a room without rects", edit((d) => Object.assign(d.rooms[0], { rects: [] })), 'room "west"'],
  [
    "a rect off the grid",
    edit((d) => Object.assign(d.rooms[2].rects[0], { i1: 6 })),
    'room "east"',
  ],
  ["a duplicate room id", edit((d) => Object.assign(d.rooms[2], { id: "west" })), 'room "west"'],
  [
    "an unknown ceiling kind",
    edit((d) => Object.assign(d.rooms[1], { ceiling: "dome" })),
    'room "hall"',
  ],
  [
    "overlapping rooms",
    edit((d) => d.rooms[1].rects.push({ i0: 1, i1: 3, j0: 0, j1: 1 })),
    'room "hall"',
  ],
  [
    "a door inside one room",
    edit((d) => d.doors.push({ axis: "v", line: 1, cell: 0 })),
    "door v:1:0",
  ],
  [
    "a door in the outer wall",
    edit((d) => d.doors.push({ axis: "v", line: 0, cell: 0 })),
    "door v:0:0",
  ],
  ["a door off the grid", edit((d) => d.doors.push({ axis: "h", line: 4, cell: 0 })), "door h:4:0"],
  ["a duplicate door", edit((d) => d.doors.push({ axis: "v", line: 2, cell: 1 })), "door v:2:1"],
  [
    "a duplicate object id",
    edit((d) => Object.assign(d.objects[1], { id: "west-1" })),
    'object "west-1"',
  ],
  [
    "an unknown object type",
    edit((d) => Object.assign(d.objects[0], { type: "sofa" })),
    'object "west-1"',
  ],
  [
    "a non-finite object yaw",
    edit((d) => Object.assign(d.objects[0], { yaw: null })),
    'object "west-1"',
  ],
  [
    "an object outside the map",
    edit((d) => Object.assign(d.objects[1], { x: 11 })),
    'object "east-1"',
  ],
  ["no hunter spawn", edit((d) => Object.assign(d.spawns, { hunters: [] })), "spawns.hunters"],
  ["a spawn outside the map", edit((d) => d.spawns.props.push({ x: 0, z: -7 })), "spawns.props[1]"],
];

for (const [label, build, entity] of INVALID) {
  test(`parse rejects ${label}, naming the document, the entity and a fix`, () => {
    assert.throws(
      () => parseLevelDocument(build(fixture()), OPTIONS),
      (error) => {
        assert.ok(error instanceof LevelValidationError, `${label}: ${error}`);
        assert.equal(error.entityId, entity);
        assert.ok(error.hint.length > 0, `${label}: no hint`);
        assert.match(error.message, /^invalid level "(station|no-such-map|\?)", .+\. Fix: .+/);
        return true;
      },
    );
  });
}

test("parse rejects a document that is not the map the caller asked for", () => {
  assert.throws(
    () => parseLevelDocument(fixture(), { ...OPTIONS, id: "urban" }),
    (error) => error instanceof LevelValidationError && error.entityId === "document",
  );
});

test("a door between a room and open ground is valid and compiles to a gate", () => {
  const doc = fixture();
  doc.rooms = doc.rooms.filter((room) => room.id !== "hall");
  doc.spawns.hunters = [{ x: -6, z: 0 }];
  const parsed = parseLevelDocument(doc, OPTIONS);
  const map = compileLevel(parsed, { catalog: SPACE_CATALOG, seed: 0 });
  assert.equal(map.tiles.filter((tile) => tile.model === GATE_MODEL).length, doc.doors.length);
});

test("the committed station document parses as it stands", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../packages/server/src/maps/station.level.json", import.meta.url),
      "utf8",
    ),
  );
  const doc = parseLevelDocument(raw, { catalog: SPACE_CATALOG, id: "station" });
  assert.deepEqual(doc, raw);
});

test("a compiled level is a valid map", () => {
  const doc = parseLevelDocument(fixture(), OPTIONS);
  const map = compileLevel(doc, { catalog: SPACE_CATALOG, seed: 3 });
  assert.deepEqual(parseMapDefinition(map), map);
  assert.equal(map.tiles.filter((tile) => tile.model === GATE_MODEL).length, doc.doors.length);
  assert.deepEqual(
    map.props.map((prop) => [prop.type, prop.position, prop.rotation]),
    doc.objects.map((o) => [o.type, { x: o.x, y: 0, z: o.z }, o.yaw]),
  );
});

test("every floor cell gets a ceiling panel on the wall tops, glass unless its room is solid", () => {
  const doc = fixture();
  doc.rooms[1].ceiling = "solid";
  const parsed = parseLevelDocument(doc, OPTIONS);
  assert.equal(parsed.rooms[1].ceiling, "solid");
  assert.equal(parsed.rooms[0].ceiling, undefined);
  const { ceiling } = compileLevel(parsed, { catalog: SPACE_CATALOG, seed: 0 });
  assert.equal(ceiling.length, 15);
  assert.ok(ceiling.every((panel) => panel.size === TILE && panel.y === WALL_HEIGHT));
  const solid = ceiling.filter((panel) => panel.kind === "solid");
  assert.deepEqual(
    solid.map(({ x, z }) => [x, z]),
    [
      [0, -4],
      [0, 0],
      [0, 4],
    ],
  );
});

test("a map refuses a ceiling panel without a size or of an unknown kind", () => {
  const map = compileLevel(parseLevelDocument(fixture(), OPTIONS), {
    catalog: SPACE_CATALOG,
    seed: 0,
  });
  const [first] = map.ceiling;
  for (const ceiling of [{}, [{ ...first, size: 0 }], [{ ...first, kind: "dome" }]]) {
    assert.throws(() => parseMapDefinition({ ...map, ceiling }), /ceiling/);
  }
});

test("compiling is deterministic per seed and the seed moves nothing", () => {
  const doc = parseLevelDocument(fixture(), OPTIONS);
  const base = compileLevel(doc, { catalog: SPACE_CATALOG, seed: 0 });
  for (let seed = 0; seed < 50; seed++) {
    const map = compileLevel(doc, { catalog: SPACE_CATALOG, seed });
    assert.deepEqual(compileLevel(doc, { catalog: SPACE_CATALOG, seed }), map);
    const { tiles, ...rest } = map;
    const { tiles: baseTiles, ...baseRest } = base;
    assert.deepEqual(rest, baseRest, `seed ${seed}`);
    assert.equal(tiles.length, baseTiles.length);
    for (const [index, tile] of tiles.entries()) {
      const other = baseTiles[index];
      assert.deepEqual(tile.position, other.position);
      assert.equal(tile.rotationY, other.rotationY);
      const family = VARIANT_FAMILIES.find((pattern) => pattern.test(tile.model));
      if (family) assert.match(other.model, family);
      else assert.equal(tile.model, other.model);
    }
  }
});
