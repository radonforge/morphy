import {
  type BoxCollider,
  computePropBounds,
  type MapDefinition,
  type PropInstance,
  type SceneryInstance,
  type TileInstance,
  type Vec3,
} from "@webhunt/shared";
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

const ROAD_STRAIGHT = "/models/urban/roads/road-straight.glb";
const ROAD_CROSS = "/models/urban/roads/road-crossroad.glb";
const ROAD_SCALE = CELL;

interface BModel {
  id: string;
  nx: number;
  nz: number;
  ny: number;
}

const RESIDENTIAL: { kit: string; models: BModel[] } = {
  kit: "urban",
  models: [
    { id: "building-type-b", nx: 1.83, nz: 1.14, ny: 1.14 },
    { id: "building-type-d", nx: 1.76, nz: 1.03, ny: 1.24 },
    { id: "building-type-f", nx: 1.43, nz: 1.41, ny: 1.14 },
    { id: "building-type-n", nx: 1.78, nz: 1.38, ny: 1.14 },
    { id: "building-type-t", nx: 1.31, nz: 1.41, ny: 1.16 },
    { id: "building-type-a", nx: 1.3, nz: 1.03, ny: 0.83 },
  ],
};
const COMMERCIAL: { kit: string; models: BModel[] } = {
  kit: "urban/commercial",
  models: [
    { id: "building-i", nx: 1.24, nz: 1.3, ny: 1.68 },
    { id: "building-j", nx: 2.08, nz: 1.34, ny: 1.69 },
    { id: "building-n", nx: 2.32, nz: 1.82, ny: 2.48 },
    { id: "building-l", nx: 1.37, nz: 1.4, ny: 2.27 },
    { id: "building-skyscraper-a", nx: 1.36, nz: 1.36, ny: 2.88 },
    { id: "building-skyscraper-c", nx: 1.28, nz: 1.39, ny: 4.08 },
  ],
};
const INDUSTRIAL: { kit: string; models: BModel[] } = {
  kit: "urban/industrial",
  models: [
    { id: "building-a", nx: 2.08, nz: 1.24, ny: 1.47 },
    { id: "building-c", nx: 1.88, nz: 2.11, ny: 1.25 },
    { id: "building-l", nx: 2.08, nz: 1.87, ny: 1.92 },
    { id: "building-r", nx: 2.48, nz: 1.27, ny: 1.39 },
    { id: "building-f", nx: 1.79, nz: 1.28, ny: 1.92 },
    { id: "building-q", nx: 2.14, nz: 1.77, ny: 0.88 },
  ],
};

const BUILD_TARGET_MIN = 8.5;
const BUILD_TARGET_MAX = 10.5;
const EMPTY_LOT_CHANCE = 0.22;
const HALF_PI = Math.PI / 2;

const PROP_PER_STREET_MIN = 1;
const PROP_PER_STREET_MAX = 3;
const LOT_PROPS = 3;
const PROP_SPAWN_TARGET = 16;
const STREET_INSET = 2.2;
const PLAZA_CLEAR = 7;
const PROP_GAP = 0.6;

const PEDESTRIANS = URBAN_CATALOG.filter((d) => d.id.startsWith("character")).map((d) => d.id);
const FURNITURE = URBAN_CATALOG.filter((d) => !d.id.startsWith("character")).map((d) => d.id);

const cellCenter = (i: number): number => -HALF + (i + 0.5) * CELL;
const isRoad = (i: number): boolean => ROADS.has(i);
const zoneOf = (j: number): { kit: string; models: BModel[] } =>
  j <= 2 ? RESIDENTIAL : j <= 5 ? COMMERCIAL : INDUSTRIAL;

interface Obstacle {
  x: number;
  z: number;
  r: number;
}

/** Distretto Nord — a zoned street grid of solid building blocks; hide among the pedestrians. */
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

  const buildingObstacles: Obstacle[] = [];
  for (let i = 0; i < G; i++) {
    for (let j = 0; j < G; j++) {
      const cx = cellCenter(i);
      const cz = cellCenter(j);
      const roadI = isRoad(i);
      const roadJ = isRoad(j);
      if (roadI || roadJ) {
        const cross = roadI && roadJ;
        tiles.push({
          model: cross ? ROAD_CROSS : ROAD_STRAIGHT,
          position: { x: cx, y: 0, z: cz },
          rotationY: cross ? 0 : roadI ? 0 : HALF_PI,
          scale: ROAD_SCALE,
        });
        continue;
      }
      if (rng() < EMPTY_LOT_CHANCE) continue;
      const zone = zoneOf(j);
      const m = pick(zone.models, rng);
      const target = randRange(rng, BUILD_TARGET_MIN, BUILD_TARGET_MAX);
      const scale = target / Math.max(m.nx, m.nz);
      const turns = Math.floor(rng() * 4);
      const rot = turns * HALF_PI;
      const fx = (turns % 2 === 0 ? m.nx : m.nz) * scale;
      const fz = (turns % 2 === 0 ? m.nz : m.nx) * scale;
      const height = m.ny * scale;
      scenery.push({
        model: `/models/${zone.kit}/${m.id}.glb`,
        position: { x: cx, y: 0, z: cz },
        rotationY: rot,
        scale,
      });
      colliders.push({
        position: { x: cx, y: height / 2, z: cz },
        size: { x: fx, y: height, z: fz },
      });
      buildingObstacles.push({ x: cx, z: cz, r: Math.max(fx, fz) / 2 });
    }
  }

  const radii = new Map(URBAN_CATALOG.map((d) => [d.id, computePropBounds(d).radius]));
  const nearCenter = (x: number, z: number, clear: number): boolean => Math.hypot(x, z) < clear;
  const clearOf = (x: number, z: number, r: number, items: Obstacle[], gap: number): boolean =>
    items.every((o) => Math.hypot(x - o.x, z - o.z) >= r + o.r + gap);

  const props: PropInstance[] = [];
  const placed: Obstacle[] = [];
  const placeProp = (x: number, z: number, id: string): boolean => {
    const r = radii.get(id) ?? 0.5;
    if (nearCenter(x, z, PLAZA_CLEAR)) return false;
    if (!clearOf(x, z, r, buildingObstacles, 0.3)) return false;
    if (!clearOf(x, z, r, placed, PROP_GAP)) return false;
    props.push({ type: id, position: { x, y: 0, z }, rotation: rng() * Math.PI * 2 });
    placed.push({ x, z, r });
    return true;
  };

  for (let i = 0; i < G; i++) {
    for (let j = 0; j < G; j++) {
      const onStreet = isRoad(i) || isRoad(j);
      const cx = cellCenter(i);
      const cz = cellCenter(j);
      const isLot =
        !onStreet &&
        !buildingObstacles.some((b) => Math.abs(b.x - cx) < 1 && Math.abs(b.z - cz) < 1);
      if (!onStreet && !isLot) continue;
      const count = onStreet
        ? PROP_PER_STREET_MIN + Math.floor(rng() * (PROP_PER_STREET_MAX - PROP_PER_STREET_MIN + 1))
        : LOT_PROPS;
      for (let n = 0; n < count; n++) {
        const x = cx + randRange(rng, -CELL / 2 + STREET_INSET, CELL / 2 - STREET_INSET);
        const z = cz + randRange(rng, -CELL / 2 + STREET_INSET, CELL / 2 - STREET_INSET);
        const pool = onStreet ? (rng() < 0.7 ? PEDESTRIANS : FURNITURE) : FURNITURE;
        placeProp(x, z, pick(pool, rng));
      }
    }
  }

  const propSpawns: Vec3[] = [];
  const spawnObstacles: Obstacle[] = [];
  const streetCells: { x: number; z: number }[] = [];
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
      if (!clearOf(x, z, 1.2, buildingObstacles, 0.3)) continue;
      if (!clearOf(x, z, 1.2, spawnObstacles, 5)) continue;
      propSpawns.push({ x, y: 0, z });
      spawnObstacles.push({ x, z, r: 1.2 });
    }
  }

  return {
    id: "urban",
    name: "Distretto Nord",
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
