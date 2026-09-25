import { computePropBounds, type PropDefinition, type PropInstance } from "@morphy/shared";

/** Interior rectangle of a room in world space (boundaries lie on wall lines). */
export interface RoomRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Doorway {
  x: number;
  z: number;
}

type Rng = () => number;

const WALL_GAP = 0.6;
const DOOR_KEEPOUT = 3;
const SPAWN_RESERVE = 1.3;
const GAP_EPS = 0.15;
const DOOR_NEAR = 5;
const DEFAULT_RADIUS = 0.5;

const RING_RADIUS = 1.75;
const ROW_SPACING = 1.8;
const STACK_SPREAD = 1.1;

const WALL_SPACING = 6;
const WALL_MAX = 4;
const CORNER_MARGIN = 2.2;
const WALL_SKIP = 0.15;

const INNER_MARGIN = 3.5;
const ZONE_SIZE = 8;
const ANCHOR_JITTER = 1;
const ISLAND_SKIP = 0.2;

const DECOR_AREA_PER = 90;
const DECOR_MAX = 4;
const DECOR: readonly string[] = ["barrel", "barrels"];

const HALF_PI = Math.PI / 2;

function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function jit(rng: Rng, amount: number): number {
  return (rng() * 2 - 1) * amount;
}

function randCardinal(rng: Rng): number {
  return Math.floor(rng() * 4) * HALF_PI;
}

/** Yaw so a model at (x, z) faces toward (cx, cz). */
function faceCenter(x: number, z: number, cx: number, cz: number): number {
  return Math.atan2(cx - x, cz - z);
}

/**
 * Bounded placement context for one room: validates every candidate against the
 * room walls, its doorways, the prop spawn point and already-placed furniture.
 */
interface Placer {
  /** Try to place `type` at (x, z); returns false (placing nothing) if invalid. */
  place: (type: string, x: number, z: number, rot: number, checkGap?: boolean) => boolean;
  has: (type: string) => boolean;
  radiusOf: (id: string) => number;
  rect: RoomRect;
  cx: number;
  cz: number;
}

function makePlacer(
  rect: RoomRect,
  doorways: Doorway[],
  spawn: { x: number; z: number },
  available: Set<string>,
  radiusOf: (id: string) => number,
  out: PropInstance[],
): Placer {
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  const doors = doorways.filter(
    (d) =>
      d.x >= rect.x0 - DOOR_NEAR &&
      d.x <= rect.x1 + DOOR_NEAR &&
      d.z >= rect.z0 - DOOR_NEAR &&
      d.z <= rect.z1 + DOOR_NEAR,
  );
  const placed: { x: number; z: number; r: number }[] = [];

  const valid = (type: string, x: number, z: number, checkGap: boolean): boolean => {
    if (!available.has(type)) return false;
    const r = radiusOf(type);
    if (x - r < rect.x0 + WALL_GAP || x + r > rect.x1 - WALL_GAP) return false;
    if (z - r < rect.z0 + WALL_GAP || z + r > rect.z1 - WALL_GAP) return false;
    for (const d of doors) {
      if (Math.hypot(x - d.x, z - d.z) < DOOR_KEEPOUT + r) return false;
    }
    if (Math.hypot(x - spawn.x, z - spawn.z) < SPAWN_RESERVE + r) return false;
    if (checkGap) {
      for (const p of placed) {
        if (Math.hypot(x - p.x, z - p.z) < r + p.r + GAP_EPS) return false;
      }
    }
    return true;
  };

  return {
    place: (type, x, z, rot, checkGap = true) => {
      if (!valid(type, x, z, checkGap)) return false;
      out.push({ type, position: { x, y: 0, z }, rotation: rot });
      placed.push({ x, z, r: radiusOf(type) });
      return true;
    },
    has: (type) => available.has(type),
    radiusOf,
    rect,
    cx,
    cz,
  };
}

type Group = (p: Placer, x: number, z: number, facing: number, rng: Rng) => void;

/** A single prop facing as told. */
function one(types: readonly string[]): Group {
  return (p, x, z, facing, rng) => {
    p.place(pick(types, rng), x, z, facing);
  };
}

/** A short row of `lo..hi` props along a random axis, all facing the same way. */
function row(types: readonly string[], lo: number, hi: number): Group {
  return (p, x, z, facing, rng) => {
    const n = lo + Math.floor(rng() * (hi - lo + 1));
    const axisX = rng() < 0.5;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * ROW_SPACING;
      p.place(pick(types, rng), x + (axisX ? off : 0), z + (axisX ? 0 : off), facing, false);
    }
  };
}

/** A loose pile of `lo..hi` props clustered around the anchor. */
function cluster(types: readonly string[], lo: number, hi: number): Group {
  return (p, x, z, _facing, rng) => {
    const n = lo + Math.floor(rng() * (hi - lo + 1));
    for (let i = 0; i < n; i++) {
      p.place(
        pick(types, rng),
        x + jit(rng, STACK_SPREAD),
        z + jit(rng, STACK_SPREAD),
        randCardinal(rng),
        i > 0,
      );
    }
  };
}

/** A central table ringed by four chairs facing it. */
const tableChairs: Group = (p, x, z, _facing, rng) => {
  const table = p.has("table-large") && rng() < 0.6 ? "table-large" : "table";
  if (!p.place(table, x, z, rng() < 0.5 ? 0 : HALF_PI, false)) return;
  const seats: readonly [number, number, number][] = [
    [RING_RADIUS, 0, -HALF_PI],
    [-RING_RADIUS, 0, HALF_PI],
    [0, RING_RADIUS, Math.PI],
    [0, -RING_RADIUS, 0],
  ];
  for (const [dx, dz, rot] of seats) p.place("chair", x + dx, z + dz, rot, false);
};

interface Archetype {
  wall: readonly string[];
  islands: Group[];
}

const CONSOLES = ["computer-system", "computer-wide", "computer", "desk_computerCorner"];
const CONTAINERS = ["container", "container-tall", "container-wide", "container-flat", "skip"];

/** Named indices into {@link ARCHETYPES}, for hand-authored maps that theme rooms. */
export const ARCHETYPE = {
  MESS: 0,
  QUARTERS: 1,
  CONTROL: 2,
  STORAGE: 3,
  LAB: 4,
} as const;

const ARCHETYPES: readonly Archetype[] = [
  {
    wall: ["table", "table-inset", "chair-armrest", "chair"],
    islands: [tableChairs, tableChairs, cluster(["barrels", "barrel"], 1, 2)],
  },
  {
    wall: ["bed-single", "bed-double", "bed-single", "desk_computer"],
    islands: [tableChairs, cluster(["barrel", "barrels"], 1, 2), one(["desk_chair", "chair"])],
  },
  {
    wall: ["computer-system", "computer-wide", "computer", "desk_computerCorner", "chair-armrest"],
    islands: [one(["machine_generator", "machine_wireless"]), tableChairs, row(CONSOLES, 2, 2)],
  },
  {
    wall: ["container", "container-tall", "container-wide", "container-flat", "skip", "barrel"],
    islands: [
      cluster(CONTAINERS, 2, 4),
      one(["machine_barrel"]),
      cluster(["barrel", "barrels"], 1, 3),
    ],
  },
  {
    wall: ["table-display", "table-inset", "computer", "computer-system"],
    islands: [one(["structure", "structure-barrier"]), tableChairs, one(["machine_generator"])],
  },
];

/** Line each wall with furniture from `types`, inset by radius, facing inward. */
function placeWalls(p: Placer, types: readonly string[], rng: Rng): void {
  for (let side = 0; side < 4; side++) {
    const alongZ = side < 2;
    const span = alongZ ? p.rect.z1 - p.rect.z0 : p.rect.x1 - p.rect.x0;
    const usable = span - 2 * CORNER_MARGIN;
    if (usable <= 0) continue;
    const n = Math.max(1, Math.min(WALL_MAX, Math.round(usable / WALL_SPACING)));
    for (let k = 0; k < n; k++) {
      if (rng() < WALL_SKIP) continue;
      const type = pick(types, rng);
      const inset = WALL_GAP + p.radiusOf(type) + 0.1;
      const t = n === 1 ? 0.5 : (k + 0.5) / n;
      const along = (alongZ ? p.rect.z0 : p.rect.x0) + CORNER_MARGIN + t * usable;
      let x: number;
      let z: number;
      if (side === 0) {
        x = p.rect.x0 + inset;
        z = along;
      } else if (side === 1) {
        x = p.rect.x1 - inset;
        z = along;
      } else if (side === 2) {
        x = along;
        z = p.rect.z0 + inset;
      } else {
        x = along;
        z = p.rect.z1 - inset;
      }
      p.place(type, x, z, faceCenter(x, z, p.cx, p.cz));
    }
  }
}

/** Fill the room interior (inset from the walls) with free-standing island groups. */
function placeIslands(p: Placer, islands: Group[], rng: Rng): void {
  if (islands.length === 0) return;
  const usableW = p.rect.x1 - p.rect.x0 - 2 * INNER_MARGIN;
  const usableD = p.rect.z1 - p.rect.z0 - 2 * INNER_MARGIN;
  if (usableW <= 0 || usableD <= 0) {
    pick(islands, rng)(p, p.cx, p.cz, randCardinal(rng), rng);
    return;
  }
  const nx = Math.max(1, Math.round(usableW / ZONE_SIZE));
  const nz = Math.max(1, Math.round(usableD / ZONE_SIZE));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (rng() < ISLAND_SKIP) continue;
      const x = p.rect.x0 + INNER_MARGIN + ((i + 0.5) / nx) * usableW + jit(rng, ANCHOR_JITTER);
      const z = p.rect.z0 + INNER_MARGIN + ((j + 0.5) / nz) * usableD + jit(rng, ANCHOR_JITTER);
      pick(islands, rng)(p, x, z, randCardinal(rng), rng);
    }
  }
}

function scatterDecor(p: Placer, rng: Rng): void {
  const pool = DECOR.filter((d) => p.has(d));
  if (pool.length === 0) return;
  const area = (p.rect.x1 - p.rect.x0) * (p.rect.z1 - p.rect.z0);
  const count = Math.min(DECOR_MAX, Math.round(area / DECOR_AREA_PER));
  for (let i = 0; i < count; i++) {
    const x = p.rect.x0 + INNER_MARGIN + rng() * (p.rect.x1 - p.rect.x0 - 2 * INNER_MARGIN);
    const z = p.rect.z0 + INNER_MARGIN + rng() * (p.rect.z1 - p.rect.z0 - 2 * INNER_MARGIN);
    p.place(pick(pool, rng), x, z, randCardinal(rng));
  }
}

/**
 * Furnish one room with a semantically coherent arrangement chosen from a fixed
 * set of archetypes: each wall is lined with appropriate furniture facing inward,
 * and the interior is filled on a zone grid with free-standing islands
 * (table+chairs, stacks, machines) so room centers don't read as empty. Keeps
 * clear of doorways and the prop spawn. Appends to `out`. Deterministic per `rng`.
 */
export function furnishRoom(opts: {
  rect: RoomRect;
  doorways: Doorway[];
  spawn: { x: number; z: number };
  catalog: PropDefinition[];
  rng: Rng;
  out: PropInstance[];
  /** Force a specific archetype (index into the internal set); random when omitted. */
  archetype?: number;
}): void {
  const available = new Set(opts.catalog.map((d) => d.id));
  const radii = new Map(opts.catalog.map((d) => [d.id, computePropBounds(d).radius]));
  const radiusOf = (id: string): number => radii.get(id) ?? DEFAULT_RADIUS;
  const placer = makePlacer(opts.rect, opts.doorways, opts.spawn, available, radiusOf, opts.out);
  const forced = opts.archetype;
  const archetype =
    forced !== undefined && forced >= 0 && forced < ARCHETYPES.length
      ? ARCHETYPES[forced]!
      : pick(ARCHETYPES, opts.rng);

  placeWalls(placer, archetype.wall, opts.rng);
  placeIslands(placer, archetype.islands, opts.rng);
  scatterDecor(placer, opts.rng);
}
