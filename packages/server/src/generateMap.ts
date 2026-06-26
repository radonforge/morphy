import type {
  BoxCollider,
  MapDefinition,
  PropDefinition,
  PropInstance,
  SceneryInstance,
  TileInstance,
  Vec3,
} from "@webhunt/shared";
import { type Doorway, furnishRoom, type RoomRect } from "./furnish";

const TILE = 4;
const CELLS_MIN = 11;
const CELLS_MAX = 15;
const ROOMS_PER_AXIS_MIN = 2;
const ROOMS_PER_AXIS_MAX = 3;
const MIN_ROOM_CELLS = 3;
const WALL_HEIGHT = 4.25;
const WALL_THICKNESS = 1;
const WALL_HALF_THICKNESS = WALL_THICKNESS / 2;
const WALL_Y = WALL_HEIGHT / 2;
const FLOOR_THICKNESS = 1;

const WALL_MODEL = "/models/space/template-wall.glb";
const GATE_MODEL = "/models/space/gate.glb";
const WALL_ROTATION_X = 0;
const WALL_ROTATION_Z = Math.PI / 2;

interface WeightedModel {
  model: string;
  weight: number;
}

const FLOOR_VARIANTS: WeightedModel[] = [
  { model: "/models/space/template-floor.glb", weight: 3 },
  { model: "/models/space/template-floor-detail-a.glb", weight: 1 },
];

const WALL_VARIANTS: WeightedModel[] = [
  { model: WALL_MODEL, weight: 7 },
  { model: "/models/space/template-wall-detail-a.glb", weight: 3 },
];

const MAX_PLACE_ATTEMPTS = 16;
const HUNTER_SPAWN_OFFSET = 1.4;
const SPAWN_CORNER_INSET = 2.2;

const APRON_MARGIN = 14;
const sk = (name: string): string => `/models/space-kit/${name}.glb`;

const ROCKET_SCALE = 3;
const ROCKET_PARTS: { model: string; y: number }[] = [
  { model: "rocket_finsA", y: 0 },
  { model: "rocket_baseA", y: 0 },
  { model: "rocket_sidesA", y: 1.6 },
  { model: "rocket_topA", y: 2.6 },
];
const ROCKET_INSET = 6;

const HANGAR_MODELS = ["hangar_largeA", "hangar_smallA", "hangar_roundA"];
const HANGAR_SCALE = 3.2;
const HANGAR_INSET = 7;

const CRAFT_MODELS = ["craft_racer", "craft_speederA", "craft_cargoA", "craft_miner"];
const CRAFT_SCALE = 2.6;
const CRAFT_COUNT = 3;

const GROUND_DETAIL_MODELS = ["meteor", "meteor_detailed", "crater", "craterLarge"];
const GROUND_DETAIL_DENSITY = 0.01;
const GROUND_DETAIL_MAX = 36;
const DETAIL_SCALE_MIN = 1.5;
const DETAIL_SCALE_MAX = 3.2;

/**
 * Local-space footprint radius (max horizontal half-extent, from each GLB's
 * bounds) for solid scatter models, scaled per instance into a world-space
 * circular obstacle. Flat ground decals (crater, craterLarge) are omitted so
 * they stay walkable.
 */
const SCENERY_COLLIDER_RADIUS: Record<string, number> = {
  meteor: 0.43,
  meteor_detailed: 0.43,
  craft_racer: 1.01,
  craft_speederA: 1.05,
  craft_cargoA: 1.23,
  craft_miner: 1.3,
};

const APRON_WALK = 16;
const ROCKET_FOOT = 3.8;
const ROCKET_COLLIDER_HEIGHT = 9;
const HANGAR_FOOT_X = 6.6;
const HANGAR_FOOT_Z = 9.8;
const HANGAR_COLLIDER_HEIGHT = 3.4;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(randRange(rng, min, max + 1));
}

function pickModel(rng: () => number, variants: WeightedModel[]): string {
  const total = variants.reduce((sum, v) => sum + v.weight, 0);
  let roll = rng() * total;
  for (const v of variants) {
    roll -= v.weight;
    if (roll < 0) return v.model;
  }
  return variants[variants.length - 1]!.model;
}

/**
 * Split `total` cells into up to `groups` contiguous rooms, each at least
 * {@link MIN_ROOM_CELLS} wide. Returns the cell indices where rooms begin and
 * end: `[0, ..., total]`, so room `r` spans cells `[bounds[r], bounds[r + 1])`.
 */
function partitionCells(total: number, groups: number, rng: () => number): number[] {
  const count = Math.max(1, Math.min(groups, Math.floor(total / MIN_ROOM_CELLS)));
  const sizes = new Array<number>(count).fill(MIN_ROOM_CELLS);
  let extra = total - count * MIN_ROOM_CELLS;
  while (extra > 0) {
    sizes[randInt(rng, 0, count - 1)]! += 1;
    extra -= 1;
  }
  const bounds = [0];
  for (let i = 0; i < count; i++) bounds.push(bounds[i]! + sizes[i]!);
  return bounds;
}

interface Grid {
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

/** A wall bordering two rooms: collider once, a tile facing into each room. */
function emitInteriorWall(
  grid: Grid,
  axis: "x" | "z",
  line: number,
  present: boolean[],
  models: string[],
  tiles: TileInstance[],
  colliders: BoxCollider[],
): void {
  emitWallColliders(grid, axis, line, present, colliders);
  emitWallTiles(grid, axis, line, present, models, 1, tiles);
  emitWallTiles(grid, axis, line, present, models, -1, tiles);
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

/** Stack the modular rocket parts into one standing rocket at (x, z). */
function pushRocket(scenery: SceneryInstance[], x: number, z: number, rng: () => number): void {
  const rotationY = rng() * Math.PI * 2;
  for (const part of ROCKET_PARTS) {
    scenery.push({
      model: sk(part.model),
      position: { x, y: part.y * ROCKET_SCALE, z },
      rotationY,
      scale: ROCKET_SCALE,
    });
  }
}

/**
 * Dress the now-walkable Martian apron with space-kit set pieces: a rocket
 * towering at each corner, a hangar on the north and south edges, a few parked
 * craft and scattered meteors/craters. Rockets and hangars get solid colliders
 * so players bump into them; small debris stays decorative. Deterministic per seed.
 */
function emitScenery(
  grid: Grid,
  rng: () => number,
  scenery: SceneryInstance[],
  colliders: BoxCollider[],
): void {
  const { halfW, halfD } = grid;
  const exHalfW = halfW + APRON_MARGIN;
  const exHalfD = halfD + APRON_MARGIN;

  const rx = halfW + ROCKET_INSET;
  const rz = halfD + ROCKET_INSET;
  for (const [x, z] of [
    [-rx, -rz],
    [rx, -rz],
    [-rx, rz],
    [rx, rz],
  ] as const) {
    pushRocket(scenery, x, z, rng);
    colliders.push({
      position: { x, y: ROCKET_COLLIDER_HEIGHT / 2, z },
      size: { x: ROCKET_FOOT, y: ROCKET_COLLIDER_HEIGHT, z: ROCKET_FOOT },
    });
  }

  const hz = halfD + HANGAR_INSET;
  for (const [z, rotationY] of [
    [-hz, 0],
    [hz, Math.PI],
  ] as const) {
    scenery.push({
      model: sk(HANGAR_MODELS[Math.floor(rng() * HANGAR_MODELS.length)]!),
      position: { x: 0, y: 0, z },
      rotationY,
      scale: HANGAR_SCALE,
    });
    colliders.push({
      position: { x: 0, y: HANGAR_COLLIDER_HEIGHT / 2, z },
      size: { x: HANGAR_FOOT_X, y: HANGAR_COLLIDER_HEIGHT, z: HANGAR_FOOT_Z },
    });
  }

  const insideBuilding = (x: number, z: number): boolean =>
    Math.abs(x) < halfW + TILE && Math.abs(z) < halfD + TILE;
  const scatter = (name: string, scale: number): void => {
    for (let attempt = 0; attempt < MAX_PLACE_ATTEMPTS; attempt++) {
      const x = randRange(rng, -exHalfW, exHalfW);
      const z = randRange(rng, -exHalfD, exHalfD);
      if (insideBuilding(x, z)) continue;
      const localRadius = SCENERY_COLLIDER_RADIUS[name];
      scenery.push({
        model: sk(name),
        position: { x, y: 0, z },
        rotationY: rng() * Math.PI * 2,
        scale,
        ...(localRadius !== undefined ? { colliderRadius: localRadius * scale } : {}),
      });
      return;
    }
  };

  for (let c = 0; c < CRAFT_COUNT; c++) {
    scatter(CRAFT_MODELS[Math.floor(rng() * CRAFT_MODELS.length)]!, CRAFT_SCALE);
  }

  const apronArea = exHalfW * exHalfD * 4 - halfW * halfD * 4;
  const detailCount = Math.min(GROUND_DETAIL_MAX, Math.round(apronArea * GROUND_DETAIL_DENSITY));
  for (let d = 0; d < detailCount; d++) {
    scatter(
      GROUND_DETAIL_MODELS[Math.floor(rng() * GROUND_DETAIL_MODELS.length)]!,
      randRange(rng, DETAIL_SCALE_MIN, DETAIL_SCALE_MAX),
    );
  }
}

/** The room-interior corner (inset from walls) that sits farthest from any doorway. */
function pickSpawnCorner(rect: RoomRect, doorways: Doorway[]): { x: number; z: number } {
  const inset = SPAWN_CORNER_INSET;
  const candidates = [
    { x: rect.x0 + inset, z: rect.z0 + inset },
    { x: rect.x1 - inset, z: rect.z0 + inset },
    { x: rect.x0 + inset, z: rect.z1 - inset },
    { x: rect.x1 - inset, z: rect.z1 - inset },
  ];
  let best = candidates[0]!;
  let bestDist = -1;
  for (const c of candidates) {
    let nearest = Infinity;
    for (const d of doorways) nearest = Math.min(nearest, Math.hypot(c.x - d.x, c.z - d.z));
    if (nearest > bestDist) {
      bestDist = nearest;
      best = c;
    }
  }
  return best;
}

/**
 * Build a procedural "rooms + corridors" map for the given seed on a fixed tile
 * grid: an outer walled rectangle partitioned into rooms, every interior
 * boundary pierced by one doorway per adjacent room pair, furnished from
 * `catalog`. Emits modular glTF `tiles` for rendering and `colliders` for
 * physics/occlusion that line up with them. Deterministic for a fixed seed.
 */
export function generateMap(seed: number, catalog: PropDefinition[]): MapDefinition {
  const rng = makeRng(seed);
  const gx = randInt(rng, CELLS_MIN, CELLS_MAX);
  const gz = randInt(rng, CELLS_MIN, CELLS_MAX);
  const width = gx * TILE;
  const depth = gz * TILE;
  const grid: Grid = { gx, gz, halfW: width / 2, halfD: depth / 2 };

  const colBounds = partitionCells(gx, randInt(rng, ROOMS_PER_AXIS_MIN, ROOMS_PER_AXIS_MAX), rng);
  const rowBounds = partitionCells(gz, randInt(rng, ROOMS_PER_AXIS_MIN, ROOMS_PER_AXIS_MAX), rng);
  const roomCols = colBounds.length - 1;
  const roomRows = rowBounds.length - 1;

  const tiles: TileInstance[] = [];
  for (let i = 0; i < gx; i++) {
    for (let j = 0; j < gz; j++) {
      tiles.push({
        model: pickModel(rng, FLOOR_VARIANTS),
        position: { x: cellCenterX(grid, i), y: 0, z: cellCenterZ(grid, j) },
        rotationY: 0,
      });
    }
  }

  const colliders: BoxCollider[] = [
    {
      position: { x: 0, y: -FLOOR_THICKNESS / 2, z: 0 },
      size: { x: width + 2 * APRON_WALK, y: FLOOR_THICKNESS, z: depth + 2 * APRON_WALK },
    },
  ];

  const doorways: Doorway[] = [];
  const north = new Array<boolean>(gx).fill(true);
  const south = new Array<boolean>(gx).fill(true);
  const west = new Array<boolean>(gz).fill(true);
  const east = new Array<boolean>(gz).fill(true);
  const exitCol = Math.floor(gx / 2);
  north[exitCol] = false;
  south[exitCol] = false;
  pushGate(grid, "x", lineZ(grid, 0), exitCol, tiles);
  pushGate(grid, "x", lineZ(grid, gz), exitCol, tiles);
  doorways.push({ x: cellCenterX(grid, exitCol), z: lineZ(grid, 0) });
  doorways.push({ x: cellCenterX(grid, exitCol), z: lineZ(grid, gz) });

  emitWallColliders(grid, "x", lineZ(grid, 0), north, colliders);
  emitWallTiles(grid, "x", lineZ(grid, 0), north, pickWallModels(rng, gx), 1, tiles);
  emitWallColliders(grid, "x", lineZ(grid, gz), south, colliders);
  emitWallTiles(grid, "x", lineZ(grid, gz), south, pickWallModels(rng, gx), -1, tiles);
  emitWallColliders(grid, "z", lineX(grid, 0), west, colliders);
  emitWallTiles(grid, "z", lineX(grid, 0), west, pickWallModels(rng, gz), 1, tiles);
  emitWallColliders(grid, "z", lineX(grid, gx), east, colliders);
  emitWallTiles(grid, "z", lineX(grid, gx), east, pickWallModels(rng, gz), -1, tiles);
  for (let cb = 1; cb < roomCols; cb++) {
    const cell = colBounds[cb]!;
    const present = new Array<boolean>(gz).fill(true);
    for (let r = 0; r < roomRows; r++) {
      const door = randInt(rng, rowBounds[r]!, rowBounds[r + 1]! - 1);
      present[door] = false;
      pushGate(grid, "z", lineX(grid, cell), door, tiles);
      doorways.push({ x: lineX(grid, cell), z: cellCenterZ(grid, door) });
    }
    emitInteriorWall(
      grid,
      "z",
      lineX(grid, cell),
      present,
      pickWallModels(rng, gz),
      tiles,
      colliders,
    );
  }
  for (let rb = 1; rb < roomRows; rb++) {
    const cell = rowBounds[rb]!;
    const present = new Array<boolean>(gx).fill(true);
    for (let c = 0; c < roomCols; c++) {
      const door = randInt(rng, colBounds[c]!, colBounds[c + 1]! - 1);
      present[door] = false;
      pushGate(grid, "x", lineZ(grid, cell), door, tiles);
      doorways.push({ x: cellCenterX(grid, door), z: lineZ(grid, cell) });
    }
    emitInteriorWall(
      grid,
      "x",
      lineZ(grid, cell),
      present,
      pickWallModels(rng, gx),
      tiles,
      colliders,
    );
  }

  const hunterCol = Math.floor(roomCols / 2);
  const hunterRow = Math.floor(roomRows / 2);

  const props: PropInstance[] = [];
  const propSpawns: Vec3[] = [];

  for (let rc = 0; rc < roomCols; rc++) {
    for (let rr = 0; rr < roomRows; rr++) {
      const rect: RoomRect = {
        x0: lineX(grid, colBounds[rc]!),
        x1: lineX(grid, colBounds[rc + 1]!),
        z0: lineZ(grid, rowBounds[rr]!),
        z1: lineZ(grid, rowBounds[rr + 1]!),
      };
      if (rc === hunterCol && rr === hunterRow) {
        const spawn = { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2 };
        furnishRoom({ rect, doorways, spawn, catalog, rng, out: props });
        continue;
      }
      const spawn = pickSpawnCorner(rect, doorways);
      propSpawns.push({ x: spawn.x, y: 0, z: spawn.z });
      furnishRoom({ rect, doorways, spawn, catalog, rng, out: props });
    }
  }

  const scenery: SceneryInstance[] = [];
  emitScenery(grid, rng, scenery, colliders);

  const hcx = (lineX(grid, colBounds[hunterCol]!) + lineX(grid, colBounds[hunterCol + 1]!)) / 2;
  const hcz = (lineZ(grid, rowBounds[hunterRow]!) + lineZ(grid, rowBounds[hunterRow + 1]!)) / 2;
  const hunterSpawns: Vec3[] = [
    { x: hcx, y: 0, z: hcz },
    { x: hcx + HUNTER_SPAWN_OFFSET, y: 0, z: hcz },
    { x: hcx - HUNTER_SPAWN_OFFSET, y: 0, z: hcz },
    { x: hcx, y: 0, z: hcz + HUNTER_SPAWN_OFFSET },
  ];

  return {
    id: `gen-${seed >>> 0}`,
    name: `Procedurale ${roomRows}×${roomCols}`,
    bounds: {
      min: { x: -(grid.halfW + APRON_WALK), y: 0, z: -(grid.halfD + APRON_WALK) },
      max: { x: grid.halfW + APRON_WALK, y: WALL_HEIGHT, z: grid.halfD + APRON_WALK },
    },
    spawnPoints: { hunters: hunterSpawns, props: propSpawns },
    colliders,
    tiles,
    scenery,
    props,
    propCatalog: catalog,
  };
}
