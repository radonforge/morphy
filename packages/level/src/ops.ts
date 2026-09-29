import { FRONT_YAW, LEVEL_BODY_RADIUS, LEVEL_OVERLAP_TOLERANCE } from "@morphy/shared";
import type { Finding } from "./checks";
import type { CellRect, LevelDocument, LevelDoor, LevelObject, LevelPoint } from "./document";
import { doorKey, TILE, WALL_HALF_THICKNESS } from "./floorplan";
import {
  type LevelContext,
  objectFootprint,
  objectHitboxes,
  type ShapeExtent,
  shapeExtent,
} from "./footprint";
import { degrees, point } from "./format";
import {
  circleHitsRect,
  overlapDepth,
  POSITION_SNAP,
  type Rect2,
  rectCorners,
  rectExtent,
  SNAP_EPSILON,
  snapToward,
  spansMeet,
} from "./geometry";
import { keepLightsClear } from "./lightOps";
import { buildSpace, doorRegions, type LevelSpace, lineX, lineZ, regionGrid } from "./space";

/** Yaw snaps to quarter turns unless an operation is asked to rotate freely. */
export const QUARTER_TURN = Math.PI / 2;

const OPEN_GROUND_PREFIX = "object";

/** What an operation returns: the new document (the input unchanged on failure) and what it has to say. */
export interface OpResult {
  doc: LevelDocument;
  findings: Finding[];
  ok: boolean;
}

/** A wall of a room by compass side: N is -Z, S is +Z, E is +X, W is -X. */
export type Side = "N" | "S" | "E" | "W";

export const SIDES: readonly Side[] = ["N", "S", "E", "W"];

/**
 * Where {@link placeObject} puts an object. `center` is the middle of the room's largest
 * rect; `againstWall` backs the object onto that wall, sliding along it to the first free
 * spot, with its tagged front (`ASSET_TAGS`) facing into the room; `nextTo` sets it touching
 * another object on one side; `row` lines `count` copies up across the room's middle.
 */
export type Placement =
  | { at: LevelPoint }
  | { center: string }
  | { againstWall: { room: string; side: Side }; facing: "in" }
  | { nextTo: string; side: Side }
  | { row: { room: string; along: "x" | "z"; count: number; gap: number } };

export interface PlaceArgs {
  type: string;
  relation: Placement;
  /** Id of the object, or the prefix of `<id>-<n>` ids for a row. Defaults to `<room>-<n>`. */
  id?: string;
  /** Yaw in degrees, snapped to quarter turns unless `free`. Ignored by `againstWall`, which faces in. */
  yawDegrees?: number;
  /** Yaw in radians kept exactly, never snapped, over `yawDegrees`: how a copy keeps its source's turn. */
  exactYaw?: number;
  /** Keep the exact position and yaw instead of snapping them. */
  free?: boolean;
}

const FACING_IN: Record<Side, number> = { N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2 };

function fail(
  doc: LevelDocument,
  code: string,
  message: string,
  hint: string,
  entities: string[] = [],
): OpResult {
  return { doc, ok: false, findings: [{ code, severity: "error", message, entities, hint }] };
}

function done(doc: LevelDocument, findings: Finding[] = []): OpResult {
  return { doc, ok: true, findings };
}

function snap(value: number, free: boolean): number {
  return free ? value : Math.round(value / POSITION_SNAP) * POSITION_SNAP;
}

function normalizeYaw(yaw: number): number {
  const turn = 2 * Math.PI;
  const wrapped = ((((yaw + Math.PI) % turn) + turn) % turn) - Math.PI;
  return wrapped <= -Math.PI + SNAP_EPSILON ? Math.PI : wrapped;
}

function snapYaw(yaw: number, free: boolean): number {
  return normalizeYaw(free ? yaw : Math.round(yaw / QUARTER_TURN) * QUARTER_TURN);
}

/** An info finding when snapping turned `wanted` into a different `applied` yaw, so the rounding is never silent. */
function yawNote(id: string, wanted: number, applied: number): Finding[] {
  if (Math.abs(normalizeYaw(wanted - applied)) < SNAP_EPSILON) return [];
  return [
    {
      code: "op.yaw-snapped",
      severity: "info",
      message: `${id} yaw ${degrees(normalizeYaw(wanted))} was rounded to the quarter turn ${degrees(applied)}`,
      entities: [id],
      hint: "pass free to keep the exact yaw",
    },
  ];
}

function requestedYaw(args: PlaceArgs, wallYaw: number | undefined): number {
  return wallYaw ?? args.exactYaw ?? ((args.yawDegrees ?? 0) * Math.PI) / 180;
}

function placedYaw(args: PlaceArgs, wallYaw: number | undefined): number {
  if (wallYaw !== undefined || args.exactYaw !== undefined) return requestedYaw(args, wallYaw);
  return snapYaw(requestedYaw(args, wallYaw), args.free === true);
}

function largestRect(doc: LevelDocument, roomId: string): CellRect | undefined {
  const room = doc.rooms.find((entry) => entry.id === roomId);
  if (room === undefined) return undefined;
  const area = (r: CellRect): number => (r.i1 - r.i0) * (r.j1 - r.j0);
  return room.rects.reduce((best, r) => (area(r) > area(best) ? r : best));
}

function rectCentre(doc: LevelDocument, rect: CellRect): LevelPoint {
  return {
    x: (lineX(doc, rect.i0) + lineX(doc, rect.i1)) / 2,
    z: (lineZ(doc, rect.j0) + lineZ(doc, rect.j1)) / 2,
  };
}

function nextId(doc: LevelDocument, prefix: string, taken: Set<string>): string {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);
  let highest = 0;
  for (const object of doc.objects) {
    const match = pattern.exec(object.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  let n = highest + 1;
  while (taken.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

function extentOf(extent: ShapeExtent, yaw: number): { ex: number; ez: number } {
  const e = rectExtent({ x: 0, z: 0, yaw, halfX: extent.halfX, halfZ: extent.halfZ });
  return { ex: e.maxX, ez: e.maxZ };
}

/**
 * What stops `candidate` standing where it is in `space`: the map edge, walls, other
 * objects' footprints (`extra` counts too, `ignore` does not), doorway clearance zones
 * and spawn points.
 */
function blockersOf(
  space: LevelSpace,
  candidate: LevelObject,
  extent: ShapeExtent,
  ignore: ReadonlySet<string>,
  extra: readonly LevelObject[] = [],
): string[] {
  const { doc, context } = space;
  const rect: Rect2 = {
    x: candidate.x,
    z: candidate.z,
    yaw: candidate.yaw,
    halfX: extent.halfX,
    halfZ: extent.halfZ,
  };
  const blockers: string[] = [];
  const room = space.regionAt(candidate.x, candidate.z);
  if (room === null) blockers.push("open ground, outside every room");
  if (room !== null && room !== undefined) {
    const strays = rectCorners(rect).some((corner) => space.regionAt(corner.x, corner.z) !== room);
    if (strays) blockers.push(`the edge of room ${room}`);
  }
  const e = rectExtent(rect);
  if (
    e.minX < -space.halfW ||
    e.maxX > space.halfW ||
    e.minZ < -space.halfD ||
    e.maxZ > space.halfD
  ) {
    blockers.push("the map edge");
  }
  if (space.walls.some((wall) => overlapDepth(wall, rect) > LEVEL_OVERLAP_TOLERANCE)) {
    blockers.push("a wall");
  }
  for (const object of [...doc.objects, ...extra]) {
    if (ignore.has(object.id)) continue;
    const footprint = space.footprints.get(object.id) ?? objectFootprint(object, context);
    if (footprint !== null && !spansMeet(footprint, extent)) continue;
    const shapes = footprint === null ? objectHitboxes(object, context) : [footprint.rect];
    if (shapes.some((shape) => overlapDepth(shape, rect) > LEVEL_OVERLAP_TOLERANCE)) {
      blockers.push(`${object.id} (${object.type})`);
    }
  }
  const boxes = objectHitboxes(candidate, context);
  for (const zone of space.doors) {
    const inDoorway = zone.sides.some((side) =>
      boxes.some((box) => overlapDepth(box, side.zone) > LEVEL_OVERLAP_TOLERANCE),
    );
    if (inDoorway) blockers.push(`the doorway ${zone.key}`);
  }
  for (const kind of ["props", "hunters"] as const) {
    doc.spawns[kind].forEach((spawn, index) => {
      if (boxes.some((box) => circleHitsRect(spawn.x, spawn.z, LEVEL_BODY_RADIUS, box))) {
        blockers.push(`spawns.${kind}[${index}]`);
      }
    });
  }
  return blockers;
}

function describe(object: LevelObject): string {
  return `${object.id} (${object.type}) at ${point(object)} yaw ${degrees(object.yaw)}`;
}

function blocked(
  doc: LevelDocument,
  object: LevelObject,
  blockers: string[],
  hint: string,
): OpResult {
  return fail(
    doc,
    "op.blocked",
    `${object.id} (${object.type}) at ${point(object)} would collide with ${blockers.join(", ")}`,
    hint,
    [object.id],
  );
}

/** The yaw that turns a type's tagged front into the room from `side`; a model-less shape fronts +Z. */
function facingIn(
  doc: LevelDocument,
  context: LevelContext,
  type: string,
  side: Side,
): number | OpResult {
  const model = context.catalog.find((entry) => entry.id === type)?.model;
  if (model === undefined) return FACING_IN[side];
  const tags = context.tags[model];
  if (tags === undefined) {
    return fail(
      doc,
      "op.invalid",
      `type "${type}" has no asset tags, so its front is unknown`,
      "add its model to ASSET_TAGS in packages/shared/src/assetTags.ts",
    );
  }
  return normalizeYaw(FACING_IN[side] - FRONT_YAW[tags.front]);
}

function measure(doc: LevelDocument, context: LevelContext, type: string): ShapeExtent | OpResult {
  const def = context.catalog.find((entry) => entry.id === type);
  if (def === undefined) {
    return fail(doc, "op.invalid", `type "${type}" is not in the prop catalog`, "use a catalog id");
  }
  const extent = shapeExtent(def, context);
  if (extent === null) {
    return fail(doc, "op.invalid", `type "${type}" has no asset card`, "run pnpm cards");
  }
  return extent;
}

function candidates(
  doc: LevelDocument,
  context: LevelContext,
  args: PlaceArgs,
  extent: ShapeExtent,
  yaw: number,
): LevelPoint[][] | OpResult {
  const free = args.free === true;
  const { relation } = args;
  if ("at" in relation) return [[{ x: snap(relation.at.x, free), z: snap(relation.at.z, free) }]];
  if ("center" in relation) {
    const rect = largestRect(doc, relation.center);
    if (rect === undefined)
      return fail(doc, "op.invalid", `no room "${relation.center}"`, "use a room id");
    const c = rectCentre(doc, rect);
    return [[{ x: snap(c.x, free), z: snap(c.z, free) }]];
  }
  if ("nextTo" in relation) {
    const target = doc.objects.find((object) => object.id === relation.nextTo);
    if (target === undefined) {
      return fail(doc, "op.invalid", `no object "${relation.nextTo}"`, "use pnpm level list");
    }
    const targetExtent = measure(doc, context, target.type);
    if ("doc" in targetExtent) return targetExtent;
    const t = extentOf(targetExtent, target.yaw);
    const own = extentOf(extent, yaw);
    const place = (x: number, z: number): LevelPoint[][] => [[{ x, z }]];
    switch (relation.side) {
      case "N":
        return place(
          snap(target.x, free),
          free ? target.z - t.ez - own.ez : snapToward(target.z - t.ez - own.ez, -1),
        );
      case "S":
        return place(
          snap(target.x, free),
          free ? target.z + t.ez + own.ez : snapToward(target.z + t.ez + own.ez, 1),
        );
      case "W":
        return place(
          free ? target.x - t.ex - own.ex : snapToward(target.x - t.ex - own.ex, -1),
          snap(target.z, free),
        );
      case "E":
        return place(
          free ? target.x + t.ex + own.ex : snapToward(target.x + t.ex + own.ex, 1),
          snap(target.z, free),
        );
    }
  }
  if ("row" in relation) {
    const { room, along, count, gap } = relation.row;
    if (!Number.isInteger(count) || count < 1 || !(gap >= 0)) {
      return fail(
        doc,
        "op.invalid",
        "a row needs a whole count of at least 1 and a gap of 0 or more",
        "fix count and gap",
      );
    }
    const rect = largestRect(doc, room);
    if (rect === undefined) return fail(doc, "op.invalid", `no room "${room}"`, "use a room id");
    const c = rectCentre(doc, rect);
    const own = extentOf(extent, yaw);
    const rawPitch = 2 * (along === "x" ? own.ex : own.ez) + gap;
    const pitch = free ? rawPitch : snapToward(rawPitch, 1);
    const span = along === "x" ? (rect.i1 - rect.i0) * TILE : (rect.j1 - rect.j0) * TILE;
    if (count * pitch - gap > span) {
      return fail(
        doc,
        "op.invalid",
        `a row of ${count} ${args.type} at ${pitch} m pitch is longer than ${room}'s ${span} m`,
        "lower the count or the gap",
      );
    }
    const slots = Array.from({ length: count }, (_, k) => {
      const offset = (k - (count - 1) / 2) * pitch;
      return along === "x"
        ? { x: snap(c.x + offset, free), z: snap(c.z, free) }
        : { x: snap(c.x, free), z: snap(c.z + offset, free) };
    });
    return [slots];
  }
  const { room, side } = relation.againstWall;
  const roomDef = doc.rooms.find((entry) => entry.id === room);
  if (roomDef === undefined) return fail(doc, "op.invalid", `no room "${room}"`, "use a room id");
  const own = extentOf(extent, yaw);
  const outer = (r: CellRect): number =>
    side === "N" ? -r.j0 : side === "S" ? r.j1 : side === "W" ? -r.i0 : r.i1;
  const rect = roomDef.rects.reduce((best, r) => (outer(r) > outer(best) ? r : best));
  const along = (
    from: number,
    to: number,
    reach: number,
    fixed: number,
    onX: boolean,
  ): LevelPoint[][] => {
    const mid = (from + to) / 2;
    const steps = Math.floor((to - from) / 2 / POSITION_SNAP);
    const out: LevelPoint[] = [];
    for (let k = 0; k <= steps; k++) {
      for (const sign of k === 0 ? [1] : [1, -1]) {
        const value = snap(mid + sign * k * POSITION_SNAP, free);
        if (value - reach < from - SNAP_EPSILON || value + reach > to + SNAP_EPSILON) continue;
        out.push(onX ? { x: value, z: fixed } : { x: fixed, z: value });
      }
    }
    return out.map((p) => [p]);
  };
  const face = WALL_HALF_THICKNESS;
  switch (side) {
    case "N": {
      const z = lineZ(doc, rect.j0) + face + own.ez;
      return along(
        lineX(doc, rect.i0),
        lineX(doc, rect.i1),
        own.ex,
        free ? z : snapToward(z, 1),
        true,
      );
    }
    case "S": {
      const z = lineZ(doc, rect.j1) - face - own.ez;
      return along(
        lineX(doc, rect.i0),
        lineX(doc, rect.i1),
        own.ex,
        free ? z : snapToward(z, -1),
        true,
      );
    }
    case "W": {
      const x = lineX(doc, rect.i0) + face + own.ex;
      return along(
        lineZ(doc, rect.j0),
        lineZ(doc, rect.j1),
        own.ez,
        free ? x : snapToward(x, 1),
        false,
      );
    }
    case "E": {
      const x = lineX(doc, rect.i1) - face - own.ex;
      return along(
        lineZ(doc, rect.j0),
        lineZ(doc, rect.j1),
        own.ez,
        free ? x : snapToward(x, -1),
        false,
      );
    }
  }
}

/**
 * Place a new catalog object by a spatial relation. Positions snap to
 * {@link POSITION_SNAP} and yaw to quarter turns unless `free`. When no spot the
 * relation allows is clear of walls, objects, doorways and spawns, nothing is placed
 * and the error finding names what blocks the first spot tried.
 */
export function placeObject(doc: LevelDocument, args: PlaceArgs, context: LevelContext): OpResult {
  const extent = measure(doc, context, args.type);
  if ("doc" in extent) return extent;
  const wallYaw =
    "againstWall" in args.relation
      ? facingIn(doc, context, args.type, args.relation.againstWall.side)
      : undefined;
  if (typeof wallYaw === "object") return wallYaw;
  const yaw = placedYaw(args, wallYaw);
  const options = candidates(doc, context, args, extent, yaw);
  if ("doc" in options) return options;
  if (options.length === 0) {
    return fail(
      doc,
      "op.blocked",
      `${args.type} does not fit along that wall`,
      "pick a longer wall or a smaller type",
    );
  }
  const taken = new Set(doc.objects.map((object) => object.id));
  const regions = regionGrid(doc);
  const space = buildSpace(doc, context);
  const idFor = (p: LevelPoint, index: number, count: number): string => {
    if (args.id !== undefined) return count === 1 ? args.id : `${args.id}-${index + 1}`;
    const region = regions(
      Math.floor((p.x + (doc.grid.cols * TILE) / 2) / TILE),
      Math.floor((p.z + (doc.grid.rows * TILE) / 2) / TILE),
    );
    return nextId(doc, region ?? OPEN_GROUND_PREFIX, taken);
  };

  let first: { object: LevelObject; blockers: string[] } | null = null;
  for (const slots of options) {
    const placed: LevelObject[] = [];
    let clear = true;
    for (const [index, p] of slots.entries()) {
      const id = idFor(p, index, slots.length);
      if (taken.has(id)) {
        return fail(doc, "op.invalid", `id "${id}" is already used`, "pick another id", [id]);
      }
      const object: LevelObject = { id, type: args.type, x: p.x, z: p.z, yaw };
      const blockers = blockersOf(space, object, extent, new Set(), placed);
      if (blockers.length > 0) {
        first ??= { object, blockers };
        clear = false;
        break;
      }
      taken.add(id);
      placed.push(object);
    }
    if (clear) {
      return done({ ...doc, objects: [...doc.objects, ...placed] }, [
        ...placed.map((object) => ({
          code: "op.placed",
          severity: "info" as const,
          message: `placed ${describe(object)}`,
          entities: [object.id],
          at: { x: object.x, z: object.z },
        })),
        ...yawNote(placed[0]!.id, requestedYaw(args, wallYaw), yaw),
      ]);
    }
    for (const object of placed) taken.delete(object.id);
  }
  const { object, blockers } = first!;
  return blocked(
    doc,
    object,
    blockers,
    "pick another spot or relation, or move what blocks it first",
  );
}

function findObject(doc: LevelDocument, id: string): LevelObject | OpResult {
  const object = doc.objects.find((entry) => entry.id === id);
  return object ?? fail(doc, "op.invalid", `no object "${id}"`, "use pnpm level list", [id]);
}

/**
 * Swap `previous` for `next` in place. Refused only for what `next` would collide with
 * that `previous` did not, so an object already touching something can still be edited.
 */
function replaceObject(
  doc: LevelDocument,
  context: LevelContext,
  previous: LevelObject,
  next: LevelObject,
  verb: string,
  notes: Finding[] = [],
): OpResult {
  const extent = measure(doc, context, next.type);
  if ("doc" in extent) return extent;
  const space = buildSpace(doc, context);
  const self = new Set([next.id]);
  const before = new Set(blockersOf(space, previous, extent, self));
  const blockers = blockersOf(space, next, extent, self).filter((b) => !before.has(b));
  if (blockers.length > 0)
    return blocked(doc, next, blockers, `${verb} it somewhere clear instead`);
  return done(
    { ...doc, objects: doc.objects.map((object) => (object.id === next.id ? next : object)) },
    [
      {
        code: `op.${verb}d`,
        severity: "info",
        message: `${verb}d ${describe(next)}`,
        entities: [next.id],
        at: next,
      },
      ...notes,
    ],
  );
}

/** Move an object to a point or by a delta, snapped unless `free`; fails when the spot is blocked. */
export function moveObject(
  doc: LevelDocument,
  args: { id: string; to?: LevelPoint; by?: LevelPoint; free?: boolean },
  context: LevelContext,
): OpResult {
  const object = findObject(doc, args.id);
  if ("doc" in object) return object;
  if ((args.to === undefined) === (args.by === undefined)) {
    return fail(
      doc,
      "op.invalid",
      "a move needs exactly one of to or by",
      "pass --to x,z or --by dx,dz",
      [args.id],
    );
  }
  const target = args.to ?? { x: object.x + args.by!.x, z: object.z + args.by!.z };
  const free = args.free === true;
  return replaceObject(
    doc,
    context,
    object,
    { ...object, x: snap(target.x, free), z: snap(target.z, free) },
    "move",
  );
}

/**
 * Turn an object in place: by `turns` quarter turns (default one) snapped to a quarter
 * turn, or by exactly `degrees` when given. Fails when the turned footprint is blocked.
 */
export function rotateObject(
  doc: LevelDocument,
  args: { id: string; turns?: number; degrees?: number },
  context: LevelContext,
): OpResult {
  const object = findObject(doc, args.id);
  if ("doc" in object) return object;
  const wanted =
    args.degrees !== undefined
      ? object.yaw + (args.degrees * Math.PI) / 180
      : object.yaw + (args.turns ?? 1) * QUARTER_TURN;
  const yaw = args.degrees !== undefined ? normalizeYaw(wanted) : snapYaw(wanted, false);
  return replaceObject(
    doc,
    context,
    object,
    { ...object, yaw },
    "rotate",
    yawNote(object.id, wanted, yaw),
  );
}

/** Remove an object. */
export function removeObject(doc: LevelDocument, args: { id: string }): OpResult {
  const object = findObject(doc, args.id);
  if ("doc" in object) return object;
  return done({ ...doc, objects: doc.objects.filter((entry) => entry.id !== args.id) }, [
    {
      code: "op.removed",
      severity: "info",
      message: `removed ${describe(object)}`,
      entities: [object.id],
    },
  ]);
}

/**
 * Copy an object to the side of it given, or to the first clear one of E, W, S, N,
 * with the same type and exactly the same yaw; the position snaps unless `free`.
 */
export function duplicateObject(
  doc: LevelDocument,
  args: { id: string; side?: Side; newId?: string; free?: boolean },
  context: LevelContext,
): OpResult {
  const object = findObject(doc, args.id);
  if ("doc" in object) return object;
  const sides: readonly Side[] = args.side !== undefined ? [args.side] : ["E", "W", "S", "N"];
  let last: OpResult | null = null;
  for (const side of sides) {
    const result = placeObject(
      doc,
      {
        type: object.type,
        relation: { nextTo: object.id, side },
        exactYaw: object.yaw,
        free: args.free === true,
        ...(args.newId !== undefined ? { id: args.newId } : {}),
      },
      context,
    );
    if (result.ok) return result;
    last ??= result;
  }
  return last!;
}

function checkRect(doc: LevelDocument, roomId: string, rect: CellRect): OpResult | null {
  const { cols, rows } = doc.grid;
  const { i0, i1, j0, j1 } = rect;
  if (
    ![i0, i1, j0, j1].every(Number.isInteger) ||
    i0 < 0 ||
    i1 > cols ||
    i0 >= i1 ||
    j0 < 0 ||
    j1 > rows ||
    j0 >= j1
  ) {
    return fail(
      doc,
      "op.invalid",
      `rect ${i0},${i1},${j0},${j1} is empty or off the ${cols}x${rows} grid`,
      `keep 0 <= i0 < i1 <= ${cols} and 0 <= j0 < j1 <= ${rows}`,
      [roomId],
    );
  }
  for (const room of doc.rooms) {
    if (room.id === roomId) continue;
    for (const other of room.rects) {
      if (other.i0 < i1 && i0 < other.i1 && other.j0 < j1 && j0 < other.j1) {
        return fail(
          doc,
          "op.invalid",
          `rect ${i0},${i1},${j0},${j1} overlaps room "${room.id}"`,
          "shrink the rect or resize that room first",
          [roomId, room.id],
        );
      }
    }
  }
  return null;
}

function pruneDoors(doc: LevelDocument): OpResult {
  const regions = regionGrid(doc);
  const kept: LevelDoor[] = [];
  const findings: Finding[] = [];
  for (const door of doc.doors) {
    const sides = doorRegions(door, regions);
    if (sides !== undefined && sides[0] !== sides[1]) {
      kept.push(door);
      continue;
    }
    findings.push({
      code: "op.door-removed",
      severity: "info",
      message: `door ${doorKey(door)} no longer separates two regions and was removed`,
      entities: [doorKey(door)],
    });
  }
  return done({ ...doc, doors: kept }, findings);
}

/** Add a room of one rect over cells no other room owns. */
export function addRoom(doc: LevelDocument, args: { id: string; rect: CellRect }): OpResult {
  if (doc.rooms.some((room) => room.id === args.id)) {
    return fail(
      doc,
      "op.invalid",
      `room "${args.id}" already exists`,
      "pick another id or resize it",
      [args.id],
    );
  }
  const bad = checkRect(doc, args.id, args.rect);
  if (bad !== null) return bad;
  return keepLightsClear(
    doc,
    pruneDoors({ ...doc, rooms: [...doc.rooms, { id: args.id, rects: [{ ...args.rect }] }] }),
  );
}

/** Replace rect `index` (default 0) of a room; doors left without a wall are removed. */
export function resizeRoom(
  doc: LevelDocument,
  args: { id: string; rect: CellRect; index?: number },
): OpResult {
  const room = doc.rooms.find((entry) => entry.id === args.id);
  if (room === undefined)
    return fail(doc, "op.invalid", `no room "${args.id}"`, "use a room id", [args.id]);
  const index = args.index ?? 0;
  const old = room.rects[index];
  if (old === undefined) {
    return fail(
      doc,
      "op.invalid",
      `room "${args.id}" has no rect ${index}`,
      `use 0..${room.rects.length - 1}`,
      [args.id],
    );
  }
  const bad = checkRect(doc, args.id, args.rect);
  if (bad !== null) return bad;
  const rects = room.rects.map((rect, k) => (k === index ? { ...args.rect } : rect));
  return keepLightsClear(
    doc,
    pruneDoors({
      ...doc,
      rooms: doc.rooms.map((entry) => (entry === room ? { ...room, rects } : entry)),
    }),
  );
}

/** Remove a room, leaving its cells open ground; its objects stay for the checks to flag. */
export function removeRoom(doc: LevelDocument, args: { id: string }): OpResult {
  if (!doc.rooms.some((room) => room.id === args.id)) {
    return fail(doc, "op.invalid", `no room "${args.id}"`, "use a room id", [args.id]);
  }
  if (doc.rooms.length === 1) {
    return fail(doc, "op.invalid", "a level needs at least one room", "add another room first", [
      args.id,
    ]);
  }
  return keepLightsClear(
    doc,
    pruneDoors({ ...doc, rooms: doc.rooms.filter((room) => room.id !== args.id) }),
  );
}

/** Open a doorway on a wall edge, or close it when it is already a doorway. */
export function toggleDoor(doc: LevelDocument, door: LevelDoor): OpResult {
  const key = doorKey(door);
  if (doc.doors.some((entry) => doorKey(entry) === key)) {
    return keepLightsClear(
      doc,
      done({ ...doc, doors: doc.doors.filter((entry) => doorKey(entry) !== key) }, [
        {
          code: "op.door-closed",
          severity: "info",
          message: `closed door ${key}`,
          entities: [key],
        },
      ]),
    );
  }
  const [lines, cells] =
    door.axis === "v" ? [doc.grid.cols, doc.grid.rows] : [doc.grid.rows, doc.grid.cols];
  if (
    !Number.isInteger(door.line) ||
    !Number.isInteger(door.cell) ||
    door.line <= 0 ||
    door.line >= lines ||
    door.cell < 0 ||
    door.cell >= cells
  ) {
    return fail(
      doc,
      "op.invalid",
      `door ${key} is on the grid border or off the grid`,
      `keep 0 < line < ${lines} and 0 <= cell < ${cells}`,
      [key],
    );
  }
  const sides = doorRegions(door, regionGrid(doc));
  if (sides === undefined || sides[0] === sides[1]) {
    return fail(
      doc,
      "op.invalid",
      `door ${key} has ${sides?.[0] ?? "open ground"} on both sides, so there is no wall`,
      "pick an edge between two different regions",
      [key],
    );
  }
  return done({ ...doc, doors: [...doc.doors, { ...door }] }, [
    {
      code: "op.door-opened",
      severity: "info",
      message: `opened door ${key} between ${sides[0] ?? "open ground"} and ${sides[1] ?? "open ground"}`,
      entities: [key],
    },
  ]);
}
