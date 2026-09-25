import {
  type BoxCollider,
  computePropBounds,
  type MapDefinition,
  type PropInstance,
  type SceneryInstance,
  type TileInstance,
  type Vec3,
} from "@morphy/shared";
import { ARCHETYPE, type Doorway, furnishRoom, type RoomRect } from "../furnish";
import { MARS_CATALOG } from "../marsCatalog";
import {
  type Cell,
  emitFloorplan,
  type FloorplanDoor,
  type Grid,
  lineX,
  lineZ,
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
const BARRIER_FACE = BARRIER - BARRIER_THICK / 2;
const BOUND = 58;
const FIELD = 51;

const HALF_PI = Math.PI / 2;
const FULL_TURN = 2 * Math.PI;

const ex = (name: string): string => `/models/space/exterior/${name}.glb`;

/**
 * Every glTF in the Kenney space/exterior kit bakes a fixed node translation of
 * (2, 0, 1.5) local units, so a piece's visible mesh sits that far from its
 * instance origin (scaled, then rotated by `rotationY`). Solid colliders must
 * hug the rendered mesh, not the origin, so placement projects this offset to
 * world space; otherwise the box lands where the object only appears to be.
 * Symmetric pieces (craft, rockets, hangars) center exactly on this; organic
 * rocks deviate by a few cm and carry a refined per-model offset (see {@link SolidModel}).
 */
const KIT_OFFSET_X = 2;
const KIT_OFFSET_Z = 1.5;

/** Horizontal margin (world units) added around each solid box so the mesh is strictly enclosed. */
const COLLIDER_PAD = 0.05;

/**
 * Solid scenery that is built (craft, tanks, dishes, rockets) only rotates in
 * 90° steps: collision is AABB-only, so a quarter turn keeps the box exact, and
 * a machine standing at an arbitrary angle reads as fallen rather than placed.
 * Natural pieces (rocks, meteors) turn freely and take the rotated envelope.
 */
function cardinalRot(rng: () => number): number {
  return HALF_PI * Math.floor(rng() * 4);
}

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

/** Inverse of {@link kitCenter}: the instance origin that puts a kit model's mesh center at `(cx, cz)`. */
function kitOrigin(
  cx: number,
  cz: number,
  rot: number,
  scale: number,
  ox: number,
  oz: number,
): { x: number; z: number } {
  const center = kitCenter(0, 0, rot, scale, ox, oz);
  return { x: cx - center.cx, z: cz - center.cz };
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

const HANGAR_MODEL = "hangar_largeA";
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

const CRAFT_SCALE = 2.6;
const PARKED_CRAFT: SolidModel[] = [
  { model: "craft_speederA", scale: CRAFT_SCALE, ox: 2.0, oz: 1.5, hx: 1.0, hz: 1.05, hy: 0.8 },
  { model: "craft_speederB", scale: CRAFT_SCALE, ox: 2.0, oz: 1.5, hx: 1.0, hz: 1.013, hy: 0.6 },
  { model: "craft_racer", scale: CRAFT_SCALE, ox: 2.0, oz: 1.5, hx: 0.6, hz: 1.013, hy: 0.75 },
];
const WRECKED_CRAFT: SolidModel[] = [
  { model: "craft_speederC", scale: CRAFT_SCALE, ox: 2.0, oz: 1.5, hx: 1.4, hz: 0.963, hy: 0.6 },
  { model: "craft_speederD", scale: CRAFT_SCALE, ox: 2.0, oz: 1.5, hx: 1.4, hz: 1.113, hy: 0.9 },
  { model: "craft_cargoA", scale: CRAFT_SCALE, ox: 2.0, oz: 1.5, hx: 0.8, hz: 1.225, hy: 0.8 },
  { model: "craft_cargoB", scale: CRAFT_SCALE, ox: 2.0, oz: 1.5, hx: 0.75, hz: 1.25, hy: 0.9 },
];
const MINER: SolidModel = {
  model: "craft_miner",
  scale: CRAFT_SCALE,
  ox: 2.0,
  oz: 1.5,
  hx: 0.9,
  hz: 1.3,
  hy: 0.7,
};

const BIG_ROCKS: SolidModel[] = [
  { model: "rock_largeA", scale: 3, ox: 2.007, oz: 1.485, hx: 0.46, hz: 0.417, hy: 0.5 },
  { model: "rock_largeB", scale: 3, ox: 1.994, oz: 1.51, hx: 0.464, hz: 0.47, hy: 0.5 },
];
const CRYSTALS: SolidModel[] = [
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
const CRYSTAL_CLUMP: SolidModel = {
  model: "rock_crystals",
  scale: 2.4,
  ox: 1.954,
  oz: 1.471,
  hx: 0.425,
  hz: 0.401,
  hy: 0.337,
};
const METEORS: SolidModel[] = [
  { model: "meteor", scale: 2.8, ox: 2.0, oz: 1.5, hx: 0.433, hz: 0.375, hy: 0.735 },
  { model: "meteor_detailed", scale: 2.6, ox: 2.0, oz: 1.5, hx: 0.433, hz: 0.413, hy: 0.735 },
];
const FUEL_TANK: SolidModel = {
  model: "machine_barrelLarge",
  scale: 3,
  ox: 2.0,
  oz: 1.5,
  hx: 0.377,
  hz: 0.377,
  hy: 0.6,
};
const BIG_DISH: SolidModel = {
  model: "satelliteDish_large",
  scale: 3,
  ox: 2.0,
  oz: 1.401,
  hx: 0.424,
  hz: 0.368,
  hy: 0.814,
};
const SMALL_DISHES: SolidModel[] = [
  { model: "satelliteDish", scale: 2.6, ox: 2.0, oz: 1.467, hx: 0.344, hz: 0.283, hy: 0.616 },
  { model: "satelliteDish_detailed", scale: 2.6, ox: 2.0, oz: 1.5, hx: 0.35, hz: 0.35, hy: 0.616 },
];

const CRATERS = ["crater", "craterLarge"];
const RUBBLE = ["rocks_smallA", "rocks_smallB"];
const SCATTER_DECOR = [...CRATERS, ...RUBBLE];

const BARRIER_ROCK_STEP = 9;
const BARRIER_ROCKS: SolidModel[] = [
  { model: "rock_largeA", scale: 3.2, ox: 2.007, oz: 1.485, hx: 0.46, hz: 0.417, hy: 0.5 },
  { model: "rock_largeB", scale: 3.2, ox: 1.994, oz: 1.51, hx: 0.464, hz: 0.47, hy: 0.5 },
  { model: "rock", scale: 3.2, ox: 1.971, oz: 1.546, hx: 0.401, hz: 0.426, hy: 0.3 },
  { model: "meteor_detailed", scale: 3.2, ox: 2.0, oz: 1.5, hx: 0.433, hz: 0.413, hy: 0.735 },
];

/** How a piece is turned: a fixed number of quarter turns in its site's frame, any quarter turn, or any angle (natural things only). */
type Turn = number | "quarter" | "free";

type Range = readonly [number, number];

/** One solid scenery piece (it gets a collider). `scale` multiplies the model's own scale. */
interface SolidSpot {
  kind: "solid";
  pool: readonly SolidModel[];
  u: number;
  v: number;
  turn: Turn;
  chance?: number;
  scale?: Range;
}

/** Morphable props: a row when `step` is set (all sharing one turn), otherwise a pile within `spread`. */
interface PropSpot {
  kind: "props";
  pool: readonly string[];
  u: number;
  v: number;
  turn: Turn;
  count: Range;
  step?: readonly [number, number];
  spread?: number;
  chance?: number;
}

/** Flat ground decor (craters, rubble) with no collider, turned freely. */
interface DecorSpot {
  kind: "decor";
  pool: readonly string[];
  u: number;
  v: number;
  count: Range;
  spread: number;
  scale: Range;
}

/** A rocket standing on its fins and legs, a quarter turn at random. */
interface RocketSpot {
  kind: "rocket";
  u: number;
  v: number;
}

type Spot = SolidSpot | PropSpot | DecorSpot | RocketSpot;

/**
 * A designed site, as an ordered list of spots in a local frame: `u` across it,
 * `v` into it, with the `-v` side backing onto the barrier. The seed picks the
 * slot, which of the slot's two outward walls the site backs onto, a mirror,
 * and the details (counts, chances, model picks, jitter); the layout is fixed.
 */
type Site = readonly Spot[];

const FUEL_DEPOT: Site = [
  { kind: "rocket", u: -7, v: -8 },
  { kind: "rocket", u: 7, v: -8 },
  { kind: "solid", pool: [FUEL_TANK], u: -2.4, v: -12, turn: 0 },
  { kind: "solid", pool: [FUEL_TANK], u: 0, v: -12, turn: 0, chance: 0.85 },
  { kind: "solid", pool: [FUEL_TANK], u: 2.4, v: -12, turn: 0 },
  { kind: "solid", pool: [FUEL_TANK], u: -12, v: -10, turn: 0, scale: [1.2, 1.3], chance: 0.6 },
  { kind: "solid", pool: [FUEL_TANK], u: 12, v: -10, turn: 0, scale: [1.2, 1.3], chance: 0.6 },
  {
    kind: "props",
    pool: ["machine_barrel"],
    u: -10,
    v: -1,
    turn: 0,
    count: [3, 4],
    step: [1.5, 0],
  },
  { kind: "props", pool: ["machine_barrel"], u: 0, v: -8, turn: 0, count: [1, 2], step: [1.5, 0] },
  {
    kind: "props",
    pool: ["barrels_rail", "barrels"],
    u: 3,
    v: -1,
    turn: 0,
    count: [2, 3],
    step: [1.9, 0],
  },
  { kind: "props", pool: ["barrel"], u: -12.5, v: -5, turn: "quarter", count: [1, 3], spread: 1 },
  {
    kind: "props",
    pool: ["container", "container-flat"],
    u: 12.5,
    v: -4,
    turn: 1,
    count: [2, 3],
    step: [0, 1.4],
  },
  {
    kind: "props",
    pool: ["container-flat"],
    u: 0,
    v: 2,
    turn: "quarter",
    count: [1, 1],
    chance: 0.6,
  },
];

const CRYSTAL_MINE: Site = [
  { kind: "solid", pool: CRYSTALS, u: -10, v: -10, turn: "free", scale: [1.1, 1.4] },
  { kind: "solid", pool: CRYSTALS, u: -6.8, v: -11.5, turn: "free", scale: [1.2, 1.5] },
  { kind: "solid", pool: CRYSTALS, u: -3.4, v: -10.8, turn: "free", scale: [1, 1.3] },
  { kind: "solid", pool: CRYSTALS, u: 0, v: -11.8, turn: "free", scale: [1.1, 1.4] },
  { kind: "solid", pool: CRYSTALS, u: 3.4, v: -10.6, turn: "free", scale: [0.9, 1.2], chance: 0.8 },
  { kind: "solid", pool: [CRYSTAL_CLUMP], u: -7, v: -5.5, turn: "free", chance: 0.8 },
  { kind: "solid", pool: [CRYSTAL_CLUMP], u: 1.5, v: -6.5, turn: "free", chance: 0.7 },
  { kind: "solid", pool: [CRYSTAL_CLUMP], u: -11.5, v: -4, turn: "free", chance: 0.5 },
  { kind: "solid", pool: [MINER], u: 10, v: -7, turn: 0 },
  { kind: "props", pool: ["skip"], u: -7, v: -1, turn: 1, count: [2, 3], step: [1.9, 0] },
  { kind: "props", pool: ["machine_generator"], u: 5, v: -3, turn: 0, count: [1, 1], chance: 0.8 },
  { kind: "props", pool: ["rover"], u: -11.5, v: 2, turn: 1, count: [1, 1], chance: 0.8 },
  {
    kind: "props",
    pool: ["rocks_smallA", "rocks_smallB", "rock"],
    u: -2,
    v: -6,
    turn: "free",
    count: [2, 3],
    spread: 1.6,
  },
  {
    kind: "props",
    pool: ["container-flat", "barrel"],
    u: 6,
    v: 1.5,
    turn: "quarter",
    count: [1, 2],
    spread: 0.9,
  },
  { kind: "decor", pool: RUBBLE, u: -3, v: -4, count: [4, 5], spread: 6, scale: [1.8, 2.8] },
];

const ANTENNA_LINE: Site = [
  { kind: "solid", pool: [BIG_DISH], u: -10.5, v: -9, turn: 0, scale: [1.15, 1.15] },
  { kind: "solid", pool: [BIG_DISH], u: -3.5, v: -9, turn: 0, scale: [1.15, 1.15], chance: 0.85 },
  { kind: "solid", pool: [BIG_DISH], u: 3.5, v: -9, turn: 0, scale: [1.15, 1.15], chance: 0.85 },
  { kind: "solid", pool: [BIG_DISH], u: 10.5, v: -9, turn: 0, scale: [1.15, 1.15] },
  {
    kind: "props",
    pool: ["machine_wireless"],
    u: -10.2,
    v: -3.5,
    turn: 0,
    count: [5, 7],
    step: [3.4, 0],
  },
  { kind: "props", pool: ["machine_generator"], u: 0, v: -9, turn: 0, count: [1, 1], chance: 0.8 },
  {
    kind: "props",
    pool: ["machine_generator"],
    u: -7.8,
    v: -12.5,
    turn: 0,
    count: [1, 2],
    step: [1.6, 0],
  },
  {
    kind: "props",
    pool: ["container-flat", "container"],
    u: 6.5,
    v: -12.5,
    turn: 0,
    count: [1, 2],
    step: [1.5, 0],
    chance: 0.8,
  },
  {
    kind: "props",
    pool: ["barrel", "barrels"],
    u: -13,
    v: -5,
    turn: "quarter",
    count: [1, 2],
    spread: 0.8,
  },
  { kind: "solid", pool: SMALL_DISHES, u: 13, v: -3, turn: 1, chance: 0.5 },
  { kind: "decor", pool: RUBBLE, u: 0, v: 2, count: [1, 2], spread: 7, scale: [1.6, 2.4] },
];

const WRECK_FIELD: Site = [
  {
    kind: "decor",
    pool: ["craterLarge"],
    u: 1,
    v: -9,
    count: [1, 1],
    spread: 0,
    scale: [4.6, 5.2],
  },
  { kind: "solid", pool: METEORS, u: 1, v: -9, turn: "free", scale: [1.1, 1.3] },
  { kind: "decor", pool: ["crater"], u: -9, v: -2, count: [1, 1], spread: 0, scale: [3.4, 3.8] },
  { kind: "solid", pool: METEORS, u: -9, v: -2, turn: "free", scale: [0.8, 1], chance: 0.7 },
  { kind: "solid", pool: WRECKED_CRAFT, u: -8, v: -10, turn: "quarter" },
  { kind: "solid", pool: WRECKED_CRAFT, u: 9, v: -4, turn: "quarter", chance: 0.85 },
  { kind: "decor", pool: CRATERS, u: 0, v: -4, count: [3, 4], spread: 9, scale: [1.8, 3.2] },
  {
    kind: "props",
    pool: ["meteor_half", "meteor"],
    u: 4,
    v: -5,
    turn: "free",
    count: [2, 3],
    spread: 2.5,
  },
  { kind: "props", pool: ["bones"], u: -11, v: 2, turn: "free", count: [1, 2], spread: 1.2 },
  {
    kind: "props",
    pool: ["rock", "meteor_detailed"],
    u: 11,
    v: -11,
    turn: "free",
    count: [1, 2],
    spread: 1.2,
  },
  { kind: "props", pool: ["barrel"], u: -3, v: -6, turn: "quarter", count: [1, 2], spread: 1.5 },
  {
    kind: "props",
    pool: ["container-flat"],
    u: 6,
    v: 1,
    turn: "quarter",
    count: [1, 1],
    chance: 0.6,
  },
  { kind: "decor", pool: RUBBLE, u: 0, v: -5, count: [3, 5], spread: 8, scale: [1.6, 2.6] },
];

/** The four sites the seed deals out over {@link SITE_SLOTS}. */
const SITES: readonly Site[] = [FUEL_DEPOT, CRYSTAL_MINE, ANTENNA_LINE, WRECK_FIELD];

/** Where a site can stand, and the frame turns that put its back against either of the slot's two outer walls. */
interface Slot {
  x: number;
  z: number;
  backs: readonly number[];
}

const SITE_SLOTS: readonly Slot[] = [
  { x: -34, z: -35, backs: [0, HALF_PI] },
  { x: 34, z: -35, backs: [0, -HALF_PI] },
  { x: -34, z: 34, backs: [Math.PI, HALF_PI] },
  { x: 34, z: 34, backs: [Math.PI, -HALF_PI] },
];

/**
 * The habitat courtyard, pinned to the module because the module does not move:
 * cargo lined against its front wall between the doors, a parked craft and a
 * rover in the yard, fuel tanks on one side wall and a dish on the other. World
 * coordinates; the seed may mirror it across x = 0, which the module shares.
 */
const HABITAT_COURTYARD: Site = [
  {
    kind: "props",
    pool: ["container", "container-flat"],
    u: -15,
    v: -26.75,
    turn: 0,
    count: [2, 3],
    step: [1.5, 0],
  },
  {
    kind: "props",
    pool: ["machine_barrel"],
    u: 10,
    v: -26.75,
    turn: 0,
    count: [2, 3],
    step: [1.5, 0],
  },
  {
    kind: "props",
    pool: ["machine_generator"],
    u: 0,
    v: -26.75,
    turn: 0,
    count: [1, 1],
    chance: 0.8,
  },
  { kind: "solid", pool: PARKED_CRAFT, u: -19.5, v: -20, turn: 1, chance: 0.85 },
  { kind: "props", pool: ["rover"], u: 12.5, v: -21, turn: 1, count: [1, 1], chance: 0.8 },
  { kind: "solid", pool: [FUEL_TANK], u: 17.7, v: -44.6, turn: 0 },
  { kind: "solid", pool: [FUEL_TANK], u: 17.7, v: -42.2, turn: 0, chance: 0.8 },
  {
    kind: "props",
    pool: ["machine_barrel", "barrels"],
    u: 17.3,
    v: -38.5,
    turn: 1,
    count: [1, 2],
    step: [0, 1.6],
  },
  { kind: "solid", pool: SMALL_DISHES, u: -17.5, v: -40, turn: 3 },
  {
    kind: "props",
    pool: ["machine_wireless"],
    u: -17.2,
    v: -45.5,
    turn: 3,
    count: [1, 2],
    step: [0, 2],
  },
  {
    kind: "props",
    pool: ["barrel", "barrels"],
    u: -17.3,
    v: -32.5,
    turn: "quarter",
    count: [1, 2],
    spread: 0.8,
  },
];

/**
 * The east module room as a machine shop: generators and tanks square to the
 * outer wall, crates along the back, a rover in for service with a skip beside
 * it. Frame at the room's centre; not mirrored, because its doors are not.
 */
const MODULE_WORKSHOP: Site = [
  {
    kind: "props",
    pool: ["machine_generator", "machine_barrel"],
    u: 6.75,
    v: -7,
    turn: 3,
    count: [4, 6],
    step: [0, 2.3],
  },
  {
    kind: "props",
    pool: ["container", "container-flat"],
    u: -5,
    v: -8.75,
    turn: 0,
    count: [3, 5],
    step: [1.6, 0],
  },
  { kind: "props", pool: ["rover"], u: 0, v: 0.5, turn: "quarter", count: [1, 1], chance: 0.9 },
  { kind: "props", pool: ["skip"], u: 0, v: 4.5, turn: 1, count: [1, 1], chance: 0.7 },
  {
    kind: "props",
    pool: ["machine_wireless"],
    u: 6.75,
    v: 8.2,
    turn: 2,
    count: [1, 1],
    chance: 0.7,
  },
  {
    kind: "props",
    pool: ["barrel", "barrels"],
    u: 3.5,
    v: 7.8,
    turn: "quarter",
    count: [1, 2],
    spread: 0.8,
  },
];

/** A natural rock outcrop, dropped at the {@link OUTCROP_ANCHORS} between the sites. */
const OUTCROP: Site = [
  { kind: "solid", pool: BIG_ROCKS, u: 0, v: 0, turn: "free", scale: [1.1, 1.45] },
  { kind: "solid", pool: BIG_ROCKS, u: 3.2, v: 1, turn: "free", scale: [0.85, 1.15], chance: 0.85 },
  {
    kind: "solid",
    pool: [...BIG_ROCKS, ...METEORS],
    u: -3,
    v: 1.5,
    turn: "free",
    scale: [0.8, 1.05],
    chance: 0.7,
  },
  { kind: "solid", pool: BIG_ROCKS, u: 1, v: -3, turn: "free", scale: [0.7, 0.95], chance: 0.5 },
  { kind: "decor", pool: RUBBLE, u: 0.5, v: 3.5, count: [1, 2], spread: 2, scale: [1.6, 2.4] },
  {
    kind: "props",
    pool: ["rock", "rocks_smallA", "rocks_smallB", "meteor"],
    u: 0.5,
    v: 4.4,
    turn: "free",
    count: [1, 2],
    spread: 1.6,
  },
  {
    kind: "props",
    pool: ["rock", "meteor_half"],
    u: -1.5,
    v: -4.8,
    turn: "free",
    count: [0, 1],
    spread: 1,
  },
];

const OUTCROP_ANCHORS: readonly { x: number; z: number }[] = [
  { x: 40, z: 0 },
  { x: 0, z: 40 },
  { x: -20, z: 15 },
  { x: 20, z: 13 },
  { x: -24, z: -12 },
  { x: 26, z: -13 },
];
const OUTCROP_JITTER = 2;

/** Everything the module's supply room may hold: built stock only, so nothing natural lands indoors. */
const MODULE_STOCK = new Set([
  "container",
  "container-flat",
  "skip",
  "barrel",
  "barrels",
  "machine_barrel",
  "machine_generator",
]);

const GRID: Grid = { gx: G, gz: G, halfW: HALF, halfD: HALF };

/** The module's two rooms as grid cell spans, painted into the floorplan and furnished. */
const MODULE_CELLS = {
  modA: { i0: 11, i1: 15, j0: 3, j1: 8 },
  modB: { i0: 15, i1: 19, j0: 3, j1: 8 },
} as const;

function roomRect(cells: { i0: number; i1: number; j0: number; j1: number }): RoomRect {
  return {
    x0: lineX(GRID, cells.i0),
    x1: lineX(GRID, cells.i1),
    z0: lineZ(GRID, cells.j0),
    z1: lineZ(GRID, cells.j1),
  };
}

const MODULE_ROOM_A = roomRect(MODULE_CELLS.modA);
const MODULE_ROOM_B = roomRect(MODULE_CELLS.modB);
const ROOM_SPAWN_INSET = 2.6;
const MODULE_SPAWNS: readonly Vec3[] = [
  { x: MODULE_ROOM_A.x0 + ROOM_SPAWN_INSET, y: 0, z: MODULE_ROOM_A.z0 + ROOM_SPAWN_INSET },
  { x: MODULE_ROOM_B.x0 + ROOM_SPAWN_INSET, y: 0, z: MODULE_ROOM_B.z1 - ROOM_SPAWN_INSET },
];

function siteModels(site: Site): string[] {
  return site.flatMap((spot) => {
    if (spot.kind === "solid") return spot.pool.map((item) => item.model);
    if (spot.kind === "decor") return [...spot.pool];
    if (spot.kind === "rocket") return ROCKET_PARTS.map((part) => part.model);
    return [];
  });
}

/**
 * Every scenery model path that {@link buildMars} can emit for any seed, read off
 * the same site tables the builder places from, so a new piece cannot miss it.
 */
export const MARS_SCENERY_MODEL_PATHS = [
  ...new Set(
    [
      ...[...SITES, HABITAT_COURTYARD, MODULE_WORKSHOP, OUTCROP].flatMap(siteModels),
      ...BARRIER_ROCKS.map((item) => item.model),
      ...SCATTER_DECOR,
      HANGAR_MODEL,
    ].map(ex),
  ),
];

const SCATTER_DECOR_COUNT = 8;
const SCATTER_DECOR_SCALE: Range = [1.6, 3];
const DEFAULT_PROP_RADIUS = 0.5;
const LONE_PROP_COUNT = 6;
const LONE_PROPS = ["rock", "rocks_smallA", "rocks_smallB", "meteor_half"];
const PROP_SPAWN_TARGET = 16;
const PLACE_ATTEMPTS = 24;
const SPAWN_ATTEMPTS = 48;
const DOOR_KEEPOUT = 3;
const SOLID_PROP_GAP = 0.15;
const ARRANGED_GAP = 0.15;
const SCATTER_GAP = 0.5;
const NATURAL_OVERLAP = 1.5;
const BUILT_JITTER = 0.3;
const NATURAL_JITTER = 0.6;
const DECOR_REACH = 0.47;
const SITE_DECOR_MARGIN = 0;
const SCATTER_DECOR_MARGIN = 0.5;
const LONE_PROP_CLEAR = 2;
const SPAWN_CLEAR = 1.6;
const SPAWN_SPACING = 9;
const PLAZA_CLEAR = 9;
const DOOR_LANE_HALF = 2.2;
const DOOR_LANE_LENGTH = 11;
const HABITAT_ZONE = { minX: -22, maxX: 22, minZ: -50, maxZ: -16 };
const MODULE_ZONE: Footprint = {
  minX: MODULE_ROOM_A.x0,
  maxX: MODULE_ROOM_B.x1,
  minZ: MODULE_ROOM_A.z0,
  maxZ: MODULE_ROOM_A.z1,
};

interface Disc {
  x: number;
  z: number;
  r: number;
}

interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * A site's placement frame: its origin, the turn applied to it, whether `u` is
 * mirrored first, and how far a built spot's anchor may wander (zero for layouts
 * pinned flush against the module's walls).
 */
interface Frame {
  x: number;
  z: number;
  rot: number;
  flip: boolean;
  jitter: number;
}

function paint(region: Cell[][], id: string, i0: number, i1: number, j0: number, j1: number): void {
  for (let i = i0; i < i1; i++) {
    for (let j = j0; j < j1; j++) region[i]![j] = id;
  }
}

function footprintOf(c: BoxCollider): Footprint {
  return {
    minX: c.position.x - c.size.x / 2,
    maxX: c.position.x + c.size.x / 2,
    minZ: c.position.z - c.size.z / 2,
    maxZ: c.position.z + c.size.z / 2,
  };
}

/** Signed gap between two boxes: positive when apart, negative by the shallower penetration when they overlap. */
function boxGap(a: Footprint, b: Footprint): number {
  return Math.max(a.minX - b.maxX, b.minX - a.maxX, a.minZ - b.maxZ, b.minZ - a.maxZ);
}

function pointToBox(x: number, z: number, b: Footprint): number {
  const nx = Math.min(Math.max(x, b.minX), b.maxX);
  const nz = Math.min(Math.max(z, b.minZ), b.maxZ);
  return Math.hypot(x - nx, z - nz);
}

function inside(x: number, z: number, zone: Footprint): boolean {
  return x > zone.minX && x < zone.maxX && z > zone.minZ && z < zone.maxZ;
}

function toWorld(frame: Frame, u: number, v: number): { x: number; z: number } {
  const lu = frame.flip ? -u : u;
  const cos = Math.cos(frame.rot);
  const sin = Math.sin(frame.rot);
  return { x: frame.x + lu * cos + v * sin, z: frame.z - lu * sin + v * cos };
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Ares Outpost: a furnished two-room module with its courtyard, and four designed
 * sites (fuel depot at the rockets, crystal mine, antenna line, wreck field) that
 * the seed deals into the four corners, with rock outcrops framing the lanes
 * between them and the centre left open.
 */
export function buildMars(seed: number): MapDefinition {
  const rng = makeRng(seed);

  const region: Cell[][] = Array.from({ length: G }, () => new Array<Cell>(G).fill(null));
  for (const [id, cells] of Object.entries(MODULE_CELLS)) {
    paint(region, id, cells.i0, cells.i1, cells.j0, cells.j1);
  }
  const doors: FloorplanDoor[] = [
    { axis: "v", line: 15, cell: 5 },
    { axis: "h", line: 8, cell: 13 },
    { axis: "h", line: 8, cell: 16 },
  ];

  const tiles: TileInstance[] = [];
  const colliders: BoxCollider[] = [];
  const doorways: Doorway[] = [];
  emitFloorplan(GRID, region, doors, rng, { tiles, colliders, doorways });

  for (const [x, z, sx, sz] of [
    [0, -BARRIER, 2 * BARRIER + BARRIER_THICK, BARRIER_THICK],
    [0, BARRIER, 2 * BARRIER + BARRIER_THICK, BARRIER_THICK],
    [-BARRIER, 0, BARRIER_THICK, 2 * BARRIER + BARRIER_THICK],
    [BARRIER, 0, BARRIER_THICK, 2 * BARRIER + BARRIER_THICK],
  ] as const) {
    colliders.push({ position: { x, y: BARRIER_H / 2, z }, size: { x: sx, y: BARRIER_H, z: sz } });
  }

  const scenery: SceneryInstance[] = [];
  const props: PropInstance[] = [];
  const boxes: Footprint[] = colliders.map(footprintOf);
  const naturalBoxes = new Set<Footprint>();
  const discs: Disc[] = [];
  const decor: Disc[] = [];
  const spawns: Vec3[] = [...MODULE_SPAWNS];
  const radii = new Map(MARS_CATALOG.map((d) => [d.id, computePropBounds(d).radius]));
  const radiusOf = (id: string): number => radii.get(id) ?? DEFAULT_PROP_RADIUS;

  const lanes: Footprint[] = doorways
    .filter((d) => d.z === MODULE_ZONE.maxZ)
    .map((d) => ({
      minX: d.x - DOOR_LANE_HALF,
      maxX: d.x + DOOR_LANE_HALF,
      minZ: d.z,
      maxZ: d.z + DOOR_LANE_LENGTH,
    }));
  const nearDoor = (x: number, z: number, r: number): boolean =>
    doorways.some((d) => Math.hypot(x - d.x, z - d.z) < DOOR_KEEPOUT + r);
  const keptClear = (x: number, z: number, r: number): boolean =>
    nearDoor(x, z, r) ||
    Math.hypot(x, z) < PLAZA_CLEAR + r ||
    lanes.some((lane) => pointToBox(x, z, lane) < r);

  const addCollider = (collider: BoxCollider): void => {
    colliders.push(collider);
    boxes.push(footprintOf(collider));
  };

  /** World-space footprint of a solid model whose mesh centre is at `(cx, cz)`, turned by `rot`. */
  const solidFootprint = (
    item: SolidModel,
    cx: number,
    cz: number,
    rot: number,
    scale: number,
  ): Footprint => {
    const cos = Math.abs(Math.cos(rot));
    const sin = Math.abs(Math.sin(rot));
    const ax = item.hx * scale;
    const az = item.hz * scale;
    const hx = ax * cos + az * sin + COLLIDER_PAD;
    const hz = ax * sin + az * cos + COLLIDER_PAD;
    return { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz };
  };

  const solidFits = (box: Footprint, natural: boolean): boolean => {
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    const r = Math.hypot(box.maxX - cx, box.maxZ - cz);
    if (keptClear(cx, cz, r)) return false;
    const merges = (other: Footprint): boolean => natural && naturalBoxes.has(other);
    if (boxes.some((other) => boxGap(box, other) < (merges(other) ? -NATURAL_OVERLAP : 0))) {
      return false;
    }
    if (!natural && decor.some((d) => pointToBox(d.x, d.z, box) < d.r)) return false;
    return !discs.some((d) => pointToBox(d.x, d.z, box) < d.r + SOLID_PROP_GAP);
  };

  const pushSolid = (
    item: SolidModel,
    x: number,
    z: number,
    rot: number,
    scale: number,
    natural: boolean,
  ): void => {
    const { cx, cz } = kitCenter(x, z, rot, scale, item.ox, item.oz);
    const box = solidFootprint(item, cx, cz, rot, scale);
    const h = item.hy * scale;
    scenery.push({ model: ex(item.model), position: { x, y: 0, z }, rotationY: rot, scale });
    addCollider({
      position: { x: cx, y: h / 2, z: cz },
      size: { x: box.maxX - box.minX, y: h, z: box.maxZ - box.minZ },
    });
    if (natural) naturalBoxes.add(boxes[boxes.length - 1]!);
  };

  const placeSolid = (
    item: SolidModel,
    cx: number,
    cz: number,
    rot: number,
    scale: number,
    natural: boolean,
  ): boolean => {
    if (!solidFits(solidFootprint(item, cx, cz, rot, scale), natural)) return false;
    const origin = kitOrigin(cx, cz, rot, scale, item.ox, item.oz);
    pushSolid(item, origin.x, origin.z, rot, scale, natural);
    return true;
  };

  const placeRocket = (cx: number, cz: number, rot: number): boolean => {
    const half = ROCKET_FOOT / 2;
    const box = { minX: cx - half, maxX: cx + half, minZ: cz - half, maxZ: cz + half };
    if (!solidFits(box, false)) return false;
    const origin = kitOrigin(cx, cz, rot, ROCKET_SCALE, KIT_OFFSET_X, KIT_OFFSET_Z);
    for (const part of ROCKET_PARTS) {
      scenery.push({
        model: ex(part.model),
        position: { x: origin.x, y: part.y * ROCKET_SCALE, z: origin.z },
        rotationY: rot,
        scale: ROCKET_SCALE,
      });
    }
    addCollider({
      position: { x: cx, y: ROCKET_COLLIDER_H / 2, z: cz },
      size: { x: ROCKET_FOOT, y: ROCKET_COLLIDER_H, z: ROCKET_FOOT },
    });
    return true;
  };

  const placeProp = (type: string, x: number, z: number, rot: number, gap: number): boolean => {
    const r = radiusOf(type);
    if (Math.abs(x) > FIELD - r || Math.abs(z) > FIELD - r) return false;
    if (keptClear(x, z, r)) return false;
    if (boxes.some((box) => pointToBox(x, z, box) < r + SOLID_PROP_GAP)) return false;
    if (discs.some((d) => Math.hypot(x - d.x, z - d.z) < r + d.r + gap)) return false;
    if (decor.some((d) => Math.hypot(x - d.x, z - d.z) < d.r)) return false;
    if (spawns.some((s) => Math.hypot(x - s.x, z - s.z) < r + SPAWN_CLEAR)) return false;
    props.push({ type, position: { x, y: 0, z }, rotation: rot });
    discs.push({ x, z, r });
    return true;
  };

  const placeDecor = (
    model: string,
    cx: number,
    cz: number,
    rot: number,
    scale: number,
    margin: number,
  ): boolean => {
    const r = DECOR_REACH * scale;
    if (inside(cx, cz, HABITAT_ZONE)) return false;
    if (boxes.some((box) => pointToBox(cx, cz, box) < r + margin)) return false;
    if (discs.some((d) => Math.hypot(cx - d.x, cz - d.z) < r + d.r)) return false;
    const origin = kitOrigin(cx, cz, rot, scale, KIT_OFFSET_X, KIT_OFFSET_Z);
    scenery.push({
      model: ex(model),
      position: { x: origin.x, y: 0, z: origin.z },
      rotationY: rot,
      scale,
    });
    decor.push({ x: cx, z: cz, r });
    return true;
  };

  const jitter = (amount: number): number => (rng() * 2 - 1) * amount;
  const countOf = ([lo, hi]: Range): number => lo + Math.floor(rng() * (hi - lo + 1));
  const yawOf = (turn: Turn, frame: Frame): number => {
    if (turn === "free") return rng() * FULL_TURN;
    const local = turn === "quarter" ? cardinalRot(rng) : turn * HALF_PI;
    return frame.rot + (frame.flip ? -local : local);
  };

  const runSite = (site: Site, frame: Frame): void => {
    for (const spot of site) {
      if (spot.kind === "rocket") {
        const at = toWorld(frame, spot.u + jitter(frame.jitter), spot.v + jitter(frame.jitter));
        placeRocket(at.x, at.z, frame.rot + cardinalRot(rng));
        continue;
      }
      if (spot.kind === "decor") {
        const n = countOf(spot.count);
        for (let i = 0; i < n; i++) {
          const at = toWorld(frame, spot.u + jitter(spot.spread), spot.v + jitter(spot.spread));
          const scale = randRange(rng, spot.scale[0], spot.scale[1]);
          placeDecor(pick(spot.pool, rng), at.x, at.z, rng() * FULL_TURN, scale, SITE_DECOR_MARGIN);
        }
        continue;
      }
      if (spot.chance !== undefined && rng() >= spot.chance) continue;
      const natural = spot.turn === "free";
      const anchor = natural ? NATURAL_JITTER : frame.jitter;
      const u0 = spot.u + jitter(anchor);
      const v0 = spot.v + jitter(anchor);
      if (spot.kind === "solid") {
        const item = pick(spot.pool, rng);
        const scale = item.scale * (spot.scale ? randRange(rng, spot.scale[0], spot.scale[1]) : 1);
        const at = toWorld(frame, u0, v0);
        placeSolid(item, at.x, at.z, yawOf(spot.turn, frame), scale, natural);
        continue;
      }
      const n = countOf(spot.count);
      const [du, dv] = spot.step ?? [0, 0];
      const rowYaw = yawOf(spot.turn, frame);
      for (let i = 0; i < n; i++) {
        const spread = spot.spread ?? 0;
        const at = toWorld(frame, u0 + i * du + jitter(spread), v0 + i * dv + jitter(spread));
        const yaw = spot.step ? rowYaw : yawOf(spot.turn, frame);
        placeProp(pick(spot.pool, rng), at.x, at.z, yaw, ARRANGED_GAP);
      }
    }
  };

  for (let t = -BARRIER + BARRIER_ROCK_STEP / 2; t < BARRIER; t += BARRIER_ROCK_STEP) {
    for (const [x, z] of [
      [t, -BARRIER_FACE],
      [t, BARRIER_FACE],
      [-BARRIER_FACE, t],
      [BARRIER_FACE, t],
    ] as const) {
      const item = pick(BARRIER_ROCKS, rng);
      const rot = cardinalRot(rng);
      const origin = kitOrigin(x, z, rot, item.scale, item.ox, item.oz);
      pushSolid(item, origin.x, origin.z, rot, item.scale, true);
    }
  }

  {
    const x = -46;
    const z = 4;
    const rot = HALF_PI;
    scenery.push({
      model: ex(HANGAR_MODEL),
      position: { x, y: 0, z },
      rotationY: rot,
      scale: HANGAR_SCALE,
    });
    const { cx, cz } = kitCenter(x, z, rot, HANGAR_SCALE, KIT_OFFSET_X, KIT_OFFSET_Z);
    addCollider({
      position: { x: cx, y: HANGAR_COLLIDER_H / 2, z: cz },
      size: { x: HANGAR_FOOT_Z, y: HANGAR_COLLIDER_H, z: HANGAR_FOOT_X },
    });
  }

  const stock = MARS_CATALOG.filter((d) => MODULE_STOCK.has(d.id));
  const furnishedFrom = props.length;
  furnishRoom({
    rect: MODULE_ROOM_A,
    doorways,
    spawn: MODULE_SPAWNS[0]!,
    catalog: stock,
    rng,
    out: props,
    archetype: ARCHETYPE.STORAGE,
  });
  for (const p of props.slice(furnishedFrom)) {
    discs.push({ x: p.position.x, z: p.position.z, r: radiusOf(p.type) });
  }
  runSite(MODULE_WORKSHOP, {
    x: (MODULE_ROOM_B.x0 + MODULE_ROOM_B.x1) / 2,
    z: (MODULE_ROOM_B.z0 + MODULE_ROOM_B.z1) / 2,
    rot: 0,
    flip: false,
    jitter: 0,
  });
  runSite(HABITAT_COURTYARD, { x: 0, z: 0, rot: 0, flip: rng() < 0.5, jitter: 0 });

  const dealt = shuffle(SITES, rng);
  SITE_SLOTS.forEach((slot, i) => {
    const rot = pick(slot.backs, rng);
    runSite(dealt[i]!, { x: slot.x, z: slot.z, rot, flip: rng() < 0.5, jitter: BUILT_JITTER });
  });

  for (const anchor of OUTCROP_ANCHORS) {
    runSite(OUTCROP, {
      x: anchor.x + jitter(OUTCROP_JITTER),
      z: anchor.z + jitter(OUTCROP_JITTER),
      rot: cardinalRot(rng),
      flip: rng() < 0.5,
      jitter: BUILT_JITTER,
    });
  }

  for (let n = 0; n < SCATTER_DECOR_COUNT; n++) {
    for (let a = 0; a < PLACE_ATTEMPTS; a++) {
      const x = randRange(rng, -FIELD, FIELD);
      const z = randRange(rng, -FIELD, FIELD);
      const scale = randRange(rng, SCATTER_DECOR_SCALE[0], SCATTER_DECOR_SCALE[1]);
      const model = pick(SCATTER_DECOR, rng);
      if (placeDecor(model, x, z, rng() * FULL_TURN, scale, SCATTER_DECOR_MARGIN)) break;
    }
  }

  for (let n = 0; n < LONE_PROP_COUNT; n++) {
    for (let a = 0; a < PLACE_ATTEMPTS; a++) {
      const x = randRange(rng, -FIELD, FIELD);
      const z = randRange(rng, -FIELD, FIELD);
      if (inside(x, z, HABITAT_ZONE)) continue;
      if (boxes.some((box) => pointToBox(x, z, box) < LONE_PROP_CLEAR)) continue;
      if (placeProp(pick(LONE_PROPS, rng), x, z, rng() * FULL_TURN, SCATTER_GAP)) break;
    }
  }

  while (spawns.length < PROP_SPAWN_TARGET) {
    let placed = false;
    for (let a = 0; a < SPAWN_ATTEMPTS && !placed; a++) {
      const x = randRange(rng, -FIELD, FIELD);
      const z = randRange(rng, -FIELD, FIELD);
      if (inside(x, z, MODULE_ZONE) || nearDoor(x, z, 0)) continue;
      if (boxes.some((box) => pointToBox(x, z, box) < SPAWN_CLEAR)) continue;
      if (discs.some((d) => Math.hypot(x - d.x, z - d.z) < d.r + SPAWN_CLEAR)) continue;
      if (spawns.some((s) => Math.hypot(x - s.x, z - s.z) < SPAWN_SPACING)) continue;
      spawns.push({ x, y: 0, z });
      placed = true;
    }
    if (!placed) break;
  }

  return {
    id: "mars",
    bounds: {
      min: { x: -BOUND, y: 0, z: -BOUND },
      max: { x: BOUND, y: 12, z: BOUND },
    },
    spawnPoints: { props: spawns },
    colliders,
    tiles,
    scenery,
    props,
    propCatalog: MARS_CATALOG,
  };
}
