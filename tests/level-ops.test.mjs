import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addRoom,
  duplicateObject,
  moveObject,
  objectFootprint,
  parseLevelDocument,
  placeObject,
  rectExtent,
  removeObject,
  removeRoom,
  resizeRoom,
  rotateObject,
  toggleDoor,
  validateLevel,
} from "../packages/level/src/index.ts";
import { SPACE_CATALOG } from "../packages/server/src/spaceCatalog.ts";
import { ASSET_CARDS } from "../packages/shared/src/index.ts";

const CONTEXT = { catalog: SPACE_CATALOG, cards: ASSET_CARDS };
const QUARTER = Math.PI / 2;

/** A west room, a one-column hall and an east room in a row, a door into each; column 4 is open ground. */
function doc() {
  return parseLevelDocument(
    {
      version: 1,
      id: "station",
      grid: { cols: 5, rows: 2 },
      rooms: [
        { id: "west", rects: [{ i0: 0, i1: 2, j0: 0, j1: 2 }] },
        { id: "hall", rects: [{ i0: 2, i1: 3, j0: 0, j1: 2 }] },
        { id: "east", rects: [{ i0: 3, i1: 4, j0: 0, j1: 2 }] },
      ],
      doors: [
        { axis: "v", line: 2, cell: 1 },
        { axis: "v", line: 3, cell: 1 },
      ],
      objects: [{ id: "west-1", type: "chair", x: -7, z: -2, yaw: 0 }],
      spawns: { props: [{ x: 0, z: -2 }], hunters: [{ x: -4, z: 2 }] },
    },
    { catalog: SPACE_CATALOG },
  );
}

function placed(result) {
  assert.equal(result.ok, true, result.findings.map((f) => f.message).join("; "));
  return result.doc.objects.at(-1);
}

function assertBlocked(result, original, blocker) {
  assert.equal(result.ok, false);
  assert.equal(result.doc, original, "the document is returned unchanged");
  const [finding] = result.findings;
  assert.equal(finding.severity, "error");
  assert.equal(finding.code, "op.blocked");
  assert.match(finding.message, blocker);
}

function noLayoutErrors(result) {
  const errors = validateLevel(result.doc, CONTEXT).findings.filter((f) =>
    ["object.wall", "object.overlap", "door.blocked", "spawn.blocked"].includes(f.code),
  );
  assert.deepEqual(errors, []);
}

test("place at a point snaps position and yaw, and names the object after its room", () => {
  const object = placed(
    placeObject(
      doc(),
      { type: "chair", relation: { at: { x: -5.2, z: 0.9 } }, yawDegrees: 100 },
      CONTEXT,
    ),
  );
  assert.deepEqual(object, { id: "west-2", type: "chair", x: -5, z: 1, yaw: QUARTER });
});

test("place with free keeps the exact position and yaw", () => {
  const object = placed(
    placeObject(
      doc(),
      {
        type: "chair",
        relation: { at: { x: -5.2, z: 0.9 } },
        yawDegrees: 100,
        free: true,
        id: "odd",
      },
      CONTEXT,
    ),
  );
  assert.equal(object.id, "odd");
  assert.equal(object.x, -5.2);
  assert.ok(Math.abs(object.yaw - (100 * Math.PI) / 180) < 1e-12);
});

test("place at the centre of a room", () => {
  const object = placed(
    placeObject(doc(), { type: "table", relation: { center: "west" } }, CONTEXT),
  );
  assert.deepEqual([object.x, object.z], [-6, 0]);
});

test("place against a wall backs onto it and faces into the room", () => {
  const result = placeObject(
    doc(),
    { type: "table", relation: { againstWall: { room: "west", side: "N" }, facing: "in" } },
    CONTEXT,
  );
  const object = placed(result);
  assert.equal(object.yaw, 0);
  const extent = rectExtent(objectFootprint(object, CONTEXT).rect);
  assert.ok(extent.minZ >= -3.5 && extent.minZ < -3, `touches the wall face, minZ ${extent.minZ}`);
  noLayoutErrors(result);
});

test("place against a wall slides along it past what stands in the middle", () => {
  const base = placeObject(
    doc(),
    { type: "table", relation: { at: { x: -4, z: -3 } } },
    CONTEXT,
  ).doc;
  const object = placed(
    placeObject(
      base,
      { type: "table", relation: { againstWall: { room: "west", side: "N" }, facing: "in" } },
      CONTEXT,
    ),
  );
  assert.notEqual(object.x, -4);
});

test("each wall side faces a different way", () => {
  const yaws = ["N", "S", "E", "W"].map(
    (side) =>
      placed(
        placeObject(
          doc(),
          { type: "chair", relation: { againstWall: { room: "west", side }, facing: "in" } },
          CONTEXT,
        ),
      ).yaw,
  );
  assert.deepEqual(yaws, [0, Math.PI, -QUARTER, QUARTER]);
});

test("place next to an object touches it on that side", () => {
  const object = placed(
    placeObject(doc(), { type: "chair", relation: { nextTo: "west-1", side: "E" } }, CONTEXT),
  );
  assert.equal(object.z, -2);
  assert.ok(object.x > -7);
  noLayoutErrors({
    doc: placeObject(doc(), { type: "chair", relation: { nextTo: "west-1", side: "E" } }, CONTEXT)
      .doc,
  });
});

test("place a row lines copies up across the room", () => {
  const result = placeObject(
    doc(),
    {
      type: "chair",
      relation: { row: { room: "west", along: "z", count: 3, gap: 0.5 } },
      id: "row",
    },
    CONTEXT,
  );
  assert.equal(result.ok, true);
  const row = result.doc.objects.filter((object) => object.id.startsWith("row-"));
  assert.deepEqual(
    row.map((object) => object.id),
    ["row-1", "row-2", "row-3"],
  );
  assert.ok(row.every((object) => object.x === -6));
  noLayoutErrors(result);
});

test("a blocked placement names what blocks it and places nothing", () => {
  const original = doc();
  assertBlocked(
    placeObject(original, { type: "chair", relation: { at: { x: -7, z: -2 } } }, CONTEXT),
    original,
    /west-1 \(chair\)/,
  );
  assertBlocked(
    placeObject(original, { type: "chair", relation: { at: { x: -1, z: 2 } } }, CONTEXT),
    original,
    /doorway v:2:1/,
  );
  assertBlocked(
    placeObject(original, { type: "chair", relation: { at: { x: -9.8, z: 0 } } }, CONTEXT),
    original,
    /a wall/,
  );
});

test("bad placement input is an invalid op, not a crash", () => {
  const original = doc();
  for (const args of [
    { type: "no-such-type", relation: { at: { x: 0, z: 0 } } },
    { type: "chair", relation: { center: "no-such-room" } },
    { type: "chair", relation: { nextTo: "no-such-object", side: "E" } },
    { type: "chair", relation: { at: { x: -5, z: 0 } }, id: "west-1" },
    { type: "chair", relation: { row: { room: "west", along: "x", count: 0, gap: 0 } } },
    { type: "chair", relation: { row: { room: "west", along: "x", count: 1e9, gap: 0 } } },
  ]) {
    const result = placeObject(original, args, CONTEXT);
    assert.equal(result.ok, false);
    assert.equal(result.doc, original);
    assert.equal(result.findings[0].code, "op.invalid");
  }
});

test("move by a delta or to a point, snapped, and refuse a blocked spot", () => {
  const original = doc();
  assert.deepEqual(
    placed(moveObject(original, { id: "west-1", by: { x: 1.1, z: 0 } }, CONTEXT)).x,
    -6,
  );
  const moved = moveObject(original, { id: "west-1", to: { x: -5, z: 1 } }, CONTEXT).doc.objects[0];
  assert.deepEqual([moved.x, moved.z], [-5, 1]);
  assertBlocked(
    moveObject(original, { id: "west-1", to: { x: -9.9, z: 0 } }, CONTEXT),
    original,
    /a wall/,
  );
  assert.equal(
    moveObject(original, { id: "nope", by: { x: 1, z: 0 } }, CONTEXT).findings[0].code,
    "op.invalid",
  );
});

test("rotate by quarter turns by default, by exact degrees on request", () => {
  const original = doc();
  assert.equal(rotateObject(original, { id: "west-1" }, CONTEXT).doc.objects[0].yaw, QUARTER);
  assert.equal(
    rotateObject(original, { id: "west-1", turns: 2 }, CONTEXT).doc.objects[0].yaw,
    Math.PI,
  );
  const turned = rotateObject(original, { id: "west-1", degrees: 30 }, CONTEXT).doc.objects[0].yaw;
  assert.ok(Math.abs(turned - Math.PI / 6) < 1e-12);
});

test("a rotation that would push into a wall is refused", () => {
  const tight = placeObject(
    doc(),
    {
      type: "table",
      relation: { againstWall: { room: "west", side: "N" }, facing: "in" },
      id: "big",
    },
    CONTEXT,
  ).doc;
  assertBlocked(rotateObject(tight, { id: "big" }, CONTEXT), tight, /a wall/);
});

test("remove drops exactly one object", () => {
  const result = removeObject(doc(), { id: "west-1" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.doc.objects, []);
  assert.equal(removeObject(doc(), { id: "nope" }).ok, false);
});

test("duplicate copies type and yaw beside the original", () => {
  const rotated = rotateObject(doc(), { id: "west-1" }, CONTEXT).doc;
  const result = duplicateObject(rotated, { id: "west-1" }, CONTEXT);
  const copy = placed(result);
  assert.equal(copy.id, "west-2");
  assert.equal(copy.type, "chair");
  assert.equal(copy.yaw, QUARTER);
  noLayoutErrors(result);
});

test("room add, resize and remove keep the grid consistent", () => {
  const added = addRoom(doc(), { id: "annex", rect: { i0: 4, i1: 5, j0: 0, j1: 2 } });
  assert.equal(added.ok, true);
  assert.equal(added.doc.rooms.at(-1).id, "annex");
  assert.equal(addRoom(doc(), { id: "clash", rect: { i0: 3, i1: 5, j0: 0, j1: 2 } }).ok, false);
  assert.equal(addRoom(doc(), { id: "west", rect: { i0: 4, i1: 5, j0: 0, j1: 1 } }).ok, false);
  assert.equal(addRoom(doc(), { id: "off", rect: { i0: 4, i1: 6, j0: 0, j1: 1 } }).ok, false);

  const withoutHall = removeRoom(doc(), { id: "hall" });
  assert.equal(withoutHall.ok, true);
  assert.equal(withoutHall.doc.doors.length, 2, "doors onto open ground still have a wall");
  const merged = resizeRoom(withoutHall.doc, { id: "west", rect: { i0: 0, i1: 3, j0: 0, j1: 2 } });
  assert.equal(merged.ok, true);
  assert.deepEqual(
    merged.findings.map((finding) => [finding.code, finding.entities[0]]),
    [["op.door-removed", "v:2:1"]],
  );
  assert.doesNotThrow(() => parseLevelDocument(merged.doc, { catalog: SPACE_CATALOG }));
  assert.equal(resizeRoom(doc(), { id: "west", rect: { i0: 0, i1: 3, j0: 0, j1: 2 } }).ok, false);
});

test("toggling a door closes an open one and opens a wall edge", () => {
  const closed = toggleDoor(doc(), { axis: "v", line: 2, cell: 1 });
  assert.equal(closed.ok, true);
  assert.equal(closed.doc.doors.length, 1);
  const opened = toggleDoor(closed.doc, { axis: "v", line: 2, cell: 0 });
  assert.equal(opened.ok, true);
  assert.equal(opened.doc.doors.length, 2);
  assert.equal(toggleDoor(doc(), { axis: "h", line: 1, cell: 0 }).findings[0].code, "op.invalid");
  assert.equal(toggleDoor(doc(), { axis: "v", line: 0, cell: 0 }).ok, false);
  assert.equal(toggleDoor(doc(), { axis: "v", line: 1.5, cell: 1 }).findings[0].code, "op.invalid");
});
