import { computePropBounds, type PropDefinition, type PropInstance } from "@webhunt/shared";

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
const DECOR_AREA_PER = 70;
const DECOR_MAX = 5;
const RING_RADIUS = 1.75;
const DEFAULT_RADIUS = 0.5;

const DECOR: readonly string[] = ["barrel", "barrels", "meteor", "meteor_detailed", "bones"];

function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/** How many props to space along a run of `len` units, one per `per`, clamped. */
function spanCount(len: number, per: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(len / per)));
}

/** Length of the room wall on `side` (0/1 run along z, 2/3 run along x). */
function wallLen(rect: RoomRect, side: Side): number {
  return side === 0 || side === 1 ? rect.z1 - rect.z0 : rect.x1 - rect.x0;
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

/** Distance a prop's center must sit from a wall so its body clears it. */
function wallInset(p: Placer, type: string): number {
  return WALL_GAP + p.radiusOf(type) + 0.1;
}

type Side = 0 | 1 | 2 | 3;

/** Place a row of `count` props inset along one wall, each facing the room center. */
function alongWall(p: Placer, side: Side, types: readonly string[], count: number, rng: Rng): void {
  const { rect, cx, cz } = p;
  for (let i = 0; i < count; i++) {
    const type = pick(types, rng);
    const inset = wallInset(p, type);
    const frac = count === 1 ? 0.5 : (i + 0.5) / count;
    let x: number;
    let z: number;
    if (side === 0) {
      x = rect.x0 + inset;
      z = rect.z0 + 2 + frac * (rect.z1 - rect.z0 - 4);
    } else if (side === 1) {
      x = rect.x1 - inset;
      z = rect.z0 + 2 + frac * (rect.z1 - rect.z0 - 4);
    } else if (side === 2) {
      x = rect.x0 + 2 + frac * (rect.x1 - rect.x0 - 4);
      z = rect.z0 + inset;
    } else {
      x = rect.x0 + 2 + frac * (rect.x1 - rect.x0 - 4);
      z = rect.z1 - inset;
    }
    p.place(type, x, z, faceCenter(x, z, cx, cz));
  }
}

/** Place a prop in `count` distinct corners of the room. */
function inCorners(p: Placer, types: readonly string[], count: number, rng: Rng): void {
  const { rect, cx, cz } = p;
  const start = Math.floor(rng() * 4);
  for (let i = 0; i < count; i++) {
    const type = pick(types, rng);
    const inset = wallInset(p, type);
    const corner = (start + i) % 4;
    const x = corner === 0 || corner === 2 ? rect.x0 + inset : rect.x1 - inset;
    const z = corner === 0 || corner === 1 ? rect.z0 + inset : rect.z1 - inset;
    p.place(type, x, z, faceCenter(x, z, cx, cz));
  }
}

function tableWithChairs(p: Placer, rng: Rng): boolean {
  const { cx, cz } = p;
  const table = p.has("table-large") ? "table-large" : "table";
  if (!p.place(table, cx, cz, rng() < 0.5 ? 0 : Math.PI / 2, false)) return false;
  const seats: [number, number, number][] = [
    [cx + RING_RADIUS, cz, -Math.PI / 2],
    [cx - RING_RADIUS, cz, Math.PI / 2],
    [cx, cz + RING_RADIUS, Math.PI],
    [cx, cz - RING_RADIUS, 0],
  ];
  for (const [x, z, rot] of seats) p.place("chair", x, z, rot, false);
  return true;
}

const opposite = (side: Side): Side => (side ^ 1) as Side;
const randSide = (rng: Rng): Side => Math.floor(rng() * 4) as Side;

function scatterDecor(p: Placer, rng: Rng): void {
  const pool = DECOR.filter((d) => p.has(d));
  if (pool.length === 0) return;
  const area = (p.rect.x1 - p.rect.x0) * (p.rect.z1 - p.rect.z0);
  const count = Math.min(DECOR_MAX, Math.round(area / DECOR_AREA_PER));
  for (let i = 0; i < count; i++) {
    alongWall(p, randSide(rng), pool, 1, rng);
  }
}

type Archetype = (p: Placer, rng: Rng) => void;

const messHall: Archetype = (p, rng) => {
  if (!tableWithChairs(p, rng)) {
    alongWall(p, randSide(rng), ["table", "table-inset"], 1, rng);
  }
  const s = randSide(rng);
  alongWall(p, s, ["table", "table-inset", "barrels"], spanCount(wallLen(p.rect, s), 5, 1, 3), rng);
  alongWall(p, opposite(s), ["chair-armrest", "chair"], spanCount(wallLen(p.rect, s), 5, 1, 3), rng);
  scatterDecor(p, rng);
};

const quarters: Archetype = (p, rng) => {
  const side = randSide(rng);
  const beds = ["bed-single", "bed-double"];
  alongWall(p, side, beds, spanCount(wallLen(p.rect, side), 4, 2, 5), rng);
  alongWall(p, opposite(side), beds, spanCount(wallLen(p.rect, side), 4, 2, 5), rng);
  inCorners(p, ["desk_chair", "desk_computer", "chair"], 2, rng);
  scatterDecor(p, rng);
};

const controlRoom: Archetype = (p, rng) => {
  const side = randSide(rng);
  const consoles = ["computer-system", "computer-wide", "computer", "desk_computerCorner"];
  alongWall(p, side, consoles, spanCount(wallLen(p.rect, side), 3.5, 2, 6), rng);
  const opp = opposite(side);
  alongWall(p, opp, ["chair-armrest", "desk_chair"], spanCount(wallLen(p.rect, opp), 4, 1, 4), rng);
  inCorners(p, ["machine_wireless", "machine_generator"], 2, rng);
  scatterDecor(p, rng);
};

const storageBay: Archetype = (p, rng) => {
  inCorners(p, ["container", "container-tall", "container-wide", "container-flat", "skip"], 4, rng);
  const s = randSide(rng);
  alongWall(p, s, ["barrel", "barrels", "machine_barrel", "container"], spanCount(wallLen(p.rect, s), 3, 2, 6), rng);
  scatterDecor(p, rng);
};

const lab: Archetype = (p, rng) => {
  const side = randSide(rng);
  alongWall(p, side, ["table-display", "table-inset"], spanCount(wallLen(p.rect, side), 4, 2, 4), rng);
  const opp = opposite(side);
  alongWall(p, opp, ["computer", "computer-system", "structure"], spanCount(wallLen(p.rect, opp), 4, 2, 4), rng);
  inCorners(p, ["machine_generator", "structure-barrier"], 2, rng);
  scatterDecor(p, rng);
};

const ARCHETYPES: readonly Archetype[] = [messHall, quarters, controlRoom, storageBay, lab];

/**
 * Furnish one room with a semantically coherent arrangement (tables grouped with
 * chairs, beds along walls, consoles in banks, storage in corners) chosen from a
 * fixed set of archetypes, keeping clear of doorways and the prop spawn point.
 * Appends the resulting prop instances to `out`. Deterministic for a fixed `rng`.
 */
export function furnishRoom(opts: {
  rect: RoomRect;
  doorways: Doorway[];
  spawn: { x: number; z: number };
  catalog: PropDefinition[];
  rng: Rng;
  out: PropInstance[];
}): void {
  const available = new Set(opts.catalog.map((d) => d.id));
  const radii = new Map(opts.catalog.map((d) => [d.id, computePropBounds(d).radius]));
  const radiusOf = (id: string): number => radii.get(id) ?? DEFAULT_RADIUS;
  const placer = makePlacer(opts.rect, opts.doorways, opts.spawn, available, radiusOf, opts.out);
  pick(ARCHETYPES, opts.rng)(placer, opts.rng);
}
