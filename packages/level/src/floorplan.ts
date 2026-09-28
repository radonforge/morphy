import type { BoxCollider, TileInstance } from "@morphy/shared";
import type { LevelDoor } from "./document";

/** World size of one grid cell (and of every modular floor/wall tile). */
export const TILE = 4;
export const WALL_HEIGHT = 4.25;
export const FLOOR_THICKNESS = 1;

const WALL_THICKNESS = 1;
const WALL_HALF_THICKNESS = WALL_THICKNESS / 2;
const WALL_Y = WALL_HEIGHT / 2;
const WALL_MODEL = "/models/space/modular/template-wall.glb";
const GATE_MODEL = "/models/space/modular/gate.glb";
const WALL_ROTATION_X = 0;
const WALL_ROTATION_Z = Math.PI / 2;

interface WeightedModel {
  model: string;
  weight: number;
}

const FLOOR_VARIANTS: WeightedModel[] = [
  { model: "/models/space/modular/template-floor.glb", weight: 3 },
  { model: "/models/space/modular/template-floor-detail-a.glb", weight: 1 },
];

const WALL_VARIANTS: WeightedModel[] = [
  { model: WALL_MODEL, weight: 7 },
  { model: "/models/space/modular/template-wall-detail-a.glb", weight: 3 },
];

/** Every model path that {@link emitFloorplan} can emit for any seed. */
export const FLOORPLAN_MODEL_PATHS = [
  ...new Set(
    [GATE_MODEL, ...FLOOR_VARIANTS, ...WALL_VARIANTS].map((entry) =>
      typeof entry === "string" ? entry : entry.model,
    ),
  ),
];

function pickModel(rng: () => number, variants: WeightedModel[]): string {
  const total = variants.reduce((sum, v) => sum + v.weight, 0);
  let roll = rng() * total;
  for (const v of variants) {
    roll -= v.weight;
    if (roll < 0) return v.model;
  }
  return variants[variants.length - 1]!.model;
}

export interface Grid {
  gx: number;
  gz: number;
  halfW: number;
  halfD: number;
}

function cellCenterX(grid: Grid, i: number): number {
  return -grid.halfW + (i + 0.5) * TILE;
}

function cellCenterZ(grid: Grid, j: number): number {
  return -grid.halfD + (j + 0.5) * TILE;
}

function lineX(grid: Grid, cell: number): number {
  return -grid.halfW + cell * TILE;
}

function lineZ(grid: Grid, cell: number): number {
  return -grid.halfD + cell * TILE;
}

/**
 * Emit one wall tile per present cell along a grid line. `inwardSign` (±1) is
 * the direction along the wall's normal toward the room the face should front;
 * the tile is shifted by half its thickness and rotated so its detailed face
 * looks that way while its body stays centered on `line`. `axis` is the
 * direction the wall runs: "x" → a wall on a z-line, "z" → a wall on an x-line.
 */
function emitWallTiles(
  grid: Grid,
  axis: "x" | "z",
  line: number,
  present: boolean[],
  models: string[],
  inwardSign: number,
  tiles: TileInstance[],
): void {
  const offset = WALL_HALF_THICKNESS * inwardSign;
  for (let idx = 0; idx < present.length; idx++) {
    if (!present[idx]) continue;
    const model = models[idx]!;
    if (axis === "x") {
      tiles.push({
        model,
        position: { x: cellCenterX(grid, idx), y: 0, z: line + offset },
        rotationY: inwardSign > 0 ? 0 : Math.PI,
      });
    } else {
      tiles.push({
        model,
        position: { x: line + offset, y: 0, z: cellCenterZ(grid, idx) },
        rotationY: inwardSign > 0 ? Math.PI / 2 : -Math.PI / 2,
      });
    }
  }
}

function pickWallModels(rng: () => number, count: number): string[] {
  return Array.from({ length: count }, () => pickModel(rng, WALL_VARIANTS));
}

/** Merge runs of adjacent present cells along a grid line into box colliders. */
function emitWallColliders(
  grid: Grid,
  axis: "x" | "z",
  line: number,
  present: boolean[],
  colliders: BoxCollider[],
): void {
  let runStart = -1;
  for (let idx = 0; idx <= present.length; idx++) {
    const here = idx < present.length && present[idx];
    if (here && runStart < 0) runStart = idx;
    if (!here && runStart >= 0) {
      const a = runStart;
      const b = idx - 1;
      if (axis === "x") {
        const start = lineX(grid, a);
        const end = lineX(grid, b + 1);
        colliders.push({
          position: { x: (start + end) / 2, y: WALL_Y, z: line },
          size: { x: end - start, y: WALL_HEIGHT, z: WALL_THICKNESS },
        });
      } else {
        const start = lineZ(grid, a);
        const end = lineZ(grid, b + 1);
        colliders.push({
          position: { x: line, y: WALL_Y, z: (start + end) / 2 },
          size: { x: WALL_THICKNESS, y: WALL_HEIGHT, z: end - start },
        });
      }
      runStart = -1;
    }
  }
}

/** Place an open archway framing a doorway gap left in a wall along `axis`. */
function pushGate(
  grid: Grid,
  axis: "x" | "z",
  line: number,
  cellIndex: number,
  tiles: TileInstance[],
): void {
  if (axis === "x") {
    tiles.push({
      model: GATE_MODEL,
      position: { x: cellCenterX(grid, cellIndex), y: 0, z: line },
      rotationY: WALL_ROTATION_X,
    });
  } else {
    tiles.push({
      model: GATE_MODEL,
      position: { x: line, y: 0, z: cellCenterZ(grid, cellIndex) },
      rotationY: WALL_ROTATION_Z,
    });
  }
}

/** Stable identity of a door's edge, `axis:line:cell`, as the parser reports it and the emitter matches it. */
export function doorKey(door: LevelDoor): string {
  return `${door.axis}:${door.line}:${door.cell}`;
}

/** Region id per grid cell, or `null` for open ground (no floor, no walls). */
export type Cell = string | null;

/**
 * Compile a region grid into aligned floor tiles, wall colliders, wall tiles and
 * gates. A wall is emitted on every grid edge separating two distinct regions
 * (a `null` cell = open ground, so room↔null yields a one-faced perimeter wall);
 * edges listed in `doors` become gates instead. Floor tiles cover every non-null
 * cell. The single source of truth keeping visual walls aligned to colliders for
 * every hand-authored interior. Appends to the output arrays.
 */
export function emitFloorplan(
  grid: Grid,
  region: Cell[][],
  doors: LevelDoor[],
  rng: () => number,
  out: { tiles: TileInstance[]; colliders: BoxCollider[] },
): void {
  const { gx, gz } = grid;
  const doorSet = new Set(doors.map(doorKey));
  const { tiles, colliders } = out;

  for (let i = 0; i < gx; i++) {
    for (let j = 0; j < gz; j++) {
      if (region[i]![j] === null) continue;
      tiles.push({
        model: pickModel(rng, FLOOR_VARIANTS),
        position: { x: cellCenterX(grid, i), y: 0, z: cellCenterZ(grid, j) },
        rotationY: 0,
      });
    }
  }

  for (let c = 0; c <= gx; c++) {
    const present = new Array<boolean>(gz).fill(false);
    const faceEast = new Array<boolean>(gz).fill(false);
    const faceWest = new Array<boolean>(gz).fill(false);
    for (let j = 0; j < gz; j++) {
      const left: Cell = c > 0 ? (region[c - 1]![j] ?? null) : null;
      const right: Cell = c < gx ? (region[c]![j] ?? null) : null;
      if (left === right) continue;
      if (doorSet.has(doorKey({ axis: "v", line: c, cell: j }))) {
        pushGate(grid, "z", lineX(grid, c), j, tiles);
        continue;
      }
      present[j] = true;
      faceEast[j] = right !== null;
      faceWest[j] = left !== null;
    }
    const models = pickWallModels(rng, gz);
    emitWallColliders(grid, "z", lineX(grid, c), present, colliders);
    emitWallTiles(grid, "z", lineX(grid, c), faceEast, models, 1, tiles);
    emitWallTiles(grid, "z", lineX(grid, c), faceWest, models, -1, tiles);
  }

  for (let r = 0; r <= gz; r++) {
    const present = new Array<boolean>(gx).fill(false);
    const faceSouth = new Array<boolean>(gx).fill(false);
    const faceNorth = new Array<boolean>(gx).fill(false);
    for (let i = 0; i < gx; i++) {
      const top: Cell = r > 0 ? (region[i]![r - 1] ?? null) : null;
      const bottom: Cell = r < gz ? (region[i]![r] ?? null) : null;
      if (top === bottom) continue;
      if (doorSet.has(doorKey({ axis: "h", line: r, cell: i }))) {
        pushGate(grid, "x", lineZ(grid, r), i, tiles);
        continue;
      }
      present[i] = true;
      faceSouth[i] = bottom !== null;
      faceNorth[i] = top !== null;
    }
    const models = pickWallModels(rng, gx);
    emitWallColliders(grid, "x", lineZ(grid, r), present, colliders);
    emitWallTiles(grid, "x", lineZ(grid, r), faceSouth, models, 1, tiles);
    emitWallTiles(grid, "x", lineZ(grid, r), faceNorth, models, -1, tiles);
  }
}
