import {
  LEVEL_DOOR_CLEARANCE_DEPTH,
  LEVEL_DOOR_CLEARANCE_WIDTH,
  type TileInstance,
} from "@morphy/shared";
import type { LevelDocument, LevelDoor } from "./document";
import { doorKey, gateDoors, TILE, WALL_HALF_THICKNESS } from "./floorplan";
import { type Footprint, type LevelContext, objectFootprint, objectHitboxes } from "./footprint";
import { type Rect2, rectFromExtent } from "./geometry";
import { wallRects } from "./walls";

/** The floor kept clear on one side of a doorway, and the region that side belongs to. */
export interface DoorSide {
  region: string | null;
  zone: Rect2;
}

/** A doorway with its world centre and the clearance zone on each side. */
export interface DoorZone {
  door: LevelDoor;
  key: string;
  x: number;
  z: number;
  sides: [DoorSide, DoorSide];
}

/**
 * A document laid out in world space: the region of every cell, the wall boxes the
 * compiler emits, and each object's real footprint and collision boxes. Built once per
 * check or operation so every measurement reads the same geometry.
 */
export interface LevelSpace {
  doc: LevelDocument;
  context: LevelContext;
  halfW: number;
  halfD: number;
  walls: readonly Rect2[];
  footprints: Map<string, Footprint>;
  hitboxes: Map<string, Rect2[]>;
  doors: DoorZone[];
  /** Region of the cell holding (`x`, `z`): a room id, null for open ground, undefined off the map. */
  regionAt(x: number, z: number): string | null | undefined;
  /** Region of cell (`i`, `j`), undefined off the grid. */
  cellRegion(i: number, j: number): string | null | undefined;
}

/** World x of vertical grid line `line`. */
export function lineX(doc: LevelDocument, line: number): number {
  return -(doc.grid.cols * TILE) / 2 + line * TILE;
}

/** World z of horizontal grid line `line`. */
export function lineZ(doc: LevelDocument, line: number): number {
  return -(doc.grid.rows * TILE) / 2 + line * TILE;
}

/**
 * The floor kept clear either side of a doorway centred at (`x`, `z`) in a wall
 * along grid lines of `axis` (`v` for a wall running along Z): what `door.blocked`
 * measures collision boxes against, before side then after side.
 */
function doorClearance(x: number, z: number, axis: LevelDoor["axis"]): [Rect2, Rect2] {
  const halfWidth = LEVEL_DOOR_CLEARANCE_WIDTH / 2;
  const near = WALL_HALF_THICKNESS;
  const far = WALL_HALF_THICKNESS + LEVEL_DOOR_CLEARANCE_DEPTH;
  if (axis === "v") {
    const zone = (from: number, to: number): Rect2 =>
      rectFromExtent({ minX: from, maxX: to, minZ: z - halfWidth, maxZ: z + halfWidth });
    return [zone(x - far, x - near), zone(x + near, x + far)];
  }
  const zone = (from: number, to: number): Rect2 =>
    rectFromExtent({ minX: x - halfWidth, maxX: x + halfWidth, minZ: from, maxZ: to });
  return [zone(z - far, z - near), zone(z + near, z + far)];
}

/** The door clearance zones of a compiled map, read off the gates its floorplan stands in its doorways. */
export function gateClearances(tiles: readonly TileInstance[]): Rect2[] {
  return gateDoors(tiles).flatMap((gate) => doorClearance(gate.x, gate.z, gate.axis));
}

function doorZone(doc: LevelDocument, door: LevelDoor, space: LevelSpace): DoorZone {
  const [before, after] = doorRegions(door, space.cellRegion) ?? [null, null];
  const x = door.axis === "v" ? lineX(doc, door.line) : lineX(doc, door.cell) + TILE / 2;
  const z = door.axis === "v" ? lineZ(doc, door.cell) + TILE / 2 : lineZ(doc, door.line);
  const [beforeZone, afterZone] = doorClearance(x, z, door.axis);
  return {
    door,
    key: doorKey(door),
    x,
    z,
    sides: [
      { region: before, zone: beforeZone },
      { region: after, zone: afterZone },
    ],
  };
}

/** Region of each grid cell of `doc`: a room id, null for open ground, undefined off the grid. */
export function regionGrid(
  doc: LevelDocument,
): (i: number, j: number) => string | null | undefined {
  const { cols, rows } = doc.grid;
  const owner: (string | null)[][] = Array.from({ length: cols }, () =>
    new Array<string | null>(rows).fill(null),
  );
  for (const room of doc.rooms) {
    for (const rect of room.rects) {
      for (let i = rect.i0; i < rect.i1; i++) {
        for (let j = rect.j0; j < rect.j1; j++) owner[i]![j] = room.id;
      }
    }
  }
  return (i, j) => (i >= 0 && i < cols && j >= 0 && j < rows ? owner[i]![j]! : undefined);
}

/** The regions either side of a door's edge, or undefined for an edge on or off the grid border. */
export function doorRegions(
  door: LevelDoor,
  cellRegion: (i: number, j: number) => string | null | undefined,
): [string | null, string | null] | undefined {
  const [a, b] =
    door.axis === "v"
      ? [cellRegion(door.line - 1, door.cell), cellRegion(door.line, door.cell)]
      : [cellRegion(door.cell, door.line - 1), cellRegion(door.cell, door.line)];
  return a === undefined || b === undefined ? undefined : [a, b];
}

/** Lay a validated document out in world space. */
export function buildSpace(doc: LevelDocument, context: LevelContext): LevelSpace {
  const halfW = (doc.grid.cols * TILE) / 2;
  const halfD = (doc.grid.rows * TILE) / 2;
  const cellRegion = regionGrid(doc);

  const walls = wallRects(doc);

  const footprints = new Map<string, Footprint>();
  const hitboxes = new Map<string, Rect2[]>();
  for (const object of doc.objects) {
    const footprint = objectFootprint(object, context);
    if (footprint !== null) footprints.set(object.id, footprint);
    hitboxes.set(object.id, objectHitboxes(object, context));
  }

  const space: LevelSpace = {
    doc,
    context,
    halfW,
    halfD,
    walls,
    footprints,
    hitboxes,
    doors: [],
    cellRegion,
    regionAt: (x, z) => cellRegion(Math.floor((x + halfW) / TILE), Math.floor((z + halfD) / TILE)),
  };
  space.doors = doc.doors.map((door) => doorZone(doc, door, space));
  return space;
}
