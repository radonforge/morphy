import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  formatFinding,
  formatLevelDocument,
  parseLevelDocument,
  planRoom,
  summarizeLevel,
} from "../packages/level/src/index.ts";
import { SPACE_CATALOG } from "../packages/server/src/spaceCatalog.ts";
import { ASSET_CARDS } from "../packages/shared/src/index.ts";

const STATION = fileURLToPath(
  new URL("../packages/server/src/maps/station.level.json", import.meta.url),
);
const CLI = fileURLToPath(new URL("../tools/level/cli.ts", import.meta.url));
const CONTEXT = { catalog: SPACE_CATALOG, cards: ASSET_CARDS };
const EXIT_INVALID = 1;
const EXIT_USAGE = 2;

let dir;
let file;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "morphy-level-"));
  file = join(dir, "station.level.json");
  await copyFile(STATION, file);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function level(...args) {
  const result = spawnSync(process.execPath, ["--import", "tsx", CLI, ...args, "--file", file], {
    encoding: "utf8",
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

async function current() {
  return parseLevelDocument(JSON.parse(await readFile(file, "utf8")), { catalog: SPACE_CATALOG });
}

test("the serializer reproduces the committed station document byte for byte", async () => {
  const text = await readFile(STATION, "utf8");
  assert.equal(formatLevelDocument(JSON.parse(text)), text);
});

test("the summary names every room with its size and every door", async () => {
  const doc = await current();
  const summary = summarizeLevel(doc, CONTEXT);
  assert.match(
    summary,
    /^station: 22x18 cells of 4 m \(88 x 72 m\), 7 rooms, 11 doors, 147 objects/,
  );
  assert.match(summary, /command: x -44\.\.-4, z -36\.\.-4 \(40 x 32 m\)/);
  for (const room of doc.rooms) assert.ok(summary.includes(`  ${room.id}: `));
  assert.ok(summary.includes("v:10:3 command | corridor at (-4, -22)"));
});

test("a room plan is 0.5 m per character with walls, a doorway and a legend", async () => {
  const doc = await current();
  const plan = planRoom(doc, CONTEXT, "quarters").split("\n");
  const rows = plan.filter((line) => /^\s*-?\d+(\.\d+)? /.test(line));
  assert.equal(rows.length, (1 + 32) / 0.5, "a 1 m margin north, none past the map's south edge");
  assert.ok(rows.every((row) => row.length === rows[0].length));
  assert.ok(
    rows.some((row) => row.includes("+")),
    "a doorway",
  );
  assert.ok(
    rows.some((row) => row.includes("#")),
    "walls",
  );
  const quartersObjects = doc.objects.filter((o) => o.id.startsWith("quarters-")).length;
  assert.ok(plan.filter((line) => /^ {2}\S quarters-/.test(line)).length === quartersObjects);
});

test("a finding prints as one line", () => {
  const line = formatFinding({
    code: "object.wall",
    severity: "error",
    message: "x cuts into a wall",
    entities: ["x"],
    at: { x: 1, z: -2.5 },
    hint: "move it",
  });
  assert.equal(line, "error object.wall [x] at (1, -2.5): x cuts into a wall | fix: move it");
});

test("view, list and check read the document without writing it", async () => {
  const before = await readFile(file, "utf8");
  const view = level("view");
  assert.equal(view.code, 0, view.err);
  assert.match(view.out, /7 rooms, 11 doors/);
  assert.match(level("view", "lab").out, /plan of lab/);
  assert.equal(level("list", "lab").out.trim().split("\n").length, 17);
  const check = level("check");
  assert.equal(check.code, 0, check.err);
  assert.match(check.out, /totals: rooms 7, doors 11, objects 147/);
  assert.match(level("check", "hangar").out, /hangar: area\.m2 1280/);
  assert.equal(await readFile(file, "utf8"), before);
});

test("an edit chain writes the document, keeps it valid and prints the report delta", async () => {
  const placed = level("place", "barrel", "--center", "hangar", "--id", "probe");
  assert.equal(placed.code, 0, placed.out + placed.err);
  assert.match(placed.out, /placed probe \(barrel\) at \(24, 20\)/);
  assert.match(placed.out, /wrote /);
  assert.match(placed.out, /~ objects 147 -> 148/);
  assert.ok((await current()).objects.some((object) => object.id === "probe"));

  assert.equal(level("move", "probe", "--by=-1,0.5").code, 0);
  assert.equal(level("rotate", "probe").code, 0);
  let probe = (await current()).objects.find((object) => object.id === "probe");
  assert.deepEqual([probe.x, probe.z, probe.yaw], [23, 20.5, Math.PI / 2]);

  const copy = level("duplicate", "probe", "--side", "E", "--id", "probe-copy");
  assert.equal(copy.code, 0, copy.out);
  assert.equal(level("remove", "probe-copy").code, 0);
  assert.equal(level("remove", "probe").code, 0);

  const closed = level("door", "toggle", "v:12:13");
  assert.equal(closed.code, 0, closed.out);
  assert.match(closed.out, /closed door v:12:13/);
  assert.equal(level("door", "toggle", "v:12:13").code, 0);

  const text = await readFile(file, "utf8");
  assert.equal(formatLevelDocument(JSON.parse(text)), text, "written in the formatter's layout");
  probe = (await current()).objects.find((object) => object.id === "probe");
  assert.equal(probe, undefined);
  const original = JSON.parse(await readFile(STATION, "utf8"));
  const final = JSON.parse(text);
  const byKey = (doors) => doors.map((d) => `${d.axis}:${d.line}:${d.cell}`).sort();
  assert.deepEqual(final.objects, original.objects);
  assert.deepEqual(byKey(final.doors), byKey(original.doors));
});

test("a blocked edit exits non-zero, names the blocker and writes nothing", async () => {
  const before = await readFile(file, "utf8");
  const [target] = (await current()).objects;
  const result = level("place", "barrel", `--at=${target.x},${target.z}`);
  assert.equal(result.code, EXIT_INVALID);
  assert.match(result.out, new RegExp(`op\\.blocked .*${target.id}`));
  assert.equal(await readFile(file, "utf8"), before);
});

test("bad input exits non-zero and says what to fix", async () => {
  const before = await readFile(file, "utf8");
  const cases = [
    [["place", "no-such-type", "--at", "0,0"], EXIT_INVALID, /not in the prop catalog/],
    [["place", "barrel"], EXIT_USAGE, /exactly one of --at/],
    [["move", "command-1"], EXIT_USAGE, /move needs exactly one of --to/],
    [["move", "command-1", "--by", "-1,0"], EXIT_USAGE, /--by=-XYZ/],
    [["move", "command-1", "--to=1,1", "--by=1,1"], EXIT_USAGE, /exactly one of --to/],
    [["place", "barrel", "--at=,"], EXIT_USAGE, /needs 2 comma-separated numbers/],
    [["door", "toggle", "v:1.5:1"], EXIT_INVALID, /grid border or off the grid/],
    [["room", "resize", "lab", "0,22,0,4"], EXIT_INVALID, /overlaps room/],
    [["door", "toggle", "v:0:0"], EXIT_INVALID, /grid border/],
    [["view", "nowhere"], EXIT_USAGE, /no room "nowhere"/],
    [["fly"], EXIT_USAGE, /unknown command/],
  ];
  for (const [args, code, message] of cases) {
    const result = level(...args);
    assert.equal(result.code, code, `${args.join(" ")}: ${result.out}${result.err}`);
    assert.match(result.out + result.err, message);
  }
  assert.equal(await readFile(file, "utf8"), before);
});
