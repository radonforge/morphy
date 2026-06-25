import type {
  BoxCollider,
  MapDefinition,
  PropDefinition,
  PropInstance,
  TileInstance,
  Vec3,
} from "@webhunt/shared";

const TILE = 4;
const CELLS_MIN = 5;
const CELLS_MAX = 7;
const ROOMS_PER_AXIS_MIN = 2;
const ROOMS_PER_AXIS_MAX = 3;
const MIN_ROOM_CELLS = 2;
const WALL_HEIGHT = 4.25;
const WALL_THICKNESS = 1;
const WALL_HALF_THICKNESS = WALL_THICKNESS / 2;
const WALL_Y = WALL_HEIGHT / 2;
const FLOOR_THICKNESS = 1;

const FLOOR_MODEL = "/models/space/template-floor.glb";
const WALL_MODEL = "/models/space/template-wall.glb";
const GATE_MODEL = "/models/space/gate.glb";
const WALL_ROTATION_X = 0;
const WALL_ROTATION_Z = Math.PI / 2;

const ROOM_MARGIN = 2;
const PROPS_PER_ROOM_MIN = 2;
const PROPS_PER_ROOM_MAX = 5;
const PROP_MIN_GAP = 1.6;
const SPAWN_RESERVE = 2.2;
const MAX_PLACE_ATTEMPTS = 12;
const HUNTER_SPAWN_OFFSET = 1.4;

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
  inwardSign: number,
  tiles: TileInstance[],
): void {
  const offset = WALL_HALF_THICKNESS * inwardSign;
  for (let idx = 0; idx < present.length; idx++) {
    if (!present[idx]) continue;
    if (axis === "x") {
      tiles.push({
        model: WALL_MODEL,
        position: { x: cellCenterX(grid, idx), y: 0, z: line + offset },
        rotationY: inwardSign > 0 ? 0 : Math.PI,
      });
    } else {
      tiles.push({
        model: WALL_MODEL,
        position: { x: line + offset, y: 0, z: cellCenterZ(grid, idx) },
        rotationY: inwardSign > 0 ? Math.PI / 2 : -Math.PI / 2,
      });
    }
  }
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
  tiles: TileInstance[],
  colliders: BoxCollider[],
): void {
  emitWallColliders(grid, axis, line, present, colliders);
  emitWallTiles(grid, axis, line, present, 1, tiles);
  emitWallTiles(grid, axis, line, present, -1, tiles);
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
        model: FLOOR_MODEL,
        position: { x: cellCenterX(grid, i), y: 0, z: cellCenterZ(grid, j) },
        rotationY: 0,
      });
    }
  }

  const colliders: BoxCollider[] = [
    {
      position: { x: 0, y: -FLOOR_THICKNESS / 2, z: 0 },
      size: { x: width, y: FLOOR_THICKNESS, z: depth },
    },
  ];

  const northSouth = new Array<boolean>(gx).fill(true);
  const eastWest = new Array<boolean>(gz).fill(true);
  emitWallColliders(grid, "x", lineZ(grid, 0), northSouth, colliders);
  emitWallTiles(grid, "x", lineZ(grid, 0), northSouth, 1, tiles);
  emitWallColliders(grid, "x", lineZ(grid, gz), northSouth, colliders);
  emitWallTiles(grid, "x", lineZ(grid, gz), northSouth, -1, tiles);
  emitWallColliders(grid, "z", lineX(grid, 0), eastWest, colliders);
  emitWallTiles(grid, "z", lineX(grid, 0), eastWest, 1, tiles);
  emitWallColliders(grid, "z", lineX(grid, gx), eastWest, colliders);
  emitWallTiles(grid, "z", lineX(grid, gx), eastWest, -1, tiles);

  for (let cb = 1; cb < roomCols; cb++) {
    const cell = colBounds[cb]!;
    const present = new Array<boolean>(gz).fill(true);
    for (let r = 0; r < roomRows; r++) {
      const door = randInt(rng, rowBounds[r]!, rowBounds[r + 1]! - 1);
      present[door] = false;
      pushGate(grid, "z", lineX(grid, cell), door, tiles);
    }
    emitInteriorWall(grid, "z", lineX(grid, cell), present, tiles, colliders);
  }
  for (let rb = 1; rb < roomRows; rb++) {
    const cell = rowBounds[rb]!;
    const present = new Array<boolean>(gx).fill(true);
    for (let c = 0; c < roomCols; c++) {
      const door = randInt(rng, colBounds[c]!, colBounds[c + 1]! - 1);
      present[door] = false;
      pushGate(grid, "x", lineZ(grid, cell), door, tiles);
    }
    emitInteriorWall(grid, "x", lineZ(grid, cell), present, tiles, colliders);
  }

  const hunterCol = Math.floor(roomCols / 2);
  const hunterRow = Math.floor(roomRows / 2);

  const props: PropInstance[] = [];
  const propSpawns: Vec3[] = [];
  const placed: { x: number; z: number }[] = [];
  const types = catalog.map((def) => def.id);

  for (let rc = 0; rc < roomCols; rc++) {
    for (let rr = 0; rr < roomRows; rr++) {
      const x0 = lineX(grid, colBounds[rc]!);
      const x1 = lineX(grid, colBounds[rc + 1]!);
      const z0 = lineZ(grid, rowBounds[rr]!);
      const z1 = lineZ(grid, rowBounds[rr + 1]!);
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      if (!(rc === hunterCol && rr === hunterRow)) {
        propSpawns.push({ x: cx, y: 0, z: cz });
      }

      const px0 = x0 + ROOM_MARGIN;
      const px1 = x1 - ROOM_MARGIN;
      const pz0 = z0 + ROOM_MARGIN;
      const pz1 = z1 - ROOM_MARGIN;
      if (types.length === 0 || px1 <= px0 || pz1 <= pz0) continue;

      const count = randInt(rng, PROPS_PER_ROOM_MIN, PROPS_PER_ROOM_MAX);
      for (let k = 0; k < count; k++) {
        for (let attempt = 0; attempt < MAX_PLACE_ATTEMPTS; attempt++) {
          const px = randRange(rng, px0, px1);
          const pz = randRange(rng, pz0, pz1);
          if (Math.hypot(px - cx, pz - cz) < SPAWN_RESERVE) continue;
          if (placed.some((p) => Math.hypot(px - p.x, pz - p.z) < PROP_MIN_GAP)) continue;
          const type = types[Math.floor(rng() * types.length)]!;
          props.push({ type, position: { x: px, y: 0, z: pz }, rotation: rng() * Math.PI * 2 });
          placed.push({ x: px, z: pz });
          break;
        }
      }
    }
  }

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
    bounds: { min: { x: -grid.halfW, y: 0, z: -grid.halfD }, max: { x: grid.halfW, y: WALL_HEIGHT, z: grid.halfD } },
    spawnPoints: { hunters: hunterSpawns, props: propSpawns },
    colliders,
    tiles,
    props,
    propCatalog: catalog,
  };
}
