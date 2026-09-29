import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  addedLightId,
  addedObjectId,
  addRoomRect,
  changedEntities,
  deleteSpawn,
  edgeAt,
  fromOp,
  isRefusal,
  lightAt,
  moveRectEdge,
  newRoomId,
  objectAt,
  opNotes,
  rectEdgeAt,
  removeRoomRect,
  setLightKind,
  snapPosition,
} from "../packages/client/src/editor/edits.ts";
import {
  canRedo,
  canUndo,
  commit,
  commitMerged,
  createHistory,
  HISTORY_LIMIT,
  redo,
  undo,
} from "../packages/client/src/editor/history.ts";
import {
  acceptLevelText,
  LevelWriteError,
  levelSources,
  writeLevelFile,
} from "../packages/client/viteLevelBridge.ts";
import {
  addLight,
  formatLevelDocument,
  levelOverlays,
  moveLight,
  parseLevelDocument,
  placeObject,
  proposeLights,
  removeLight,
  resizeRoom,
  validateLevel,
} from "../packages/level/src/index.ts";
import { SPACE_CATALOG } from "../packages/server/src/spaceCatalog.ts";
import {
  ASSET_CARDS,
  ASSET_TAGS,
  LEVEL_SAMPLE_CELL,
  LEVEL_SIGHTLINE_MAX,
} from "../packages/shared/src/index.ts";

const SOURCE = { id: "station", file: "unused", catalog: SPACE_CATALOG };
const CONTEXT = { catalog: SPACE_CATALOG, cards: ASSET_CARDS, tags: ASSET_TAGS };
const QUARTER_TURN = Math.PI / 2;

/** Two rooms on a 5x3 grid with open ground in the middle column; one door between west and the open ground. */
function fixture() {
  return {
    version: 1,
    id: "station",
    grid: { cols: 5, rows: 3 },
    rooms: [
      { id: "west", rects: [{ i0: 0, i1: 2, j0: 0, j1: 3 }] },
      { id: "east", rects: [{ i0: 3, i1: 5, j0: 0, j1: 3 }] },
    ],
    doors: [{ axis: "v", line: 2, cell: 1 }],
    objects: [
      { id: "chair-1", type: "chair", x: -7, z: -2, yaw: 0 },
      { id: "table-1", type: "table", x: 6, z: 1, yaw: QUARTER_TURN },
    ],
    spawns: { props: [{ x: -6, z: 2 }], hunters: [{ x: 0, z: 0 }] },
  };
}

function parses(doc) {
  return parseLevelDocument(doc, { catalog: SPACE_CATALOG, id: "station" });
}

async function stationDocument() {
  const source = levelSources(new URL("../packages/client", import.meta.url).pathname).station;
  return acceptLevelText(await readFile(source.file, "utf8"), source);
}

test("positions snap to half a metre unless free, which keeps millimetres", () => {
  assert.equal(snapPosition(1.26, false), 1.5);
  assert.equal(snapPosition(-0.24, false), 0);
  assert.equal(Object.is(snapPosition(-0.24, false), -0), false);
  assert.equal(snapPosition(1.23456, true), 1.235);
});

test("a blocked level op becomes a refusal naming the blocker, a successful one its document", () => {
  const doc = fixture();
  const onTop = placeObject(doc, { type: "chair", relation: { at: { x: -7, z: -2 } } }, CONTEXT);
  const refused = fromOp(onTop);
  assert.ok(isRefusal(refused));
  assert.match(refused.refused, /chair-1/);
  const placed = placeObject(doc, { type: "chair", relation: { at: { x: -6, z: 0 } } }, CONTEXT);
  assert.equal(fromOp(placed), placed.doc);
  assert.equal(addedObjectId(doc, placed.doc), placed.doc.objects.at(-1).id);
});

test("an op's side effects reach the author as notes", () => {
  const doc = fixture();
  const widened = resizeRoom(doc, { id: "west", rect: { i0: 0, i1: 3, j0: 0, j1: 3 } });
  assert.ok(widened.ok);
  assert.equal(widened.doc.doors.length, 0);
  assert.match(opNotes(widened).join(), /no longer separates/);
  assert.deepEqual(
    opNotes(placeObject(doc, { type: "chair", relation: { at: { x: -7, z: -2 } } }, CONTEXT)),
    [],
  );
});

test("the edge under the pointer is the nearest grid line within tolerance", () => {
  const doc = fixture();
  assert.deepEqual(edgeAt(doc, -2.1, -1, 0.2), { axis: "v", line: 2, cell: 1 });
  assert.deepEqual(edgeAt(doc, 5, -2.05, 0.2), { axis: "h", line: 1, cell: 3 });
  assert.equal(edgeAt(doc, -4, -4, 0.2), null);
});

test("a painted room gets the first free id; an extra rect makes an L and refuses an overlap", () => {
  const doc = fixture();
  assert.equal(newRoomId(doc), "room-1");
  assert.equal(newRoomId({ ...doc, rooms: [...doc.rooms, { id: "room-1", rects: [] }] }), "room-2");
  const extended = addRoomRect(doc, "west", { i0: 2, i1: 3, j0: 2, j1: 3 });
  assert.ok(!isRefusal(extended));
  assert.equal(extended.rooms[0].rects.length, 2);
  parses(extended);
  const overlap = addRoomRect(doc, "west", { i0: 2, i1: 4, j0: 0, j1: 1 });
  assert.ok(isRefusal(overlap));
  assert.match(overlap.refused, /east/);
});

test("an edge handle is the nearest rect side, and a rect never shrinks below one cell", () => {
  const rect = { i0: 0, i1: 2, j0: 0, j1: 3 };
  assert.equal(rectEdgeAt(rect, 2.1, 1.5, 0.2), "i1");
  assert.equal(rectEdgeAt(rect, 1, 0.05, 0.2), "j0");
  assert.equal(rectEdgeAt(rect, 1, 1.5, 0.2), null);
  assert.deepEqual(moveRectEdge(rect, "i1", 0), { ...rect, i1: 1 });
});

test("one arm of an L can be deleted, a room's only rect cannot", () => {
  const doc = fixture();
  const l = addRoomRect(doc, "west", { i0: 2, i1: 3, j0: 2, j1: 3 });
  assert.equal(removeRoomRect(l, "west", 1).rooms[0].rects.length, 1);
  assert.ok(isRefusal(removeRoomRect(doc, "west", 0)));
});

test("an object is picked inside its real footprint, nearest first", () => {
  const doc = fixture();
  assert.equal(objectAt(doc, -7, -2, CONTEXT, 0.5), "chair-1");
  assert.equal(objectAt(doc, -5, -2, CONTEXT, 0.5), null);
});

test("each team keeps at least one spawn", () => {
  const doc = fixture();
  assert.ok(isRefusal(deleteSpawn(doc, "props", 0)));
  const two = { ...doc, spawns: { ...doc.spawns, props: [...doc.spawns.props, { x: 6, z: 2 }] } };
  assert.deepEqual(deleteSpawn(two, "props", 0).spawns.props, [{ x: 6, z: 2 }]);
});

test("overlays draw what the checks measured: sealed floor and over-long sightlines", async () => {
  const sealed = { ...fixture(), doors: [] };
  const overlays = levelOverlays(sealed, CONTEXT);
  const report = validateLevel(sealed, CONTEXT);
  assert.ok(overlays.unreachable.length > 0);
  assert.equal(
    overlays.unreachable.length * LEVEL_SAMPLE_CELL * LEVEL_SAMPLE_CELL,
    report.metrics["floor.unreachable.m2"],
  );
  const station = await stationDocument();
  const long = levelOverlays(station, CONTEXT).sightlines.filter(
    ({ line }) => line.length > LEVEL_SIGHTLINE_MAX,
  );
  const findings = validateLevel(station, CONTEXT).findings.filter(
    (f) => f.code === "room.sightline",
  );
  assert.deepEqual(long.map(({ room }) => room).sort(), findings.map((f) => f.entities[0]).sort());
});

test("changed entities name what an external write touched and count what it removed", () => {
  const before = fixture();
  const after = {
    ...before,
    doors: [{ axis: "v", line: 3, cell: 0 }],
    objects: [{ ...before.objects[0], x: -8 }],
    spawns: { ...before.spawns, hunters: [{ x: 1, z: 0 }] },
  };
  const { keys, removed } = changedEntities(before, after);
  assert.deepEqual(keys.sort(), ["door:v:3:0", "object:chair-1", "spawn:hunters:0"].sort());
  assert.equal(removed, 2);
  assert.deepEqual(changedEntities(before, fixture()), { keys: [], removed: 0 });
});

test("light picking, ids and kind changes read the document's lights", () => {
  const doc = parses({ ...fixture(), lights: [{ id: "light-1", x: -6, z: 0, kind: "room" }] });
  assert.equal(lightAt(doc, -5.5, 0.4, 0.9), "light-1");
  assert.equal(lightAt(doc, 0, 0, 0.9), null);
  assert.equal(lightAt(parses(fixture()), -6, 0, 0.9), null);
  const added = addLight(doc, { at: { x: -5, z: 2 } });
  assert.equal(addedLightId(doc, added.doc), "light-2");
  assert.equal(addedLightId(added.doc, added.doc), null);
  const corridor = setLightKind(doc, "light-1", "corridor");
  assert.equal(corridor.lights[0].kind, "corridor");
  assert.equal(corridor.lights[0].x, -6);
  assert.ok(isRefusal(setLightKind(doc, "nope", "room")));
});

test("extending or trimming a room is refused when it would bury a light in a wall", () => {
  const open = parses({ ...fixture(), lights: [{ id: "light-1", x: 0, z: -2, kind: "corridor" }] });
  const grown = addRoomRect(open, "west", { i0: 2, i1: 3, j0: 0, j1: 1 });
  assert.equal(
    isRefusal(grown) ? grown.refused : null,
    "light light-1 would end up inside a wall, move it first",
  );
  const merged = parses({
    ...fixture(),
    rooms: [
      {
        id: "west",
        rects: [
          { i0: 0, i1: 2, j0: 0, j1: 3 },
          { i0: 2, i1: 3, j0: 0, j1: 1 },
        ],
      },
      { id: "east", rects: [{ i0: 3, i1: 5, j0: 0, j1: 3 }] },
    ],
    doors: [],
    lights: [{ id: "light-1", x: -2, z: -4, kind: "corridor" }],
  });
  assert.ok(isRefusal(removeRoomRect(merged, "west", 1)));
  const clear = parses({ ...fixture(), lights: [{ id: "light-1", x: -6, z: 0, kind: "room" }] });
  assert.ok(!isRefusal(addRoomRect(clear, "west", { i0: 2, i1: 3, j0: 0, j1: 1 })));
});

test("changed entities name moved and added lights and count removed ones", () => {
  const before = parses({
    ...fixture(),
    lights: [
      { id: "light-1", x: -6, z: 0, kind: "room" },
      { id: "light-2", x: -5, z: 2, kind: "room" },
    ],
  });
  const moved = moveLight(before, { id: "light-1", to: { x: -5, z: 0 } }).doc;
  const after = addLight(removeLight(moved, { id: "light-2" }).doc, { at: { x: -4, z: -2 } }).doc;
  const { keys, removed } = changedEntities(before, after);
  assert.deepEqual(keys.sort(), ["light:light-1", "light:light-2"]);
  assert.equal(removed, 0);
  assert.deepEqual(changedEntities(before, removeLight(before, { id: "light-2" }).doc), {
    keys: [],
    removed: 1,
  });
});

test("adding, proposing and removing lights are undoable steps", () => {
  const start = parses(fixture());
  let history = createHistory(start);
  const added = addLight(start, { at: { x: -6, z: 0 } });
  history = commit(history, fromOp(added), "Add light", "local");
  const proposed = proposeLights(history.present.doc, { roomCount: 1 });
  history = commit(history, fromOp(proposed), "Propose lights", "local");
  assert.equal(history.present.doc.lights.filter((light) => light.kind === "room").length, 1);
  history = undo(history);
  assert.deepEqual(history.present.doc.lights, [{ id: "light-1", x: -6, z: 0, kind: "room" }]);
  history = undo(history);
  assert.equal(history.present.doc.lights, undefined);
  history = redo(history);
  assert.equal(history.present.doc.lights.length, 1);
});

test("history undoes and redoes local and external steps alike, and a new step drops the redo branch", () => {
  const first = fixture();
  const second = { ...first, doors: [] };
  const third = { ...first, objects: [] };
  let history = createHistory(first);
  assert.equal(canUndo(history), false);
  history = commit(history, second, "Close door", "local");
  history = commit(history, third, "External: 2 changed", "external", ["object:chair-1"]);
  assert.equal(history.present.source, "external");
  history = undo(history);
  assert.equal(history.present.doc, second);
  assert.ok(canRedo(history));
  history = redo(history);
  assert.equal(history.present.doc, third);
  history = commit(undo(history), first, "Back", "local");
  assert.equal(canRedo(history), false);
  assert.equal(commit(history, history.present.doc, "noop", "local"), history);
});

test("history keeps a bounded number of steps", () => {
  let history = createHistory(fixture());
  for (let step = 0; step < HISTORY_LIMIT + 10; step++) {
    history = commit(history, { ...fixture(), objects: [] }, `step ${step}`, "local");
  }
  assert.equal(history.past.length, HISTORY_LIMIT);
});

test("the bridge rejects a body that is not JSON or not a valid document, naming why", () => {
  assert.throws(
    () => acceptLevelText("{ nope", SOURCE),
    (error) =>
      error instanceof LevelWriteError && error.status === 400 && /not JSON/.test(error.message),
  );
  const urban = JSON.stringify({ ...fixture(), id: "urban" });
  assert.throws(
    () => acceptLevelText(urban, SOURCE),
    (error) =>
      error instanceof LevelWriteError && error.status === 422 && /station/.test(error.message),
  );
  const unknownType = JSON.stringify({
    ...fixture(),
    objects: [{ id: "x", type: "sofa", x: 0, z: 0, yaw: 0 }],
  });
  assert.throws(() => acceptLevelText(unknownType, SOURCE), /sofa/);
  assert.deepEqual(acceptLevelText(JSON.stringify(fixture()), SOURCE), fixture());
});

test("the bridge writes atomically and leaves no temporary file behind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "morphy-bridge-"));
  try {
    const file = join(dir, "station.level.json");
    await writeFile(file, "old", "utf8");
    const text = formatLevelDocument(fixture());
    await writeLevelFile(file, text);
    assert.equal(await readFile(file, "utf8"), text);
    assert.deepEqual(await readdir(dir), ["station.level.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the bridge serves the committed station document and it re-serialises byte for byte", async () => {
  const source = levelSources(new URL("../packages/client", import.meta.url).pathname).station;
  const text = await readFile(source.file, "utf8");
  assert.equal(formatLevelDocument(await stationDocument()), text);
});

test("a held key's repeats fold into one undo step, a different step does not", () => {
  const base = fixture();
  let history = commit(createHistory(base), { ...base, doors: [] }, "Rotate chair-1", "local");
  history = commitMerged(history, { ...base, objects: [] }, "Rotate chair-1");
  assert.equal(history.past.length, 1);
  assert.deepEqual(history.present.doc.objects, []);
  history = commitMerged(history, base, "Rotate table-1");
  assert.equal(history.past.length, 2);
});
