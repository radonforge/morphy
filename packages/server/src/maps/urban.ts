import {
  type BoxCollider,
  computePropBounds,
  type MapDefinition,
  type PropInstance,
  type SceneryInstance,
  type TileInstance,
  type Vec3,
} from "@morphy/shared";
import { URBAN_CATALOG } from "../urbanCatalog";
import { makeRng, pick, randRange } from "./lib";

const CELL = 12;
const G = 9;
const HALF = (G * CELL) / 2;
const ROADS = new Set([1, 4, 7]);
const BARRIER = HALF;
const BARRIER_THICK = 3;
const BARRIER_H = 10;
const BOUND = HALF + 2;
const REACH = BARRIER - BARRIER_THICK / 2;
const LOT_EDGE = CELL / 2;

const ROAD_STRAIGHT = "/models/urban/roads/road-straight.glb";
const ROAD_CROSS = "/models/urban/roads/road-crossroad.glb";
const ROAD_SCALE = CELL;
const ROAD_SCALE_Y = 1;
const ROAD_RAW_SURFACE_Y = 0.01;
const ROAD_Y = -ROAD_RAW_SURFACE_Y * ROAD_SCALE_Y;
const ROAD_RAW_ASPHALT_HALF = 0.4;
const KERB_WIDTH = LOT_EDGE - ROAD_RAW_ASPHALT_HALF * ROAD_SCALE;

const PAVEMENT_TILE = "/models/urban/roads/tile-low.glb";
const PAVEMENT_BAND = 1.5;
const BAY_TILE = "/models/urban/driveway-long.glb";
const BAY_RAW_WIDTH = 0.36;
const BAY_RAW_LENGTH = 0.4;
const BAY_WIDTH = 2.4;
const BAY_SCALE = BAY_WIDTH / BAY_RAW_WIDTH;
const BAY_TILE_LENGTH = BAY_RAW_LENGTH * BAY_SCALE;
const BAY_TILES_DEEP = 2;
const BAY_COUNT = 4;

/**
 * A building model with its GLB bbox size (`nx`/`ny`/`nz`) and, when the mesh
 * is not centered on its origin, the bbox-center offset (`cx`/`cz`); the
 * visual is shifted by the rotated offset so it lands on its collider. Every
 * model in the kit has its front door on local +z.
 */
interface BModel {
  id: string;
  nx: number;
  nz: number;
  ny: number;
  cx?: number;
  cz?: number;
}

/** A building zone: its kit, its models, and the share of its empty lots that become parks rather than car parks. */
interface Zone {
  kit: string;
  models: BModel[];
  parkShare: number;
}

const RESIDENTIAL: Zone = {
  kit: "urban",
  models: [
    { id: "building-type-b", nx: 1.83, nz: 1.14, ny: 1.14 },
    { id: "building-type-d", nx: 1.76, nz: 1.03, ny: 1.24 },
    { id: "building-type-f", nx: 1.43, nz: 1.41, ny: 1.14 },
    { id: "building-type-n", nx: 1.78, nz: 1.38, ny: 1.14 },
    { id: "building-type-t", nx: 1.31, nz: 1.41, ny: 1.16 },
    { id: "building-type-a", nx: 1.3, nz: 1.03, ny: 0.83 },
  ],
  parkShare: 0.75,
};
const COMMERCIAL: Zone = {
  kit: "urban/commercial",
  models: [
    { id: "building-i", nx: 1.24, nz: 1.3, ny: 1.68 },
    { id: "building-j", nx: 2.08, nz: 1.34, ny: 1.69 },
    { id: "building-n", nx: 2.32, nz: 1.82, ny: 2.48 },
    { id: "building-l", nx: 1.37, nz: 1.4, ny: 2.27 },
    { id: "building-skyscraper-a", nx: 1.36, nz: 1.36, ny: 2.88 },
    { id: "building-skyscraper-c", nx: 1.28, nz: 1.39, ny: 4.08 },
  ],
  parkShare: 0.5,
};
const INDUSTRIAL: Zone = {
  kit: "urban/industrial",
  models: [
    { id: "building-a", nx: 2.08, nz: 1.24, ny: 1.47 },
    { id: "building-c", nx: 1.88, nz: 2.11, ny: 1.25, cx: 0.1, cz: 0.14 },
    { id: "building-l", nx: 2.08, nz: 1.87, ny: 1.92, cx: -0.42, cz: 0.22 },
    { id: "building-r", nx: 2.48, nz: 1.27, ny: 1.39 },
    { id: "building-f", nx: 1.79, nz: 1.28, ny: 1.92, cx: -0.45, cz: 0.25 },
    { id: "building-q", nx: 2.14, nz: 1.77, ny: 0.88, cx: -0.23, cz: 0.01 },
  ],
  parkShare: 0.25,
};

/** Every tile/scenery model path that {@link buildUrban} can emit for any seed. */
export const URBAN_SCENERY_MODEL_PATHS = [
  ROAD_STRAIGHT,
  ROAD_CROSS,
  PAVEMENT_TILE,
  BAY_TILE,
  ...[RESIDENTIAL, COMMERCIAL, INDUSTRIAL].flatMap((zone) =>
    zone.models.map((model) => `/models/${zone.kit}/${model.id}.glb`),
  ),
];

const BUILD_TARGET_MIN = 7.6;
const BUILD_TARGET_MAX = 9;
const EMPTY_LOT_CHANCE = 0.18;
const HALF_PI = Math.PI / 2;
const FULL_TURN = Math.PI * 2;

const PROP_SPAWN_TARGET = 16;
const PLAZA_CLEAR = 7;
const PROP_GAP = 0.6;
const BUILDING_GAP = 0.3;
const TIGHT_GAP = 0;
const SITE_MIN_CENTER = 2 * CELL;

const KERB_ROW = 0.85;
const KERB_PITCH_MIN = 4;
const KERB_PITCH_MAX = 6;
const KERB_END_CLEAR = 3;
const KERB_PATTERNS: readonly (readonly string[])[] = [
  ["tree-large"],
  ["tree-small", "planter"],
  ["tree-large", "planter"],
  ["tree-small"],
];
const NATURAL = new Set(["tree-large", "tree-small"]);
const ENTRANCE_CLEAR = 3;

const FENCE_LINE = PAVEMENT_BAND + 0.35;
const FENCE_PITCH = 1.27;
const FENCE_END = 0.7;
const GATE_HALF = 2;
const GATE_LIGHT_DEPTH = 1.1;
const GATE_CONE_DEPTH = 0.6;
const GATE_CONE_SPREAD = 1.2;
const LANE_WIDTH = 2.4;
const TAPER_CONES = 4;
const TAPER_START = 0.8;
const TAPER_STEP = 1.4;
const TAPER_W0 = 0.5;
const CLOSURE_BARRIER_GAP = 0.9;
const CLOSURE_BARRIER_W = [0.6, 1.8];
const CLOSURE_LIGHT_BEHIND = 0.85;
const CLOSURE_LIGHT_W = 1.2;
const CLOSURE_END_CONES = [3, 5];
const CLOSURE_END_MARGIN = 0.5;
const YARD_BACK = 1.4;
const YARD_COLUMN_SPREAD = 1.6;
const YARD_COLUMNS = ["bridge-pillar-wide", "bridge-pillar", "bridge-pillar-wide", "bridge-pillar"];
const YARD_SPARE_T = 3.3;
const YARD_SPARE_D = [-0.63, 0.63];
const YARD_TANK_END = 1.6;

const PARK_GRID = 3;
const PARK_JITTER = 0.5;
const PARK_SKIPS = 2;

const BOLLARD_DEPTH = PAVEMENT_BAND + 0.35;
const BOLLARD_PITCH = 3.2;
const BOLLARD_START = PAVEMENT_BAND + 0.5;
const ENTRANCE_HALF = 2.2;
const BOLLARD_TYPES = ["bridge-pillar", "bridge-pillar-wide"];

const CAFE_COUNT = 3;
const CAFE_DEPTH = 0.5;
const CAFE_PITCH = 2.2;
const CAFE_SCAN = 0.2;
const CAFE_END = 1;
const CAFE_GAP = 0.3;
const CAFE_PARASOLS = ["detail-parasol-a", "detail-parasol-b"];

const YARD_ITEMS = ["detail-tank", "chimney-small", "chimney-basic"];
const YARD_ITEM_COUNT = 2;
const YARD_SCAN = 0.2;
const YARD_END = 1;

const LOT_INDICES = [...Array(G).keys()].filter((i) => !ROADS.has(i));
const RUNS = LOT_INDICES.reduce<number[][]>((runs, i) => {
  const last = runs.at(-1);
  if (last && last.at(-1) === i - 1) last.push(i);
  else runs.push([i]);
  return runs;
}, []);

const cellCenter = (i: number): number => -HALF + (i + 0.5) * CELL;
const isRoad = (i: number): boolean => ROADS.has(i);
const roadward = (i: number): number => (ROADS.has(i + 1) ? 1 : -1);
const cellOf = (coord: number): number => Math.floor((coord + HALF) / CELL);
const zoneOf = (j: number): Zone => (j <= 2 ? RESIDENTIAL : j <= 5 ? COMMERCIAL : INDUSTRIAL);
/** Yaw that turns a model's local +z toward world `(s, 0)`; its local x then runs along z. */
const faceX = (s: number): number => (s > 0 ? HALF_PI : 3 * HALF_PI);
/** Yaw that turns a model's local +z toward world `(0, s)`; its local x then runs along x. */
const faceZ = (s: number): number => (s > 0 ? 0 : Math.PI);

type LotKind = "building" | "park" | "carpark" | "site";
type Side = "x" | "z";

interface Building {
  frontsX: boolean;
  fx: number;
  fz: number;
}

/**
 * One 12 m lot. Every lot sits on a block corner, so it fronts exactly one
 * road along each axis: `sx`/`sz` point toward them. Lot-local `u`/`v` are
 * the depths in from the x-road and z-road edges, and `depthU`/`depthV` how
 * far each runs before the lot ends or the barrier cuts it off.
 */
interface Lot {
  i: number;
  j: number;
  cx: number;
  cz: number;
  sx: number;
  sz: number;
  depthU: number;
  depthV: number;
  zone: Zone;
  kind: LotKind;
  building?: Building;
}

interface Point {
  x: number;
  z: number;
}

interface Obstacle extends Point {
  r: number;
}

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const reachableDepth = (center: number, s: number): number =>
  CELL - Math.max(0, Math.abs(center - s * LOT_EDGE) - REACH);

const at = (lot: Lot, u: number, v: number): Point => ({
  x: lot.cx + lot.sx * (LOT_EDGE - u),
  z: lot.cz + lot.sz * (LOT_EDGE - v),
});

const sidePoint = (lot: Lot, side: Side, depth: number, t: number): Point =>
  side === "x" ? at(lot, depth, t) : at(lot, t, depth);

const sideFacing = (lot: Lot, side: Side): number => (side === "x" ? faceX(lot.sx) : faceZ(lot.sz));

const sideLength = (lot: Lot, side: Side): number => (side === "x" ? lot.depthV : lot.depthU);

const otherSide = (side: Side): Side => (side === "x" ? "z" : "x");

const boxDistance = (p: Point, b: Box): number =>
  Math.hypot(Math.max(b.minX - p.x, 0, p.x - b.maxX), Math.max(b.minZ - p.z, 0, p.z - b.maxZ));

/**
 * North District: a zoned street grid of solid building blocks. Every lot has
 * a pavement in front, buildings stand on the pavement line with their door to
 * a street, the kerbs carry a regular row of trees and planters, and empty
 * lots become parks, car parks or the one construction site of the match. The
 * carriageways stay open as lines of fire; the cover is at their sides.
 */
export function buildUrban(seed: number): MapDefinition {
  const rng = makeRng(seed);
  const tiles: TileInstance[] = [];
  const colliders: BoxCollider[] = [];
  const scenery: SceneryInstance[] = [];

  for (const [x, z, sx, sz] of [
    [0, -BARRIER, 2 * BARRIER + BARRIER_THICK, BARRIER_THICK],
    [0, BARRIER, 2 * BARRIER + BARRIER_THICK, BARRIER_THICK],
    [-BARRIER, 0, BARRIER_THICK, 2 * BARRIER + BARRIER_THICK],
    [BARRIER, 0, BARRIER_THICK, 2 * BARRIER + BARRIER_THICK],
  ] as const) {
    colliders.push({ position: { x, y: BARRIER_H / 2, z }, size: { x: sx, y: BARRIER_H, z: sz } });
  }

  for (let i = 0; i < G; i++) {
    for (let j = 0; j < G; j++) {
      const roadI = isRoad(i);
      const roadJ = isRoad(j);
      if (!roadI && !roadJ) continue;
      const cross = roadI && roadJ;
      tiles.push({
        model: cross ? ROAD_CROSS : ROAD_STRAIGHT,
        position: { x: cellCenter(i), y: ROAD_Y, z: cellCenter(j) },
        rotationY: roadI && !cross ? HALF_PI : 0,
        scale: ROAD_SCALE,
        scaleY: ROAD_SCALE_Y,
      });
    }
  }

  const lots: Lot[] = LOT_INDICES.flatMap((i) =>
    LOT_INDICES.map((j): Lot => {
      const cx = cellCenter(i);
      const cz = cellCenter(j);
      const sx = roadward(i);
      const sz = roadward(j);
      return {
        i,
        j,
        cx,
        cz,
        sx,
        sz,
        depthU: reachableDepth(cx, sx),
        depthV: reachableDepth(cz, sz),
        zone: zoneOf(j),
        kind: "building",
      };
    }),
  );
  const lotAt = (i: number, j: number): Lot | undefined =>
    lots.find((lot) => lot.i === i && lot.j === j);

  const siteLot = pick(
    lots.filter((lot) => Math.hypot(lot.cx, lot.cz) > SITE_MIN_CENTER),
    rng,
  );
  for (const lot of lots) {
    if (lot === siteLot) lot.kind = "site";
    else if (rng() < EMPTY_LOT_CHANCE) lot.kind = rng() < lot.zone.parkShare ? "park" : "carpark";
  }

  for (const lot of lots) {
    for (let n = 0; n * PAVEMENT_BAND < CELL; n++) {
      const t = (n + 0.5) * PAVEMENT_BAND;
      const band = PAVEMENT_BAND / 2;
      const strips = n === 0 ? [at(lot, band, t)] : [at(lot, band, t), at(lot, t, band)];
      for (const p of strips) {
        tiles.push({
          model: PAVEMENT_TILE,
          position: { x: p.x, y: ROAD_Y, z: p.z },
          rotationY: 0,
          scale: PAVEMENT_BAND,
          scaleY: ROAD_SCALE_Y,
        });
      }
    }
  }

  const buildingBoxes: Box[] = [];
  for (const lot of lots) {
    if (lot.kind !== "building") continue;
    const m = pick(lot.zone.models, rng);
    const target = randRange(rng, BUILD_TARGET_MIN, BUILD_TARGET_MAX);
    const scale = target / Math.max(m.nx, m.nz);
    const frontsX = rng() < 0.5;
    const rot = frontsX ? faceX(lot.sx) : faceZ(lot.sz);
    const fx = (frontsX ? m.nz : m.nx) * scale;
    const fz = (frontsX ? m.nx : m.nz) * scale;
    const height = m.ny * scale;
    const center = at(lot, PAVEMENT_BAND + fx / 2, PAVEMENT_BAND + fz / 2);
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const offX = ((m.cx ?? 0) * cosR + (m.cz ?? 0) * sinR) * scale;
    const offZ = (-(m.cx ?? 0) * sinR + (m.cz ?? 0) * cosR) * scale;
    scenery.push({
      model: `/models/${lot.zone.kit}/${m.id}.glb`,
      position: { x: center.x - offX, y: 0, z: center.z - offZ },
      rotationY: rot,
      scale,
    });
    colliders.push({
      position: { x: center.x, y: height / 2, z: center.z },
      size: { x: fx, y: height, z: fz },
    });
    buildingBoxes.push({
      minX: center.x - fx / 2,
      maxX: center.x + fx / 2,
      minZ: center.z - fz / 2,
      maxZ: center.z + fz / 2,
    });
    lot.building = { frontsX, fx, fz };
  }

  const radii = new Map(URBAN_CATALOG.map((d) => [d.id, computePropBounds(d).radius]));
  const radiusOf = (id: string): number => {
    const radius = radii.get(id);
    if (radius === undefined) {
      throw new Error(`urban layout places "${id}", which is not in URBAN_CATALOG; add it there`);
    }
    return radius;
  };
  const nearCenter = (x: number, z: number, clear: number): boolean => Math.hypot(x, z) < clear;
  const clearOf = (x: number, z: number, r: number, items: Obstacle[], gap: number): boolean =>
    items.every((o) => Math.hypot(x - o.x, z - o.z) >= r + o.r + gap);
  const clearOfBuildings = (p: Point, r: number): boolean =>
    buildingBoxes.every((b) => boxDistance(p, b) >= r + BUILDING_GAP);

  const props: PropInstance[] = [];
  const placed: Obstacle[] = [];
  const place = (p: Point, id: string, rotation: number, gap = PROP_GAP): boolean => {
    const r = radiusOf(id);
    if (nearCenter(p.x, p.z, PLAZA_CLEAR)) return false;
    if (Math.abs(p.x) > REACH - r || Math.abs(p.z) > REACH - r) return false;
    if (!clearOfBuildings(p, r)) return false;
    if (!clearOf(p.x, p.z, r, placed, gap)) return false;
    props.push({ type: id, position: { x: p.x, y: 0, z: p.z }, rotation });
    placed.push({ x: p.x, z: p.z, r });
    return true;
  };

  const fenceSide = (lot: Lot, side: Side, gate?: number): void => {
    const facing = sideFacing(lot, side);
    const count = Math.floor((sideLength(lot, side) - FENCE_END - FENCE_LINE) / FENCE_PITCH);
    for (let n = 1; n <= count; n++) {
      const t = FENCE_LINE + n * FENCE_PITCH;
      if (gate !== undefined && Math.abs(t - gate) < GATE_HALF) continue;
      const id = n === count ? "fence-2x2" : "fence-1x2";
      place(sidePoint(lot, side, FENCE_LINE, t), id, facing, TIGHT_GAP);
    }
  };

  const buildSite = (lot: Lot): void => {
    const gateSide: Side = rng() < 0.5 ? "x" : "z";
    const flankSide = otherSide(gateSide);
    const length = sideLength(lot, gateSide);
    const depth = sideLength(lot, flankSide);
    const gate = length / 2;
    const facing = sideFacing(lot, gateSide);
    place(at(lot, FENCE_LINE, FENCE_LINE), "fence-2x2", facing, TIGHT_GAP);
    fenceSide(lot, gateSide, gate);
    fenceSide(lot, flankSide);
    for (const spread of [-1, 1]) {
      const post = gate + spread * GATE_HALF;
      place(
        sidePoint(lot, gateSide, FENCE_LINE + GATE_LIGHT_DEPTH, post),
        "construction-light",
        facing,
        TIGHT_GAP,
      );
      place(
        sidePoint(lot, gateSide, GATE_CONE_DEPTH, gate + spread * GATE_CONE_SPREAD),
        "construction-cone",
        facing,
        TIGHT_GAP,
      );
    }
    YARD_COLUMNS.forEach((id, n) => {
      const t = gate + (n - (YARD_COLUMNS.length - 1) / 2) * YARD_COLUMN_SPREAD;
      place(sidePoint(lot, gateSide, depth - YARD_BACK, t), id, facing, TIGHT_GAP);
    });
    const middle = (FENCE_LINE + depth) / 2;
    for (const d of YARD_SPARE_D) {
      place(
        sidePoint(lot, gateSide, middle + d, YARD_SPARE_T),
        "construction-barrier",
        facing,
        TIGHT_GAP,
      );
    }
    place(
      sidePoint(lot, gateSide, middle, length - YARD_TANK_END),
      "detail-tank",
      facing,
      TIGHT_GAP,
    );

    const flip = rng() < 0.5;
    const along = (t: number): number => (flip ? length - t : t);
    const lane = (w: number, t: number): Point =>
      sidePoint(lot, gateSide, -KERB_WIDTH - w, along(t));
    for (let k = 0; k < TAPER_CONES; k++) {
      const w = TAPER_W0 + ((LANE_WIDTH - TAPER_W0) * k) / (TAPER_CONES - 1);
      place(lane(w, TAPER_START + k * TAPER_STEP), "construction-cone", facing, TIGHT_GAP);
    }
    const barrierT = TAPER_START + (TAPER_CONES - 1) * TAPER_STEP + CLOSURE_BARRIER_GAP;
    for (const w of CLOSURE_BARRIER_W) {
      place(lane(w, barrierT), "construction-barrier", facing, TIGHT_GAP);
    }
    place(
      lane(CLOSURE_LIGHT_W, barrierT + CLOSURE_LIGHT_BEHIND),
      "construction-light",
      facing,
      TIGHT_GAP,
    );
    for (const offset of CLOSURE_END_CONES) {
      const t = barrierT + offset;
      if (t <= length - CLOSURE_END_MARGIN) {
        place(lane(LANE_WIDTH, t), "construction-cone", facing, TIGHT_GAP);
      }
    }
  };

  const buildPark = (lot: Lot): void => {
    const cells: [number, number][] = [];
    for (let a = 0; a < PARK_GRID; a++) {
      for (let b = 0; b < PARK_GRID; b++) cells.push([a, b]);
    }
    const middle = (PARK_GRID - 1) / 2;
    const ring = cells.filter(([a, b]) => a !== middle || b !== middle);
    const skipped = new Set<number>();
    while (skipped.size < PARK_SKIPS) skipped.add(Math.floor(rng() * ring.length));
    const cellU = (lot.depthU - PAVEMENT_BAND) / PARK_GRID;
    const cellV = (lot.depthV - PAVEMENT_BAND) / PARK_GRID;
    const spot = (a: number, b: number, jitter: number): Point =>
      at(
        lot,
        PAVEMENT_BAND + (a + 0.5) * cellU + randRange(rng, -jitter, jitter),
        PAVEMENT_BAND + (b + 0.5) * cellV + randRange(rng, -jitter, jitter),
      );
    ring.forEach(([a, b], n) => {
      if (skipped.has(n)) return;
      const id = (a + b) % 2 === 0 ? "tree-large" : "tree-small";
      place(spot(a, b, PARK_JITTER), id, rng() * FULL_TURN);
    });
    place(spot(middle, middle, 0), "planter", sideFacing(lot, rng() < 0.5 ? "x" : "z"));
  };

  const entrances: Point[] = [];
  const buildCarPark = (lot: Lot): void => {
    const entry: Side = rng() < 0.5 ? "x" : "z";
    const back = otherSide(entry);
    const length = sideLength(lot, entry);
    const depth = sideLength(lot, back);
    const facing = sideFacing(lot, entry);
    const middle = (PAVEMENT_BAND + length) / 2;
    for (let k = 0; k < BAY_COUNT; k++) {
      const t = middle + (k - (BAY_COUNT - 1) / 2) * BAY_WIDTH;
      for (let m = 0; m < BAY_TILES_DEEP; m++) {
        const p = sidePoint(lot, entry, depth - (m + 0.5) * BAY_TILE_LENGTH, t);
        tiles.push({
          model: BAY_TILE,
          position: { x: p.x, y: ROAD_Y, z: p.z },
          rotationY: facing,
          scale: BAY_SCALE,
          scaleY: ROAD_SCALE_Y,
        });
      }
    }
    entrances.push(sidePoint(lot, entry, -KERB_WIDTH / 2, middle));
    const bollard = pick(BOLLARD_TYPES, rng);
    for (const side of [entry, back]) {
      const end = sideLength(lot, side) - BOLLARD_START;
      for (let t = BOLLARD_START; t <= end; t += BOLLARD_PITCH) {
        if (side === entry && Math.abs(t - middle) < ENTRANCE_HALF) continue;
        place(sidePoint(lot, side, BOLLARD_DEPTH, t), bollard, sideFacing(lot, side), TIGHT_GAP);
      }
    }
  };

  for (const lot of lots) {
    if (lot.kind === "site") buildSite(lot);
    else if (lot.kind === "park") buildPark(lot);
    else if (lot.kind === "carpark") buildCarPark(lot);
  }

  const patternOffset = Math.floor(rng() * KERB_PATTERNS.length);
  const streets = [true, false].flatMap((vertical) =>
    [...ROADS].map((road) => ({ vertical, road })),
  );
  streets.forEach(({ vertical, road }, index) => {
    const pattern = KERB_PATTERNS[(index + patternOffset) % KERB_PATTERNS.length]!;
    const pitch = randRange(rng, KERB_PITCH_MIN, KERB_PITCH_MAX);
    for (const run of RUNS) {
      const start = Math.max(-REACH, cellCenter(run[0]!) - LOT_EDGE) + KERB_END_CLEAR;
      const end = Math.min(REACH, cellCenter(run.at(-1)!) + LOT_EDGE) - KERB_END_CLEAR;
      const count = Math.floor((end - start) / pitch) + 1;
      const first = (start + end - (count - 1) * pitch) / 2;
      for (const side of [-1, 1]) {
        const across = cellCenter(road) + side * (LOT_EDGE - KERB_WIDTH + KERB_ROW);
        for (let n = 0; n < count; n++) {
          const along = first + n * pitch;
          const lot = vertical
            ? lotAt(road + side, cellOf(along))
            : lotAt(cellOf(along), road + side);
          if (!lot || lot.kind === "park" || lot.kind === "site") continue;
          const p = vertical ? { x: across, z: along } : { x: along, z: across };
          if (entrances.some((e) => Math.hypot(e.x - p.x, e.z - p.z) < ENTRANCE_CLEAR)) continue;
          const id = pattern[n % pattern.length]!;
          const rotation = NATURAL.has(id)
            ? rng() * FULL_TURN
            : vertical
              ? faceX(-side)
              : faceZ(-side);
          place(p, id, rotation);
        }
      }
    }
  });

  const commercial = lots.filter((lot) => lot.zone === COMMERCIAL && lot.building);
  for (let n = 0; n < CAFE_COUNT && commercial.length > 0; n++) {
    const lot = commercial.splice(Math.floor(rng() * commercial.length), 1)[0]!;
    const { frontsX, fx, fz } = lot.building!;
    const side: Side = frontsX ? "x" : "z";
    const facade = side === "x" ? fz : fx;
    const end = PAVEMENT_BAND + facade - CAFE_END;
    let k = n;
    let t = PAVEMENT_BAND + CAFE_END;
    while (t <= end) {
      const id = CAFE_PARASOLS[k % CAFE_PARASOLS.length]!;
      if (place(sidePoint(lot, side, CAFE_DEPTH, t), id, sideFacing(lot, side), CAFE_GAP)) {
        k++;
        t += CAFE_PITCH;
      } else {
        t += CAFE_SCAN;
      }
    }
  }

  const yardOffset = Math.floor(rng() * YARD_ITEMS.length);
  lots
    .filter((lot) => lot.zone === INDUSTRIAL && lot.building)
    .forEach((lot, index) => {
      const { fx, fz } = lot.building!;
      const wideU = lot.depthU - fx >= lot.depthV - fz;
      const side: Side = wideU ? "x" : "z";
      const depth = wideU
        ? (PAVEMENT_BAND + fx + lot.depthU) / 2
        : (PAVEMENT_BAND + fz + lot.depthV) / 2;
      const length = sideLength(lot, side);
      const facing = sideFacing(lot, side);
      for (let k = 0; k < YARD_ITEM_COUNT; k++) {
        const id = YARD_ITEMS[(yardOffset + index + k) % YARD_ITEMS.length]!;
        for (let t = length - YARD_END; t >= PAVEMENT_BAND + YARD_END; t -= YARD_SCAN) {
          if (place(sidePoint(lot, side, depth, t), id, facing)) break;
        }
      }
    });

  const propSpawns: Vec3[] = [];
  const spawnObstacles: Obstacle[] = [];
  const streetCells: Point[] = [];
  for (let i = 0; i < G; i++) {
    for (let j = 0; j < G; j++) {
      if (isRoad(i) || isRoad(j)) streetCells.push({ x: cellCenter(i), z: cellCenter(j) });
    }
  }
  for (let pass = 0; pass < 3 && propSpawns.length < PROP_SPAWN_TARGET; pass++) {
    for (const c of streetCells) {
      if (propSpawns.length >= PROP_SPAWN_TARGET) break;
      const x = c.x + randRange(rng, -2, 2);
      const z = c.z + randRange(rng, -2, 2);
      if (nearCenter(x, z, PLAZA_CLEAR)) continue;
      if (!clearOfBuildings({ x, z }, 1.2)) continue;
      if (!clearOf(x, z, 1.2, placed, 0.3)) continue;
      if (!clearOf(x, z, 1.2, spawnObstacles, 5)) continue;
      propSpawns.push({ x, y: 0, z });
      spawnObstacles.push({ x, z, r: 1.2 });
    }
  }

  return {
    id: "urban",
    bounds: {
      min: { x: -BOUND, y: 0, z: -BOUND },
      max: { x: BOUND, y: 40, z: BOUND },
    },
    spawnPoints: { props: propSpawns },
    colliders,
    tiles,
    scenery,
    props,
    propCatalog: URBAN_CATALOG,
  };
}
