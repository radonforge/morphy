import {
  type BoxCollider,
  computePropBounds,
  type MapDefinition,
  type PropInstance,
  type SceneryInstance,
  type TileInstance,
  type Vec3,
} from "@webhunt/shared";
import type { Doorway } from "../furnish";
import { MARS_CATALOG } from "../marsCatalog";
import {
  type Cell,
  emitFloorplan,
  type FloorplanDoor,
  type Grid,
  makeRng,
  pick,
  randRange,
  TILE,
} from "./lib";

const G = 30;
const HALF = (G * TILE) / 2;
const BARRIER = 54;
const BARRIER_THICK = 3;
const BARRIER_H = 8;
const BOUND = 58;
const FIELD = 51;

const ex = (name: string): string => `/models/space/exterior/${name}.glb`;

/**
 * Every glTF in the Kenney space/exterior kit bakes a fixed node translation of
 * (2, 0, 1.5) local units, so a piece's visible mesh sits that far from its
 * instance origin (scaled, then rotated by `rotationY`). Solid colliders must
 * hug the rendered mesh, not the origin, so placement projects this offset to
 * world space — otherwise the box lands where the object only appears to be.
 * Symmetric pieces (craft, rockets, hangars) center exactly on this; organic
 * rocks deviate by a few cm and carry a refined per-model offset (see {@link SolidModel}).
 */
const KIT_OFFSET_X = 2;
const KIT_OFFSET_Z = 1.5;

/** Horizontal margin (world units) added around each solid box so the mesh is strictly enclosed. */
const COLLIDER_PAD = 0.05;

/** Project a kit model's local mesh-center offset `(ox, oz)` to the world position of an instance placed at `(x, z)`, scaled by `scale` and rotated by `rot` (Y axis). */
function kitCenter(
  x: number,
  z: number,
  rot: number,
  scale: number,
  ox: number,
  oz: number,
): { cx: number; cz: number } {
  const offX = scale * ox;
  const offZ = scale * oz;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return { cx: x + offX * cos + offZ * sin, cz: z - offX * sin + offZ * cos };
}

const ROCKET_PARTS: { model: string; y: number }[] = [
  { model: "rocket_finsA", y: 0 },
  { model: "rocket_baseA", y: 0 },
  { model: "rocket_sidesA", y: 1.6 },
  { model: "rocket_topA", y: 2.6 },
];
const ROCKET_SCALE = 3;
const ROCKET_FOOT = 3.8;
const ROCKET_COLLIDER_H = 9;

const HANGAR_SCALE = 3.2;
const HANGAR_FOOT_X = 6.6;
const HANGAR_FOOT_Z = 9.8;
const HANGAR_COLLIDER_H = 3.4;

/**
 * A solid exterior model, measured from its GLB bounds in the kit's local frame.
 * `ox`/`oz` are the mesh-center offset on X/Z (≈ {@link KIT_OFFSET_X}/`_Z`, refined
 * per model), `hx`/`hz` the AABB half-extents, and `hy` the full height. `scale`
 * is the uniform instance scale; placement multiplies these by `scale` to size a
 * footprint-hugging collider box around the rendered mesh.
 */
interface SolidModel {
  model: string;
  scale: number;
  ox: number;
  oz: number;
  hx: number;
  hz: number;
  hy: number;
}

const CRAFT: SolidModel[] = [
  { model: "craft_speederA", scale: 2.6, ox: 2.0, oz: 1.5, hx: 1.0, hz: 1.05, hy: 0.8 },
  { model: "craft_cargoA", scale: 2.6, ox: 2.0, oz: 1.5, hx: 0.8, hz: 1.225, hy: 0.8 },
  { model: "craft_miner", scale: 2.6, ox: 2.0, oz: 1.5, hx: 0.9, hz: 1.3, hy: 0.7 },
  { model: "craft_racer", scale: 2.6, ox: 2.0, oz: 1.5, hx: 0.6, hz: 1.013, hy: 0.75 },
];
const CRAFT_COUNT = 4;

const BIG_ROCKS: SolidModel[] = [
  { model: "rock_largeA", scale: 3, ox: 2.007, oz: 1.485, hx: 0.46, hz: 0.417, hy: 0.5 },
  { model: "rock_largeB", scale: 3, ox: 1.994, oz: 1.51, hx: 0.464, hz: 0.47, hy: 0.5 },
  {
    model: "rock_crystalsLargeA",
    scale: 2.6,
    ox: 2.015,
    oz: 1.507,
    hx: 0.417,
    hz: 0.46,
    hy: 0.541,
  },
  { model: "rock_crystalsLargeB", scale: 2.6, ox: 1.99, oz: 1.492, hx: 0.47, hz: 0.466, hy: 0.55 },
];
const BIG_ROCK_COUNT = 12;

const SOLID_DEBRIS: SolidModel[] = [
  { model: "meteor", scale: 2.8, ox: 2.0, oz: 1.5, hx: 0.433, hz: 0.375, hy: 0.735 },
  { model: "meteor_detailed", scale: 2.6, ox: 2.0, oz: 1.5, hx: 0.433, hz: 0.413, hy: 0.735 },
];
const SOLID_DEBRIS_COUNT = 8;

const FLAT_DECOR = ["crater", "craterLarge", "rocks_smallA", "rocks_smallB"];
const FLAT_DECOR_COUNT = 18;

const BARRIER_ROCK_STEP = 9;
const BARRIER_ROCKS: SolidModel[] = [
  { model: "rock_largeA", scale: 3.2, ox: 2.007, oz: 1.485, hx: 0.46, hz: 0.417, hy: 0.5 },
  { model: "rock_largeB", scale: 3.2, ox: 1.994, oz: 1.51, hx: 0.464, hz: 0.47, hy: 0.5 },
  { model: "rock", scale: 3.2, ox: 1.971, oz: 1.546, hx: 0.401, hz: 0.426, hy: 0.3 },
  { model: "meteor_detailed", scale: 3.2, ox: 2.0, oz: 1.5, hx: 0.433, hz: 0.413, hy: 0.735 },
];

const PROP_COUNT = 56;
const PROP_SPAWN_TARGET = 16;
const PLACE_ATTEMPTS = 24;
const WALL_CLEAR = 0.6;
const DOOR_KEEPOUT = 3;
const SCENERY_GAP = 0.6;
const PROP_GAP = 0.5;
const SPAWN_CLEAR = 1.6;
const SPAWN_SPREAD = 6;
const PLAZA_CLEAR = 9;

interface Obstacle {
  x: number;
  z: number;
  r: number;
}

interface Wall {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function paint(region: Cell[][], id: string, i0: number, i1: number, j0: number, j1: number): void {
  for (let i = i0; i < i1; i++) {
    for (let j = j0; j < j1; j++) region[i]![j] = id;
  }
}

function wallsOf(colliders: BoxCollider[]): Wall[] {
  return colliders
    .filter((c) => c.position.y > 0)
    .map((c) => ({
      minX: c.position.x - c.size.x / 2,
      maxX: c.position.x + c.size.x / 2,
      minZ: c.position.z - c.size.z / 2,
      maxZ: c.position.z + c.size.z / 2,
    }));
}

function farFromWalls(x: number, z: number, clear: number, walls: Wall[]): boolean {
  for (const w of walls) {
    const nx = Math.min(Math.max(x, w.minX), w.maxX);
    const nz = Math.min(Math.max(z, w.minZ), w.maxZ);
    if (Math.hypot(x - nx, z - nz) < clear) return false;
  }
  return true;
}

function clearOf(x: number, z: number, r: number, items: Obstacle[], gap: number): boolean {
  for (const o of items) {
    if (Math.hypot(x - o.x, z - o.z) < r + o.r + gap) return false;
  }
  return true;
}

/** Avamposto Ares — open Martian apron walled by rock, dressed with cover, around a small module. */
export function buildMars(seed: number): MapDefinition {
  const rng = makeRng(seed);
  const grid: Grid = { gx: G, gz: G, halfW: HALF, halfD: HALF };

  const region: Cell[][] = Array.from({ length: G }, () => new Array<Cell>(G).fill(null));
  paint(region, "modA", 11, 15, 3, 8);
  paint(region, "modB", 15, 19, 3, 8);
  const doors: FloorplanDoor[] = [
    { axis: "v", line: 15, cell: 5 }, // Modulo A ↔ Modulo B
    { axis: "h", line: 8, cell: 13 }, // Modulo A → apron
    { axis: "h", line: 8, cell: 16 }, // Modulo B → apron
  ];

  const tiles: TileInstance[] = [];
  const colliders: BoxCollider[] = [];
  const doorways: Doorway[] = [];
  emitFloorplan(grid, region, doors, rng, { tiles, colliders, doorways });

  for (const [x, z, sx, sz] of [
    [0, -BARRIER, 2 * BARRIER + BARRIER_THICK, BARRIER_THICK],
    [0, BARRIER, 2 * BARRIER + BARRIER_THICK, BARRIER_THICK],
    [-BARRIER, 0, BARRIER_THICK, 2 * BARRIER + BARRIER_THICK],
    [BARRIER, 0, BARRIER_THICK, 2 * BARRIER + BARRIER_THICK],
  ] as const) {
    colliders.push({ position: { x, y: BARRIER_H / 2, z }, size: { x: sx, y: BARRIER_H, z: sz } });
  }

  const scenery: SceneryInstance[] = [];
  const obstacles: Obstacle[] = [];

  /** World-space footprint of a solid model placed at `(x, z)` with rotation `rot`. */
  const solidBox = (
    item: SolidModel,
    x: number,
    z: number,
    rot: number,
  ): { cx: number; cz: number; hx: number; hz: number; h: number; r: number } => {
    const { cx, cz } = kitCenter(x, z, rot, item.scale, item.ox, item.oz);
    const cos = Math.abs(Math.cos(rot));
    const sin = Math.abs(Math.sin(rot));
    const ax = item.hx * item.scale;
    const az = item.hz * item.scale;
    const hx = ax * cos + az * sin + COLLIDER_PAD;
    const hz = ax * sin + az * cos + COLLIDER_PAD;
    const h = item.hy * item.scale;
    return { cx, cz, hx, hz, h, r: Math.hypot(hx, hz) };
  };

  const pushSolid = (item: SolidModel, x: number, z: number, rot: number): void => {
    const { cx, cz, hx, hz, h, r } = solidBox(item, x, z, rot);
    scenery.push({
      model: ex(item.model),
      position: { x, y: 0, z },
      rotationY: rot,
      scale: item.scale,
    });
    colliders.push({ position: { x: cx, y: h / 2, z: cz }, size: { x: 2 * hx, y: h, z: 2 * hz } });
    obstacles.push({ x: cx, z: cz, r });
  };

  for (let t = -BARRIER + BARRIER_ROCK_STEP / 2; t < BARRIER; t += BARRIER_ROCK_STEP) {
    for (const [x, z] of [
      [t, -BARRIER],
      [t, BARRIER],
      [-BARRIER, t],
      [BARRIER, t],
    ] as const) {
      pushSolid(pick(BARRIER_ROCKS, rng), x, z, rng() * Math.PI * 2);
    }
  }

  for (const [x, z] of [
    [-44, 44],
    [44, 44],
  ] as const) {
    const rot = rng() * Math.PI * 2;
    for (const part of ROCKET_PARTS) {
      scenery.push({
        model: ex(part.model),
        position: { x, y: part.y * ROCKET_SCALE, z },
        rotationY: rot,
        scale: ROCKET_SCALE,
      });
    }
    const { cx, cz } = kitCenter(x, z, rot, ROCKET_SCALE, KIT_OFFSET_X, KIT_OFFSET_Z);
    colliders.push({
      position: { x: cx, y: ROCKET_COLLIDER_H / 2, z: cz },
      size: { x: ROCKET_FOOT, y: ROCKET_COLLIDER_H, z: ROCKET_FOOT },
    });
    obstacles.push({ x: cx, z: cz, r: ROCKET_FOOT / 2 + 0.5 });
  }

  {
    const x = -46;
    const z = 4;
    const rot = Math.PI / 2;
    scenery.push({
      model: ex("hangar_largeA"),
      position: { x, y: 0, z },
      rotationY: rot,
      scale: HANGAR_SCALE,
    });
    const { cx, cz } = kitCenter(x, z, rot, HANGAR_SCALE, KIT_OFFSET_X, KIT_OFFSET_Z);
    colliders.push({
      position: { x: cx, y: HANGAR_COLLIDER_H / 2, z: cz },
      size: { x: HANGAR_FOOT_Z, y: HANGAR_COLLIDER_H, z: HANGAR_FOOT_X },
    });
    obstacles.push({ x: cx, z: cz, r: HANGAR_FOOT_Z / 2 + 0.5 });
  }

  const walls = wallsOf(colliders);
  const inBase = (x: number, z: number): boolean => x > -18 && x < 18 && z > -50 && z < -26;
  const nearCenter = (x: number, z: number, clear: number): boolean => Math.hypot(x, z) < clear;

  const scatterSolid = (list: SolidModel[], count: number): void => {
    for (let n = 0; n < count; n++) {
      for (let a = 0; a < PLACE_ATTEMPTS; a++) {
        const item = pick(list, rng);
        const x = randRange(rng, -FIELD, FIELD);
        const z = randRange(rng, -FIELD, FIELD);
        const rot = rng() * Math.PI * 2;
        const { cx, cz, r } = solidBox(item, x, z, rot);
        if (inBase(cx, cz) || nearCenter(cx, cz, PLAZA_CLEAR)) continue;
        if (!farFromWalls(cx, cz, r + 1, walls)) continue;
        if (!clearOf(cx, cz, r, obstacles, SCENERY_GAP)) continue;
        pushSolid(item, x, z, rot);
        break;
      }
    }
  };

  scatterSolid(CRAFT, CRAFT_COUNT);
  scatterSolid(BIG_ROCKS, BIG_ROCK_COUNT);
  scatterSolid(SOLID_DEBRIS, SOLID_DEBRIS_COUNT);

  for (let n = 0; n < FLAT_DECOR_COUNT; n++) {
    const x = randRange(rng, -FIELD, FIELD);
    const z = randRange(rng, -FIELD, FIELD);
    if (!farFromWalls(x, z, 1, walls)) continue;
    scenery.push({
      model: ex(pick(FLAT_DECOR, rng)),
      position: { x, y: 0, z },
      rotationY: rng() * Math.PI * 2,
      scale: randRange(rng, 1.6, 3),
    });
  }

  const nearDoor = (x: number, z: number): boolean =>
    doorways.some((d) => Math.hypot(x - d.x, z - d.z) < DOOR_KEEPOUT);

  const radii = new Map(MARS_CATALOG.map((d) => [d.id, computePropBounds(d).radius]));
  const ids = MARS_CATALOG.map((d) => d.id);

  const propSpawns: Vec3[] = [];
  const spawnObstacles: Obstacle[] = [];
  for (let n = 0; n < PROP_SPAWN_TARGET; n++) {
    for (let a = 0; a < PLACE_ATTEMPTS; a++) {
      const x = randRange(rng, -FIELD, FIELD);
      const z = randRange(rng, -FIELD, FIELD);
      if (nearDoor(x, z)) continue;
      if (!farFromWalls(x, z, SPAWN_CLEAR, walls)) continue;
      if (!clearOf(x, z, SPAWN_CLEAR, obstacles, SCENERY_GAP)) continue;
      if (!clearOf(x, z, SPAWN_CLEAR, spawnObstacles, SPAWN_SPREAD)) continue;
      propSpawns.push({ x, y: 0, z });
      spawnObstacles.push({ x, z, r: SPAWN_CLEAR });
      break;
    }
  }

  const props: PropInstance[] = [];
  const placed: Obstacle[] = [...obstacles];
  for (let n = 0; n < PROP_COUNT; n++) {
    for (let a = 0; a < PLACE_ATTEMPTS; a++) {
      const x = randRange(rng, -FIELD, FIELD);
      const z = randRange(rng, -FIELD, FIELD);
      const id = pick(ids, rng);
      const r = radii.get(id) ?? 0.5;
      if (nearDoor(x, z)) continue;
      if (!farFromWalls(x, z, r + WALL_CLEAR, walls)) continue;
      if (!clearOf(x, z, r, placed, PROP_GAP)) continue;
      if (!clearOf(x, z, r, spawnObstacles, SPAWN_CLEAR)) continue;
      props.push({ type: id, position: { x, y: 0, z }, rotation: rng() * Math.PI * 2 });
      placed.push({ x, z, r });
      break;
    }
  }

  return {
    id: "mars",
    name: "Avamposto Ares",
    bounds: {
      min: { x: -BOUND, y: 0, z: -BOUND },
      max: { x: BOUND, y: 12, z: BOUND },
    },
    spawnPoints: { props: propSpawns },
    colliders,
    tiles,
    scenery,
    props,
    propCatalog: MARS_CATALOG,
  };
}
