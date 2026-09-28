import { LEVEL_DOOR_CLEARANCE_DEPTH, LEVEL_DOOR_CLEARANCE_WIDTH } from "@morphy/shared";
import type { LevelDocument, LevelDoor } from "./document";
import { doorKey, TILE, WALL_HALF_THICKNESS } from "./floorplan";
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
  walls: Rect2[];
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

function doorZone(doc: LevelDocument, door: LevelDoor, space: LevelSpace): DoorZone {
  const halfWidth = LEVEL_DOOR_CLEARANCE_WIDTH / 2;
  const near = WALL_HALF_THICKNESS;
  const far = WALL_HALF_THICKNESS + LEVEL_DOOR_CLEARANCE_DEPTH;
  const [before, after] = doorRegions(door, space.cellRegion) ?? [null, null];
  if (door.axis === "v") {
    const x = lineX(doc, door.line);
    const z = lineZ(doc, door.cell) + TILE / 2;
    const zone = (from: number, to: number): Rect2 =>
      rectFromExtent({ minX: from, maxX: to, minZ: z - halfWidth, maxZ: z + halfWidth });
    return {
      door,
      key: doorKey(door),
      x,
      z,
      sides: [
        { region: before, zone: zone(x - far, x - near) },
        { region: after, zone: zone(x + near, x + far) },
      ],
    };
  }
  const x = lineX(doc, door.cell) + TILE / 2;
  const z = lineZ(doc, door.line);
  const zone = (from: number, to: number): Rect2 =>
    rectFromExtent({ minX: x - halfWidth, maxX: x + halfWidth, minZ: from, maxZ: to });
  return {
    door,
    key: doorKey(door),
    x,
    z,
    sides: [
      { region: before, zone: zone(z - far, z - near) },
      { region: after, zone: zone(z + near, z + far) },
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

  const walls = wallRects(doc, context.catalog);

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
