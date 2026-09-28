import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  addObject,
  addRoom,
  addRoomRect,
  changedEntities,
  deleteRoomRect,
  deleteSpawn,
  duplicateObject,
  edgeAt,
  isRefusal,
  moveRectEdge,
  normalizeYaw,
  objectAt,
  QUARTER_TURN,
  rectBetween,
  rectEdgeAt,
  setRoomRect,
  snapPosition,
  toggleDoor,
  turnYaw,
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
  isLocalRequest,
  LevelWriteError,
  levelSources,
  writeLevelFile,
} from "../packages/client/viteLevelBridge.ts";
import { formatLevelDocument, parseLevelDocument } from "../packages/level/src/index.ts";
import { SPACE_CATALOG } from "../packages/server/src/spaceCatalog.ts";

const SOURCE = { id: "station", file: "unused", catalog: SPACE_CATALOG };

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

test("positions snap to half a metre unless free, which keeps millimetres", () => {
  assert.equal(snapPosition(1.26, false), 1.5);
  assert.equal(snapPosition(-0.24, false), 0);
  assert.equal(Object.is(snapPosition(-0.24, false), -0), false);
  assert.equal(snapPosition(1.23456, true), 1.235);
});

test("a quarter turn lands on the next grid direction, an off-grid yaw on the nearest one that way", () => {
  assert.equal(turnYaw(0, 1, false), QUARTER_TURN);
  assert.equal(turnYaw(QUARTER_TURN, 1, false), Math.PI);
  assert.equal(turnYaw(Math.PI, 1, false), -QUARTER_TURN);
  assert.equal(turnYaw(0, -1, false), -QUARTER_TURN);
  assert.equal(turnYaw(0.3, 1, false), QUARTER_TURN);
  assert.equal(turnYaw(0.3, -1, false), 0);
});

test("a free turn steps five degrees and stays in (-PI, PI]", () => {
  const turned = turnYaw(QUARTER_TURN, -1, true);
  assert.ok(Math.abs((turned * 180) / Math.PI - 85) < 1e-4);
  assert.equal(normalizeYaw(-Math.PI), Math.PI);
  assert.ok(Math.abs(normalizeYaw(3 * Math.PI) - Math.PI) < 1e-9);
});

test("toggling a door opens a wall edge, closes an open one and refuses an edge with no wall", () => {
  const doc = fixture();
  const opened = toggleDoor(doc, { axis: "v", line: 3, cell: 0 });
  assert.ok(!isRefusal(opened));
  assert.equal(opened.doors.length, 2);
  parses(opened);
  const closed = toggleDoor(doc, { axis: "v", line: 2, cell: 1 });
  assert.equal(closed.doors.length, 0);
  assert.ok(isRefusal(toggleDoor(doc, { axis: "v", line: 1, cell: 1 })));
  assert.ok(isRefusal(toggleDoor(doc, { axis: "v", line: 5, cell: 1 })));
});

test("the edge under the pointer is the nearest grid line within tolerance", () => {
  const doc = fixture();
  assert.deepEqual(edgeAt(doc, -2.1, -1, 0.2), { axis: "v", line: 2, cell: 1 });
  assert.deepEqual(edgeAt(doc, 5, -2.05, 0.2), { axis: "h", line: 1, cell: 3 });
  assert.equal(edgeAt(doc, -4, -4, 0.2), null);
});

test("a new room fills free cells and refuses to overlap another room", () => {
  const doc = fixture();
  const result = addRoom(doc, rectBetween(doc, { i: 2, j: 0 }, { i: 2, j: 1 }));
  assert.ok(!isRefusal(result));
  assert.equal(result.id, "room-1");
  parses(result.doc);
  const overlap = addRoom(doc, rectBetween(doc, { i: 1, j: 0 }, { i: 2, j: 0 }));
  assert.ok(isRefusal(overlap));
  assert.match(overlap.refused, /west/);
});

test("rects of one room may extend it into an L; resizing refuses an overlap and prunes stranded doors", () => {
  const doc = fixture();
  const extended = addRoomRect(doc, "west", { i0: 2, i1: 3, j0: 2, j1: 3 });
  assert.ok(!isRefusal(extended));
  assert.equal(extended.rooms[0].rects.length, 2);
  parses(extended);
  assert.ok(isRefusal(setRoomRect(doc, "west", 0, { i0: 0, i1: 4, j0: 0, j1: 3 })));
  const widened = setRoomRect(doc, "west", 0, moveRectEdge(doc.rooms[0].rects[0], "i1", 3));
  assert.ok(!isRefusal(widened));
  assert.equal(widened.doors.length, 0, "the door into open ground now sits inside west");
  parses(widened);
});

test("an edge handle is the nearest rect side, and a rect never shrinks below one cell", () => {
  const rect = { i0: 0, i1: 2, j0: 0, j1: 3 };
  assert.equal(rectEdgeAt(rect, 2.1, 1.5, 0.2), "i1");
  assert.equal(rectEdgeAt(rect, 1, 0.05, 0.2), "j0");
  assert.equal(rectEdgeAt(rect, 1, 1.5, 0.2), null);
  assert.deepEqual(moveRectEdge(rect, "i1", 0), { ...rect, i1: 1 });
});

test("deleting drops one rect of an L, then the room, but never the last room", () => {
  const doc = fixture();
  const l = addRoomRect(doc, "west", { i0: 2, i1: 3, j0: 2, j1: 3 });
  assert.equal(deleteRoomRect(l, "west", 1).rooms[0].rects.length, 1);
  const noWest = deleteRoomRect(doc, "west", 0);
  assert.deepEqual(
    noWest.rooms.map((room) => room.id),
    ["east"],
  );
  assert.equal(noWest.doors.length, 0);
  parses(noWest);
  assert.ok(isRefusal(deleteRoomRect(noWest, "east", 0)));
});

test("new and duplicated objects get unique ids and stay inside the map", () => {
  const doc = fixture();
  const added = addObject(doc, "chair", 50, -50, 0);
  assert.equal(added.id, "chair-2");
  const placed = added.doc.objects.at(-1);
  assert.deepEqual([placed.x, placed.z], [10, -6]);
  parses(added.doc);
  const copy = duplicateObject(added.doc, "table-1", 1);
  assert.equal(copy.id, "table-2");
  assert.equal(copy.doc.objects.at(-1).yaw, QUARTER_TURN);
  assert.ok(isRefusal(duplicateObject(doc, "missing", 1)));
});

test("an object is picked inside its footprint radius, nearest first", () => {
  const doc = fixture();
  assert.equal(
    objectAt(doc, -6.8, -2, () => 0.5),
    "chair-1",
  );
  assert.equal(
    objectAt(doc, -5, -2, () => 0.5),
    null,
  );
});

test("each team keeps at least one spawn", () => {
  const doc = fixture();
  assert.ok(isRefusal(deleteSpawn(doc, "props", 0)));
  const two = { ...doc, spawns: { ...doc.spawns, props: [...doc.spawns.props, { x: 6, z: 2 }] } };
  assert.deepEqual(deleteSpawn(two, "props", 0).spawns.props, [{ x: 6, z: 2 }]);
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
  assert.equal(formatLevelDocument(acceptLevelText(text, source)), text);
});

test("the bridge answers only unrelayed requests from this machine", () => {
  assert.equal(isLocalRequest("127.0.0.1", {}), true);
  assert.equal(isLocalRequest("::1", {}), true);
  assert.equal(isLocalRequest("192.168.1.20", {}), false);
  assert.equal(isLocalRequest("127.0.0.1", { "x-forwarded-for": "203.0.113.9" }), false);
  assert.equal(isLocalRequest(undefined, {}), false);
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
