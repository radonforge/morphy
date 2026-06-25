import type {
  BoxCollider,
  MapDefinition,
  PropDefinition,
  PropInstance,
  Vec3,
} from "@webhunt/shared";

const MAP_SIZE_MIN = 24;
const MAP_SIZE_MAX = 36;
const GRID_MIN = 2;
const GRID_MAX = 3;
const WALL_HEIGHT = 8;
const WALL_THICKNESS = 1;
const WALL_Y = WALL_HEIGHT / 2;
const FLOOR_THICKNESS = 1;
const FLOOR_OVERHANG = 2;
const DOORWAY_WIDTH = 3.5;
const ROOM_MARGIN = 1.6;
const PROPS_PER_ROOM_MIN = 2;
const PROPS_PER_ROOM_MAX = 5;
const PROP_MIN_GAP = 1.6;
const SPAWN_RESERVE = 2.2;
const MAX_PLACE_ATTEMPTS = 12;
const HUNTER_SPAWN_OFFSET = 1.4;
const MIN_SEGMENT_LENGTH = 0.1;

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

function vWall(x: number, zCenter: number, length: number): BoxCollider {
  return {
    position: { x, y: WALL_Y, z: zCenter },
    size: { x: WALL_THICKNESS, y: WALL_HEIGHT, z: length },
  };
}

function hWall(z: number, xCenter: number, length: number): BoxCollider {
  return {
    position: { x: xCenter, y: WALL_Y, z },
    size: { x: length, y: WALL_HEIGHT, z: WALL_THICKNESS },
  };
}

function pushWallWithDoorway(
  out: BoxCollider[],
  rng: () => number,
  axis: "z" | "x",
  line: number,
  start: number,
  end: number,
): void {
  const span = end - start;
  if (span <= DOORWAY_WIDTH) return;
  const half = DOORWAY_WIDTH / 2;
  const lo = start + half + WALL_THICKNESS;
  const hi = end - half - WALL_THICKNESS;
  const center = hi > lo ? randRange(rng, lo, hi) : (start + end) / 2;
  const seg1 = center - half - start;
  const seg2 = end - (center + half);
  if (axis === "z") {
    if (seg1 > MIN_SEGMENT_LENGTH) out.push(vWall(line, start + seg1 / 2, seg1));
    if (seg2 > MIN_SEGMENT_LENGTH) out.push(vWall(line, end - seg2 / 2, seg2));
  } else {
    if (seg1 > MIN_SEGMENT_LENGTH) out.push(hWall(line, start + seg1 / 2, seg1));
    if (seg2 > MIN_SEGMENT_LENGTH) out.push(hWall(line, end - seg2 / 2, seg2));
  }
}

/**
 * Build a procedural "rooms + corridors" map for the given seed: an outer
 * walled box partitioned into a grid of rooms, each interior boundary pierced
 * by a doorway so every adjacent room pair is connected, with furniture from
 * `catalog` scattered per room. Deterministic for a fixed seed.
 */
export function generateMap(seed: number, catalog: PropDefinition[]): MapDefinition {
  const rng = makeRng(seed);
  const width = Math.round(randRange(rng, MAP_SIZE_MIN, MAP_SIZE_MAX));
  const depth = Math.round(randRange(rng, MAP_SIZE_MIN, MAP_SIZE_MAX));
  const cols = randInt(rng, GRID_MIN, GRID_MAX);
  const rows = randInt(rng, GRID_MIN, GRID_MAX);
  const halfW = width / 2;
  const halfD = depth / 2;

  const xs: number[] = [];
  for (let c = 0; c <= cols; c++) xs.push(-halfW + (width * c) / cols);
  const zs: number[] = [];
  for (let r = 0; r <= rows; r++) zs.push(-halfD + (depth * r) / rows);

  const colliders: BoxCollider[] = [
    {
      position: { x: 0, y: -FLOOR_THICKNESS / 2, z: 0 },
      size: { x: width + FLOOR_OVERHANG, y: FLOOR_THICKNESS, z: depth + FLOOR_OVERHANG },
    },
    hWall(-halfD, 0, width + WALL_THICKNESS),
    hWall(halfD, 0, width + WALL_THICKNESS),
    vWall(-halfW, 0, depth + WALL_THICKNESS),
    vWall(halfW, 0, depth + WALL_THICKNESS),
  ];

  for (let i = 1; i < cols; i++) {
    for (let r = 0; r < rows; r++) {
      pushWallWithDoorway(colliders, rng, "z", xs[i]!, zs[r]!, zs[r + 1]!);
    }
  }
  for (let j = 1; j < rows; j++) {
    for (let c = 0; c < cols; c++) {
      pushWallWithDoorway(colliders, rng, "x", zs[j]!, xs[c]!, xs[c + 1]!);
    }
  }

  const hunterRow = Math.floor(rows / 2);
  const hunterCol = Math.floor(cols / 2);

  const props: PropInstance[] = [];
  const propSpawns: Vec3[] = [];
  const placed: { x: number; z: number }[] = [];
  const types = catalog.map((def) => def.id);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (xs[c]! + xs[c + 1]!) / 2;
      const cz = (zs[r]! + zs[r + 1]!) / 2;
      if (!(r === hunterRow && c === hunterCol)) {
        propSpawns.push({ x: cx, y: 0, z: cz });
      }

      const x0 = xs[c]! + ROOM_MARGIN;
      const x1 = xs[c + 1]! - ROOM_MARGIN;
      const z0 = zs[r]! + ROOM_MARGIN;
      const z1 = zs[r + 1]! - ROOM_MARGIN;
      if (types.length === 0 || x1 <= x0 || z1 <= z0) continue;

      const count = randInt(rng, PROPS_PER_ROOM_MIN, PROPS_PER_ROOM_MAX);
      for (let k = 0; k < count; k++) {
        for (let attempt = 0; attempt < MAX_PLACE_ATTEMPTS; attempt++) {
          const px = randRange(rng, x0, x1);
          const pz = randRange(rng, z0, z1);
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

  const hcx = (xs[hunterCol]! + xs[hunterCol + 1]!) / 2;
  const hcz = (zs[hunterRow]! + zs[hunterRow + 1]!) / 2;
  const hunterSpawns: Vec3[] = [
    { x: hcx, y: 0, z: hcz },
    { x: hcx + HUNTER_SPAWN_OFFSET, y: 0, z: hcz },
    { x: hcx - HUNTER_SPAWN_OFFSET, y: 0, z: hcz },
    { x: hcx, y: 0, z: hcz + HUNTER_SPAWN_OFFSET },
  ];

  return {
    id: `gen-${seed >>> 0}`,
    name: `Procedurale ${rows}×${cols}`,
    bounds: { min: { x: -halfW, y: 0, z: -halfD }, max: { x: halfW, y: WALL_HEIGHT, z: halfD } },
    spawnPoints: { hunters: hunterSpawns, props: propSpawns },
    colliders,
    props,
    propCatalog: catalog,
  };
}
