import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addRoom,
  compileLevel,
  LevelValidationError,
  levelOverlays,
  moveLight,
  OUTDOOR_MODEL_PATHS,
  parseLevelDocument,
  proposeLights,
  TILE,
  validateLevel,
} from "../packages/level/src/index.ts";
import { wallRects } from "../packages/level/src/walls.ts";
import { URBAN_CATALOG } from "../packages/server/src/urbanCatalog.ts";
import { ASSET_CARDS, ASSET_TAGS, parseMapDefinition } from "../packages/shared/src/index.ts";

const OPTIONS = { catalog: URBAN_CATALOG };
const CONTEXT = { catalog: URBAN_CATALOG, cards: ASSET_CARDS, tags: ASSET_TAGS };
const TOWER = "/models/urban/commercial/building-skyscraper-d.glb";
const CURVED_LAMP = "/models/urban/roads/light-curved.glb";
const QUARTER = Math.PI / 2;
const NEAR = 1e-9;

/**
 * A 10 x 6 cell square: a paved street along the north edge, a park below it, a
 * residential block in the south-west and a tower in the south-east, one lamp.
 */
function fixture() {
  return {
    version: 1,
    id: "urban",
    setting: "outdoor",
    grid: { cols: 10, rows: 6 },
    rooms: [
      { id: "street", ground: "paving", rects: [{ i0: 0, i1: 10, j0: 0, j1: 2 }] },
      { id: "park", ground: "grass", rects: [{ i0: 0, i1: 10, j0: 2, j1: 3 }] },
    ],
    doors: [],
    blocks: [
      { id: "homes", zone: "residential", rects: [{ i0: 0, i1: 6, j0: 3, j1: 6 }] },
      {
        id: "tower",
        zone: "commercial",
        rects: [{ i0: 6, i1: 10, j0: 3, j1: 6 }],
        building: TOWER,
      },
    ],
    objects: [{ id: "tree-1", type: "tree-large", x: 0, z: -2, yaw: 0 }],
    spawns: { props: [{ x: -14, z: -2 }], hunters: [{ x: 14, z: -10 }] },
    lights: [{ id: "lamp-1", x: -6, z: -10, kind: "corridor", fixture: "curved", yaw: Math.PI }],
  };
}

const edit = (change) => (doc) => {
  change(doc);
  return doc;
};

const parse = (doc) => parseLevelDocument(doc, OPTIONS);
const compiled = (doc = fixture(), seed = 1) =>
  compileLevel(parse(doc), { catalog: URBAN_CATALOG, seed });

test("an outdoor document parses to the same data", () => {
  assert.deepEqual(parse(fixture()), fixture());
});

const INVALID = [
  [
    "an unknown setting",
    edit((d) => Object.assign(d, { setting: "underwater" })),
    "document",
    /setting "underwater" is not a setting/,
  ],
  [
    "a door outdoors",
    edit((d) => d.doors.push({ axis: "h", line: 2, cell: 1 })),
    "doors",
    /no walls to open/,
  ],
  [
    "a ceiling outdoors",
    edit((d) => Object.assign(d.rooms[0], { ceiling: "glass" })),
    'room "street"',
    /an outdoor room has no ceiling/,
  ],
  [
    "an unknown ground",
    edit((d) => Object.assign(d.rooms[0], { ground: "lava" })),
    'room "street"',
    /ground "lava" is not a ground kind/,
  ],
  [
    "an unknown zone",
    edit((d) => Object.assign(d.blocks[0], { zone: "harbour" })),
    'block "homes"',
    /zone "harbour" is not a block zone/,
  ],
  [
    "a block over a room",
    edit((d) => Object.assign(d.blocks[0], { rects: [{ i0: 0, i1: 6, j0: 2, j1: 6 }] })),
    'block "homes"',
    /cell \(0,2\) is already in room "park"/,
  ],
  [
    "a block over a room of the same name",
    edit((d) => {
      d.rooms[1].id = "homes";
      d.blocks[0].rects = [{ i0: 0, i1: 6, j0: 2, j1: 6 }];
    }),
    'block "homes"',
    /cell \(0,2\) is already in room "homes"/,
  ],
  [
    "a block whose rects overlap",
    edit((d) => d.blocks[0].rects.push({ i0: 5, i1: 6, j0: 5, j1: 6 })),
    'block "homes"',
    /cell \(5,5\) is in two of its rects/,
  ],
  [
    "a building that is not a kit building",
    edit((d) => Object.assign(d.blocks[1], { building: CURVED_LAMP })),
    'block "tower"',
    /is not an outdoor building model/,
  ],
  [
    "a building over two rects",
    edit((d) =>
      Object.assign(d.blocks[1], {
        rects: [
          { i0: 6, i1: 8, j0: 3, j1: 6 },
          { i0: 8, i1: 10, j0: 3, j1: 6 },
        ],
      }),
    ),
    'block "tower"',
    /needs exactly one rect/,
  ],
  [
    "a turned block of many buildings",
    edit((d) => Object.assign(d.blocks[0], { yaw: QUARTER })),
    'block "homes"',
    /only a block with one building turns/,
  ],
  [
    "a building turned off the quarter turns",
    edit((d) => Object.assign(d.blocks[1], { yaw: 0.3 })),
    'block "tower"',
    /yaw 0.3 is not a quarter turn/,
  ],
  [
    "an unknown fixture",
    edit((d) => Object.assign(d.lights[0], { fixture: "torch" })),
    'light "lamp-1"',
    /fixture "torch" is not a lamp fixture/,
  ],
  [
    "a turned light with no lamp",
    edit((d) => delete d.lights[0].fixture),
    'light "lamp-1"',
    /only a light on a lamp turns/,
  ],
  [
    "a lamp on a block",
    edit((d) => Object.assign(d.lights[0], { z: 6 })),
    'light "lamp-1"',
    /is inside a block/,
  ],
];

for (const [name, make, entity, message] of INVALID) {
  test(`parse rejects ${name}, naming ${entity}`, () => {
    assert.throws(
      () => parse(make(fixture())),
      (error) =>
        error instanceof LevelValidationError &&
        error.entityId === entity &&
        message.test(error.message),
    );
  });
}

/** The fixture with every outdoor field taken out: a valid indoor document. */
function indoor() {
  const doc = fixture();
  delete doc.setting;
  delete doc.blocks;
  for (const room of doc.rooms) delete room.ground;
  doc.lights = [{ id: "lamp-1", x: -6, z: -10, kind: "corridor" }];
  return doc;
}

test("indoor documents refuse outdoor fields", () => {
  parse(indoor());
  const cases = [
    [edit((d) => Object.assign(d.rooms[0], { ground: "grass" })), 'room "street"'],
    [edit((d) => Object.assign(d, { blocks: [] })), "blocks"],
    [edit((d) => Object.assign(d.lights[0], { fixture: "curved" })), 'light "lamp-1"'],
  ];
  for (const [make, entity] of cases) {
    assert.throws(
      () => parse(make(indoor())),
      (error) => error instanceof LevelValidationError && error.entityId === entity,
    );
  }
});

test("every model an outdoor document can compile to has an asset card", () => {
  for (const model of OUTDOOR_MODEL_PATHS) assert.ok(ASSET_CARDS[model], model);
});

test("an outdoor map compiles to a valid map that does not vary with the seed", () => {
  const map = compiled();
  parseMapDefinition(map);
  assert.deepEqual(compiled(fixture(), 2), map);
  assert.equal(map.ceiling, undefined);
  assert.deepEqual(map.tiles, []);
});

test("ground patches cover exactly the room cells, kind by kind", () => {
  const { ground } = compiled();
  const area = (kind) =>
    ground.filter((patch) => patch.kind === kind).reduce((sum, p) => sum + p.w * p.d, 0);
  assert.equal(area("paving"), 10 * 2 * TILE * TILE);
  assert.equal(area("grass"), 10 * 1 * TILE * TILE);
  assert.equal(area("yard"), 0);
});

const inArea = (box, minX, maxX, minZ, maxZ) =>
  box.position.y > 0 &&
  box.position.x > minX &&
  box.position.x < maxX &&
  box.position.z > minZ &&
  box.position.z < maxZ;

test("block colliders tile each block exactly, at the height of the building they hold", () => {
  const map = compiled();
  const homes = map.colliders.filter((box) => inArea(box, -20, 4, -2, 12));
  assert.ok(Math.abs(homes.reduce((sum, b) => sum + b.size.x * b.size.z, 0) - 24 * 12) < NEAR);
  const houses = map.scenery.filter((s) => s.model.includes("building-type-"));
  assert.equal(houses.length, homes.length);
  for (const box of homes) {
    assert.ok(
      houses.some((s) => Math.abs(ASSET_CARDS[s.model].size.y * s.scale - box.size.y) < NEAR),
      `a ${box.size.y} m lot matches no house`,
    );
  }
  const [tower] = map.colliders.filter((box) => inArea(box, 4, 20, -2, 12));
  assert.deepEqual([tower.size.x, tower.size.z], [16, 12]);
  assert.ok(tower.size.y > 30, "the tower is taller than every house");
  assert.equal(map.scenery.filter((s) => s.model === TOWER).length, 1);
});

/**
 * A 2 x 2 cell block in the middle of a 4 x 4 grid, open ground only on `side`
 * (N, E, S or W) and nothing elsewhere but void.
 */
function lonelyBlock(side) {
  const open = {
    N: { i0: 1, i1: 3, j0: 0, j1: 1 },
    S: { i0: 1, i1: 3, j0: 3, j1: 4 },
    W: { i0: 0, i1: 1, j0: 1, j1: 3 },
    E: { i0: 3, i1: 4, j0: 1, j1: 3 },
  }[side];
  const spawn = { x: (open.i0 + open.i1) * 2 - 8, z: (open.j0 + open.j1) * 2 - 8 };
  return {
    version: 1,
    id: "urban",
    setting: "outdoor",
    grid: { cols: 4, rows: 4 },
    rooms: [{ id: "yard", rects: [open] }],
    doors: [],
    blocks: [{ id: "house", zone: "residential", rects: [{ i0: 1, i1: 3, j0: 1, j1: 3 }] }],
    objects: [],
    spawns: { props: [spawn], hunters: [spawn] },
  };
}

test("a building faces the open side of its lot and sits centred on it", () => {
  const facing = { S: 0, E: 1, N: 2, W: 3 };
  for (const [side, turns] of Object.entries(facing)) {
    const [house] = compiled(lonelyBlock(side)).scenery.filter((s) =>
      s.model.includes("building-type-"),
    );
    assert.ok(Math.abs(house.rotationY - turns * QUARTER) < NEAR, `${side}: ${house.rotationY}`);
    const card = ASSET_CARDS[house.model];
    const yaw = house.rotationY;
    const cx = card.center.x * house.scale;
    const cz = card.center.z * house.scale;
    const centreX = house.position.x + cx * Math.cos(yaw) + cz * Math.sin(yaw);
    const centreZ = house.position.z - cx * Math.sin(yaw) + cz * Math.cos(yaw);
    assert.ok(Math.abs(centreX) < 1e-6 && Math.abs(centreZ) < 1e-6, `${side}: off its lot`);
  }
});

test("a landmark keeps the quarter turn its block asks for", () => {
  for (const turns of [0, 1, 2, 3]) {
    const doc = edit((d) => Object.assign(d.blocks[1], { yaw: turns * QUARTER }))(fixture());
    const tower = compiled(doc).scenery.find((s) => s.model === TOWER);
    assert.ok(Math.abs(tower.rotationY - turns * QUARTER) < NEAR, `turns ${turns}`);
  }
});

test("cells that are neither ground nor block merge into a few unseen walls", () => {
  const map = compiled(lonelyBlock("N"));
  const voids = map.colliders.filter(
    (box) =>
      box.position.y > 0 &&
      box.size.y === 10 &&
      box.size.x >= TILE &&
      box.size.z >= TILE &&
      box.size.x <= 16 &&
      box.size.z <= 16,
  );
  const area = voids.reduce((sum, box) => sum + box.size.x * box.size.z, 0);
  assert.equal(area, (16 - 2 - 4) * TILE * TILE);
  assert.ok(voids.length <= 3, `${voids.length} void colliders for one U of cells`);
});

test("facades stand beyond each edge where open ground meets it, fronts turned to the map", () => {
  const facing = { N: 0, S: 2, W: 1, E: 3 };
  for (const [side, turns] of Object.entries(facing)) {
    const backdrop = compiled(lonelyBlock(side)).scenery.filter((s) =>
      s.model.includes("low-detail-building"),
    );
    assert.ok(backdrop.length > 0, side);
    for (const facade of backdrop) {
      const outside = {
        N: -facade.position.z,
        S: facade.position.z,
        W: -facade.position.x,
        E: facade.position.x,
      }[side];
      assert.ok(outside > 8, `${side}: a facade inside the map`);
      assert.ok(Math.abs(facade.rotationY - turns * QUARTER) < NEAR, `${side}: turned away`);
    }
  }
});

test("a lamp stands at its document position and lights from the head of its arm", () => {
  const map = compiled();
  const pole = map.scenery.find((s) => s.model === CURVED_LAMP);
  assert.deepEqual([pole.position.x, pole.position.z, pole.rotationY], [-6, -10, Math.PI]);
  const [light] = map.lights;
  assert.ok(Math.abs(light.x + 6) < NEAR, "turned half round, the arm stays on the pole's x");
  assert.ok(light.z > -10, "and reaches south, away from the north edge");
});

test("every lamp's light hangs inside its model's footprint", () => {
  const fixtures = ["curved", "curved-double", "curved-cross", "square", "square-double"];
  for (const name of [...fixtures, "square-cross"]) {
    const doc = edit((d) => {
      d.lights[0].fixture = name;
      d.lights[0].yaw = 0;
    })(fixture());
    const map = compiled(doc);
    const pole = map.scenery.find((s) => s.model.includes("/roads/light-"));
    const card = ASSET_CARDS[pole.model];
    const [light] = map.lights;
    const hx = (light.x - pole.position.x) / pole.scale;
    const hz = (light.z - pole.position.z) / pole.scale;
    assert.ok(Math.abs(hx - card.center.x) <= card.size.x / 2, `${name} x`);
    assert.ok(Math.abs(hz - card.center.z) <= card.size.z / 2, `${name} z`);
  }
});

test("walls follow the blocks and the setting, never the lamps", () => {
  const doc = parse(fixture());
  const walls = wallRects(doc);
  assert.equal(wallRects({ ...doc, lights: [] }), walls, "a light edit reuses the walls");
  assert.notDeepEqual(wallRects({ ...doc, blocks: [doc.blocks[0]] }), walls);
  const { setting: _setting, blocks: _blocks, ...indoorLayout } = doc;
  assert.notDeepEqual(wallRects(indoorLayout), walls);
});

test("outdoors one sightline is measured across all the open ground, regions included", () => {
  const doc = parse(fixture());
  const report = validateLevel(doc, CONTEXT);
  assert.ok(report.metrics["open.sightline.m"] > 36, "the 40 m street is one long look");
  assert.equal(report.metrics["room.street.sightline.m"], undefined);
  assert.equal(report.findings.filter((finding) => finding.code === "room.sightline").length, 1);
  assert.equal(levelOverlays(doc, CONTEXT).sightlines.length, 1);
});

test("an object across two outdoor regions is not off its room", () => {
  const doc = edit((d) => Object.assign(d.objects[0], { z: -4 }))(fixture());
  const report = validateLevel(parse(doc), CONTEXT);
  assert.equal(report.findings.filter((f) => f.code === "object.outside-room").length, 0);
});

test("an object on a block is reported as cutting into it", () => {
  const doc = edit((d) => Object.assign(d.objects[0], { x: -10, z: 6 }))(fixture());
  const report = validateLevel(parse(doc), CONTEXT);
  assert.ok(report.findings.some((finding) => finding.code === "object.wall"));
});

test("a room may not be laid over a block", () => {
  const result = addRoom(parse(fixture()), { id: "plaza", rect: { i0: 0, i1: 2, j0: 4, j1: 6 } });
  assert.equal(result.ok, false);
  assert.match(result.findings[0].message, /overlaps block "homes"/);
});

test("lamps keep their fixture when moved, and are never replaced by a proposal", () => {
  const doc = parse(fixture());
  const moved = moveLight(doc, { id: "lamp-1", by: { x: 2, z: 0 } });
  assert.equal(moved.ok, true);
  assert.deepEqual([moved.doc.lights[0].fixture, moved.doc.lights[0].yaw], ["curved", Math.PI]);
  const proposed = proposeLights(doc);
  assert.equal(proposed.ok, false);
  assert.equal(proposed.doc, doc);
});

test("a street lamp's light carries the height of its head", () => {
  const map = compiled();
  const pole = map.scenery.find((s) => s.model === CURVED_LAMP);
  const top = ASSET_CARDS[CURVED_LAMP].size.y * pole.scale;
  const [light] = map.lights;
  assert.ok(light.y > top - 0.5 && light.y < top, `light at ${light.y} m under a ${top} m lamp`);
  assert.deepEqual(parseMapDefinition(map).lights[0], light);
});
