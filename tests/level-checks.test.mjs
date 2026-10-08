import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fitModel } from "../packages/client/src/game/modelFit.ts";
import { PLAYER_RADIUS, STEP_HEIGHT } from "../packages/client/src/game/movement.ts";
import {
  FINDING_CODES,
  gateClearances,
  objectFootprint,
  outdoorEntrances,
  parseLevelDocument,
  rectExtent,
  shapeExtent,
  validateLevel,
} from "../packages/level/src/index.ts";
import { buildSpace } from "../packages/level/src/space.ts";
import { buildMap } from "../packages/server/src/maps/index.ts";
import { SPACE_CATALOG } from "../packages/server/src/spaceCatalog.ts";
import {
  ASSET_CARDS,
  ASSET_TAGS,
  computePropBounds,
  LEVEL_BODY_RADIUS,
  LEVEL_STEP_HEIGHT,
  uniformFitScale,
} from "../packages/shared/src/index.ts";

const CONTEXT = { catalog: SPACE_CATALOG, cards: ASSET_CARDS, tags: ASSET_TAGS };
const TABLE = SPACE_CATALOG.find((def) => def.id === "table");
const NEAR = 1e-9;

/** Two 8 x 8 m rooms side by side with one door, three chairs west and three armchairs east, spawns in the open. */
function clean() {
  return {
    version: 1,
    id: "station",
    grid: { cols: 4, rows: 2 },
    rooms: [
      { id: "west", rects: [{ i0: 0, i1: 2, j0: 0, j1: 2 }] },
      { id: "east", rects: [{ i0: 2, i1: 4, j0: 0, j1: 2 }] },
    ],
    doors: [{ axis: "v", line: 2, cell: 1 }],
    objects: [
      { id: "west-1", type: "chair", x: -6, z: -2, yaw: 0 },
      { id: "west-2", type: "chair", x: -6, z: 0, yaw: 0 },
      { id: "west-3", type: "chair", x: -6, z: 2, yaw: 0 },
      { id: "east-1", type: "chair-armrest", x: 6, z: -2, yaw: 0 },
      { id: "east-2", type: "chair-armrest", x: 6, z: 0, yaw: 0 },
      { id: "east-3", type: "chair-armrest", x: 6, z: 2, yaw: 0 },
    ],
    spawns: { props: [{ x: 3, z: -2 }], hunters: [{ x: -3, z: -2 }] },
  };
}

function report(raw, context = CONTEXT) {
  return validateLevel(parseLevelDocument(raw, { catalog: SPACE_CATALOG }), context);
}

function codes(raw, context) {
  return new Set(report(raw, context).findings.map((finding) => finding.code));
}

function edited(change) {
  const raw = clean();
  change(raw);
  return raw;
}

test("the level checks use the client's body radius and step height", () => {
  assert.equal(LEVEL_BODY_RADIUS, PLAYER_RADIUS);
  assert.equal(LEVEL_STEP_HEIGHT, STEP_HEIGHT);
});

/** A flat slab across the doorway, first too low to stop a body and then too tall to step onto. */
function slabContext(height) {
  const slab = {
    id: "slab",
    name: "Slab",
    parts: [
      {
        kind: "box",
        position: { x: 0, y: height / 2, z: 0 },
        size: { x: 3, y: height, z: 4 },
        color: "#888888",
      },
    ],
  };
  return { ...CONTEXT, catalog: [...SPACE_CATALOG, slab] };
}

test("a box a body steps onto blocks neither a doorway nor the flood", () => {
  const raw = edited((d) => d.objects.push({ id: "slab-1", type: "slab", x: 0, z: 2, yaw: 0 }));
  const codesAt = (height) => {
    const context = slabContext(height);
    const doc = parseLevelDocument(raw, { catalog: context.catalog });
    return new Set(validateLevel(doc, context).findings.map((finding) => finding.code));
  };
  const low = codesAt(LEVEL_STEP_HEIGHT);
  assert.ok(!low.has("door.blocked") && !low.has("floor.unreachable"));
  const tall = codesAt(1);
  assert.ok(tall.has("door.blocked") && tall.has("floor.unreachable"));
});

test("a footprint is the client's uniform fit of the model into the catalog box", () => {
  const card = ASSET_CARDS[TABLE.model];
  const bounds = computePropBounds(TABLE);
  const box = {
    min: { y: card.minY },
    getSize: (out) => out.set(card.size.x, card.size.y, card.size.z),
    getCenter: (out) => out.set(card.center.x, card.center.y, card.center.z),
  };
  const { scale } = fitModel(box, 2 * bounds.radius, bounds.yMax - bounds.yMin, bounds.yMin, 1);
  assert.equal(scale, uniformFitScale(card.size, 2 * bounds.radius, bounds.yMax - bounds.yMin, 1));

  const footprint = objectFootprint({ id: "t", type: "table", x: 1, z: 2, yaw: 0 }, CONTEXT);
  assert.ok(Math.abs(2 * footprint.rect.halfX - card.size.x * scale) < NEAR);
  assert.ok(Math.abs(2 * footprint.rect.halfZ - card.size.z * scale) < NEAR);
  assert.ok(Math.abs(footprint.yMax - card.size.y * scale) < NEAR);
  assert.ok(2 * footprint.rect.halfZ < 2 * bounds.radius - 0.1, "narrower than the square hitbox");
});

test("every catalog model renders inside its collision box", () => {
  for (const def of SPACE_CATALOG) {
    const extent = shapeExtent(def, CONTEXT);
    const [part] = def.parts;
    assert.ok(extent.halfX <= part.size.x / 2 + NEAR, `${def.id} x`);
    assert.ok(extent.halfZ <= part.size.z / 2 + NEAR, `${def.id} z`);
  }
});

test("a quarter turn swaps a footprint's extent on the floor", () => {
  const flat = objectFootprint({ id: "t", type: "table", x: 0, z: 0, yaw: 0 }, CONTEXT);
  const turned = rectExtent(
    objectFootprint({ id: "t", type: "table", x: 0, z: 0, yaw: Math.PI / 2 }, CONTEXT).rect,
  );
  assert.ok(Math.abs(turned.maxX - flat.rect.halfZ) < NEAR);
  assert.ok(Math.abs(turned.maxZ - flat.rect.halfX) < NEAR);
});

test("a clean document has no findings and full metrics", () => {
  const { findings, unplaced, metrics } = report(clean());
  assert.deepEqual(findings, []);
  assert.deepEqual(unplaced, []);
  assert.equal(metrics.objects, 6);
  assert.equal(metrics["floor.unreachable.m2"], 0);
  assert.ok(metrics["floor.reachable.m2"] > 0);
  assert.equal(metrics["room.west.area.m2"], 64);
  assert.equal(metrics["room.west.disguises"], 3);
  assert.ok(metrics["room.west.sightline.m"] > 0);
});

/** A paved street over a row of homes, with a chair on the street in front of the first door. */
function blockedEntrance() {
  const raw = {
    version: 1,
    id: "station",
    setting: "outdoor",
    grid: { cols: 4, rows: 4 },
    rooms: [{ id: "street", ground: "paving", rects: [{ i0: 0, i1: 4, j0: 0, j1: 2 }] }],
    doors: [],
    blocks: [{ id: "homes", zone: "residential", rects: [{ i0: 0, i1: 4, j0: 2, j1: 4 }] }],
    objects: [],
    spawns: { props: [{ x: -6, z: -6 }], hunters: [{ x: 6, z: -6 }] },
  };
  const doc = parseLevelDocument(raw, { catalog: SPACE_CATALOG });
  const [entrance] = outdoorEntrances(doc);
  assert.ok(entrance, "the homes have a door onto the street");
  raw.objects.push({
    id: "street-1",
    type: "chair",
    x: entrance.x + entrance.nx,
    z: entrance.z + entrance.nz,
    yaw: 0,
  });
  return raw;
}

/** A 4 m lane between two blocks with a table left across the middle of it. */
function blockedLane() {
  return {
    version: 1,
    id: "station",
    setting: "outdoor",
    grid: { cols: 3, rows: 3 },
    rooms: [{ id: "lane", ground: "paving", rects: [{ i0: 1, i1: 2, j0: 0, j1: 3 }] }],
    doors: [],
    blocks: [
      { id: "west", zone: "residential", rects: [{ i0: 0, i1: 1, j0: 0, j1: 3 }] },
      { id: "east", zone: "residential", rects: [{ i0: 2, i1: 3, j0: 0, j1: 3 }] },
    ],
    objects: [{ id: "lane-1", type: "table", x: 0, z: 0, yaw: 0 }],
    spawns: { props: [{ x: 0, z: 5 }], hunters: [{ x: 0, z: -5 }] },
  };
}

const CASES = [
  [
    "object.unmeasured",
    clean(),
    {
      ...CONTEXT,
      cards: Object.fromEntries(
        Object.entries(ASSET_CARDS).filter(
          ([model]) => !/\/station\/chair(-armrest)?\.glb$/.test(model),
        ),
      ),
    },
  ],
  ["object.wall", edited((d) => Object.assign(d.objects[0], { x: -7.6 }))],
  [
    "object.overlap",
    edited((d) => d.objects.push({ id: "west-4", type: "chair", x: -6.1, z: -2.1, yaw: 0 })),
  ],
  ["object.open-ground", edited((d) => d.rooms.pop())],
  ["object.outside-room", edited((d) => Object.assign(d.objects[2], { x: 0, z: 2 }))],
  ["door.blocked", edited((d) => Object.assign(d.objects[2], { x: -1, z: 2 }))],
  ["spawn.blocked", edited((d) => Object.assign(d.spawns.props[0], { x: 6, z: 0 }))],
  ["floor.unreachable", edited((d) => d.doors.pop())],
  [
    "room.sightline",
    edited((d) => {
      d.grid = { cols: 8, rows: 2 };
      d.rooms = [{ id: "hall", rects: [{ i0: 0, i1: 8, j0: 0, j1: 2 }] }];
      d.doors = [];
      d.objects = [0, 1, 2].map((k) => ({
        id: `hall-${k}`,
        type: "chair",
        x: -14,
        z: k - 1,
        yaw: 0,
      }));
    }),
  ],
  ["room.few-disguises", edited((d) => d.objects.splice(0, 1))],
  [
    "map.few-disguise-types",
    edited((d) => {
      d.objects = d.objects.filter((object) => object.id.startsWith("west-"));
    }),
  ],
  ["object.unique-type", edited((d) => Object.assign(d.objects[0], { type: "barrel" }))],
  [
    "light.wall-clearance",
    edited((d) => Object.assign(d, { lights: [{ id: "light-1", x: -6, z: 0, kind: "room" }] })),
  ],
  ["entrance.blocked", blockedEntrance()],
  ["passage.blocked", blockedLane()],
];

test("every finding code has a case", () => {
  assert.deepEqual(CASES.map(([code]) => code).sort(), [...FINDING_CODES].sort());
});

for (const [code, raw, context] of CASES) {
  test(`${code} fires on a minimal document`, () => {
    const found = report(raw, context).findings.filter((finding) => finding.code === code);
    assert.ok(found.length > 0, `expected ${code}`);
    for (const finding of found) {
      assert.ok(finding.message.length > 0 && finding.entities.length > 0);
      assert.ok(finding.hint, `${code} carries a fix hint`);
    }
  });
}

test("an unmeasured object is listed as unplaced, never dropped", () => {
  const [, raw, context] = CASES[0];
  const result = report(raw, context);
  assert.equal(result.unplaced.length, 6);
  assert.equal(result.metrics.objects, 6);
});

test("an overlap names both objects and a move that parts them", () => {
  const [finding] = report(CASES[2][1]).findings.filter((f) => f.code === "object.overlap");
  assert.deepEqual(finding.entities.sort(), ["west-1", "west-4"]);
  assert.match(finding.hint, /^pnpm level move west-\d --to=-?\d+(\.5)?,-?\d+(\.5)?$/);
});

test("a door with a chair in its doorway names the side and the chair", () => {
  const [finding] = report(CASES[5][1]).findings.filter((f) => f.code === "door.blocked");
  assert.deepEqual(finding.entities, ["v:2:1", "west-3"]);
  assert.match(finding.message, /on the west side/);
});

test("a compiled map's gates give the door clearance door.blocked measures", () => {
  const raw = JSON.parse(
    readFileSync(
      new URL("../packages/server/src/maps/station.level.json", import.meta.url),
      "utf8",
    ),
  );
  const doc = parseLevelDocument(raw, { catalog: SPACE_CATALOG });
  const byPlace = (a, b) => a.x - b.x || a.z - b.z;
  const zones = buildSpace(doc, CONTEXT).doors.flatMap((door) => door.sides.map((s) => s.zone));
  assert.ok(zones.length > 0);
  assert.deepEqual(gateClearances(buildMap("station", 1).tiles).sort(byPlace), zones.sort(byPlace));
});

test("a room with no door is unreachable as a whole", () => {
  const mirrored = edited((d) => {
    d.doors.pop();
    for (const object of d.objects) object.type = "chair";
  });
  const result = report(mirrored);
  const [finding] = result.findings.filter((f) => f.code === "floor.unreachable");
  assert.ok(finding.entities.includes("east"));
  assert.equal(finding.hint, "add a door into east");
  assert.equal(result.metrics["floor.unreachable.m2"], result.metrics["floor.reachable.m2"]);
});

test("open ground with no door into it is outside the map, not floor to reach", () => {
  const raw = {
    ...clean(),
    grid: { cols: 5, rows: 2 },
    objects: [],
    spawns: { props: [{ x: 2, z: -2 }], hunters: [{ x: -6, z: -2 }] },
  };
  const result = report(raw);
  assert.deepEqual(
    result.findings.filter((f) => f.code === "floor.unreachable"),
    [],
  );
  assert.equal(result.metrics["floor.unreachable.m2"], 0);
  const doored = report({ ...raw, doors: [...raw.doors, { axis: "v", line: 4, cell: 0 }] });
  assert.ok(doored.metrics["floor.reachable.m2"] > result.metrics["floor.reachable.m2"]);
});

test("objects whose vertical spans do not meet never overlap", () => {
  const context = slabContext(0.3);
  const shelf = {
    id: "shelf",
    name: "Shelf",
    parts: [
      {
        kind: "box",
        position: { x: 0, y: 1.75, z: 0 },
        size: { x: 1, y: 0.5, z: 1 },
        color: "#888888",
      },
    ],
  };
  context.catalog.push(shelf);
  const raw = edited((d) => d.objects.push({ id: "west-4", type: "shelf", x: -6, z: -2, yaw: 0 }));
  const doc = parseLevelDocument(raw, { catalog: context.catalog });
  const overlaps = validateLevel(doc, context).findings.filter((f) => f.code === "object.overlap");
  assert.deepEqual(overlaps, []);
});

test("a room with no objects is not short of disguises", () => {
  const raw = edited((d) => {
    d.objects = d.objects.filter((object) => object.id.startsWith("west-"));
  });
  const found = report(raw).findings.filter((f) => f.code === "room.few-disguises");
  assert.deepEqual(found, []);
});

test("with no walkable hunter spawn only the spawns are reported, not the whole map", () => {
  const raw = edited((d) => Object.assign(d.spawns.hunters[0], { x: -6, z: -2 }));
  const result = report(raw);
  const found = new Set(result.findings.map((f) => f.code));
  assert.ok(found.has("spawn.blocked"));
  assert.ok(!found.has("floor.unreachable"));
  assert.equal(result.metrics["floor.reachable.m2"], undefined);
});

test("findings are silent on other codes for a single change", () => {
  assert.deepEqual([...codes(CASES[1][1])], ["object.wall"]);
});

test("validation does not change the document", () => {
  const doc = parseLevelDocument(CASES[2][1], { catalog: SPACE_CATALOG });
  const before = structuredClone(doc);
  validateLevel(doc, CONTEXT);
  assert.deepEqual(doc, before);
});
