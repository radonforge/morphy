import type { BoxCollider, MapDefinition, MapLight, Vec3 } from "@morphy/shared";
import { POSITION_SNAP, type Rect2, snapToward } from "./geometry";

/** Ids run `light-1..n`, never `room-<n>`, which a painted room may already be called. */
export const LIGHT_ID_PREFIX = "light-";
const CLUSTER_PASSES = 8;
const CLEARANCE_PASSES = 2;

/** How far from a wall a room light hangs, so it lights the furniture instead of burning a hotspot into the wall. */
export const DECK_LIGHT_WALL_CLEARANCE = 3;
/** How many room lights a night map hangs unless its theme asks for another number. */
export const DEFAULT_ROOM_LIGHT_COUNT = 14;
/** How high a night deck's lights hang, in the match; the lobby's station stage scales it with its set. */
export const DECK_LIGHT_HEIGHT = 3;
/** How much closer than {@link DECK_LIGHT_WALL_CLEARANCE} a room light may sit before it is reported: the picker's two passes settle a touch short. */
export const DECK_LIGHT_CLEARANCE_SLACK = 0.1;

/**
 * Where a night map hangs its few point lights: one over the middle of each of
 * `roomCount` clusters of furniture, so every furnished room gets a pool of light
 * over its props rather than against its walls, and one over every hunter spawn,
 * which the station authors along its corridor spine. The clusters are seeded by
 * farthest-point sampling from the prop nearest the map centre and settled with a
 * few k-means passes, so the pick is deterministic for a given layout. A room
 * light that settles near a wall is then pushed back to {@link DECK_LIGHT_WALL_CLEARANCE}:
 * furniture lines the walls, and a light hung against one burns a hotspot into it.
 * Ids run `light-1..n` in that order, so the same layout proposes the same document.
 */
export function pickDeckLights(map: MapDefinition, roomCount: number): MapLight[] {
  const corridor = map.spawnPoints.hunters.map((p) => ({
    x: p.x,
    z: p.z,
    kind: "corridor" as const,
  }));
  const points = map.props.map((p) => p.position);
  if (points.length === 0 || roomCount <= 0) return numbered(corridor);
  const cx = (map.bounds.min.x + map.bounds.max.x) / 2;
  const cz = (map.bounds.min.z + map.bounds.max.z) / 2;
  let centres = farthestPoints(points, nearest(points, cx, cz), roomCount);
  for (let pass = 0; pass < CLUSTER_PASSES; pass++) centres = settle(points, centres);
  const walls = map.colliders.filter((c) => c.position.y + c.size.y / 2 > 0);
  centres = centres.map((c) => clearOfWalls(c, walls));
  return numbered([
    ...centres.map((c) => ({ x: c.x, z: c.z, kind: "room" as const })),
    ...corridor,
  ]);
}

/** How a spot stands to the walls: the distance to the nearest one and, when a snapped spot clears every wall, where to hang the light instead. */
export interface WallClearance {
  distance: number;
  target: Point2 | null;
}

interface NearestFace {
  distance: number;
  face: Point2;
  away: Point2;
}

function nearestFace(walls: readonly Rect2[], p: Point2): NearestFace | null {
  let best: NearestFace | null = null;
  for (const wall of walls) {
    const face = {
      x: clamp(p.x, wall.x - wall.halfX, wall.x + wall.halfX),
      z: clamp(p.z, wall.z - wall.halfZ, wall.z + wall.halfZ),
    };
    const distance = Math.hypot(p.x - face.x, p.z - face.z);
    if (best !== null && distance >= best.distance) continue;
    if (distance > 0) {
      best = {
        distance,
        face,
        away: { x: (p.x - face.x) / distance, z: (p.z - face.z) / distance },
      };
      continue;
    }
    const dx = p.x - wall.x;
    const dz = p.z - wall.z;
    best =
      wall.halfX - Math.abs(dx) <= wall.halfZ - Math.abs(dz)
        ? {
            distance,
            face: { x: wall.x + Math.sign(dx || 1) * wall.halfX, z: p.z },
            away: { x: Math.sign(dx || 1), z: 0 },
          }
        : {
            distance,
            face: { x: p.x, z: wall.z + Math.sign(dz || 1) * wall.halfZ },
            away: { x: 0, z: Math.sign(dz || 1) },
          };
  }
  return best;
}

function snapAway(value: number, direction: number): number {
  return direction === 0
    ? Math.round(value / POSITION_SNAP) * POSITION_SNAP
    : snapToward(value, direction);
}

function distanceToWalls(walls: readonly Rect2[], p: Point2): number {
  return nearestFace(walls, p)?.distance ?? Infinity;
}

/**
 * How far a spot is from the nearest wall and, when it is nearer than
 * {@link DECK_LIGHT_WALL_CLEARANCE}, a spot to move the light to: straight away from the
 * wall face it is closest to (for a spot on or in a wall, out through the nearer face
 * of that wall), snapped outward to the position grid. The target is null unless it stays
 * inside the map and clear of every wall, not only the one it was pushed from.
 */
export function wallClearance(
  walls: readonly Rect2[],
  bounds: { halfW: number; halfD: number },
  light: Point2,
): WallClearance {
  const nearest = nearestFace(walls, light);
  if (nearest === null) return { distance: Infinity, target: null };
  const target = {
    x: snapAway(nearest.face.x + nearest.away.x * DECK_LIGHT_WALL_CLEARANCE, nearest.away.x),
    z: snapAway(nearest.face.z + nearest.away.z * DECK_LIGHT_WALL_CLEARANCE, nearest.away.z),
  };
  const inside = Math.abs(target.x) <= bounds.halfW && Math.abs(target.z) <= bounds.halfD;
  const clear =
    distanceToWalls(walls, target) >= DECK_LIGHT_WALL_CLEARANCE - DECK_LIGHT_CLEARANCE_SLACK;
  return { distance: nearest.distance, target: inside && clear ? target : null };
}

/** The lights a map hangs: its own authored `lights` when it has any, else {@link pickDeckLights} from its layout. */
export function deckLightsFor(map: MapDefinition, roomCount: number): MapLight[] {
  return map.lights ?? pickDeckLights(map, roomCount);
}

function numbered(lights: readonly Omit<MapLight, "id">[]): MapLight[] {
  return lights.map((light, index) => ({ id: `${LIGHT_ID_PREFIX}${index + 1}`, ...light }));
}

interface Point2 {
  x: number;
  z: number;
}

function farthestPoints(points: readonly Vec3[], first: Vec3, count: number): Point2[] {
  const picked: Point2[] = [first];
  const gap = points.map((p) => Math.hypot(p.x - first.x, p.z - first.z));
  while (picked.length < Math.min(count, points.length)) {
    let best = 0;
    for (let i = 1; i < gap.length; i++) if (gap[i]! > gap[best]!) best = i;
    const next = points[best]!;
    picked.push(next);
    for (let i = 0; i < gap.length; i++) {
      gap[i] = Math.min(gap[i]!, Math.hypot(points[i]!.x - next.x, points[i]!.z - next.z));
    }
  }
  return picked.map((p) => ({ x: p.x, z: p.z }));
}

function settle(points: readonly Vec3[], centres: readonly Point2[]): Point2[] {
  const sums = centres.map(() => ({ x: 0, z: 0, n: 0 }));
  for (const p of points) {
    let best = 0;
    for (let i = 1; i < centres.length; i++) {
      const d = Math.hypot(p.x - centres[i]!.x, p.z - centres[i]!.z);
      if (d < Math.hypot(p.x - centres[best]!.x, p.z - centres[best]!.z)) best = i;
    }
    const sum = sums[best]!;
    sum.x += p.x;
    sum.z += p.z;
    sum.n += 1;
  }
  return centres.map((c, i) => {
    const sum = sums[i]!;
    return sum.n === 0 ? c : { x: sum.x / sum.n, z: sum.z / sum.n };
  });
}

function clearOfWalls(start: Point2, walls: readonly BoxCollider[]): Point2 {
  let p = start;
  for (let pass = 0; pass < CLEARANCE_PASSES; pass++) {
    for (const wall of walls) {
      const nx = clamp(p.x, wall.position.x - wall.size.x / 2, wall.position.x + wall.size.x / 2);
      const nz = clamp(p.z, wall.position.z - wall.size.z / 2, wall.position.z + wall.size.z / 2);
      const d = Math.hypot(p.x - nx, p.z - nz);
      if (d === 0) {
        p = outOfWall(p, wall);
        continue;
      }
      if (d >= DECK_LIGHT_WALL_CLEARANCE) continue;
      const push = (DECK_LIGHT_WALL_CLEARANCE - d) / d;
      p = { x: p.x + (p.x - nx) * push, z: p.z + (p.z - nz) * push };
    }
  }
  return p;
}

function outOfWall(p: Point2, wall: BoxCollider): Point2 {
  const halfX = wall.size.x / 2;
  const halfZ = wall.size.z / 2;
  const dx = p.x - wall.position.x;
  const dz = p.z - wall.position.z;
  if (halfX - Math.abs(dx) < halfZ - Math.abs(dz)) {
    return {
      x: wall.position.x + Math.sign(dx || 1) * (halfX + DECK_LIGHT_WALL_CLEARANCE),
      z: p.z,
    };
  }
  return { x: p.x, z: wall.position.z + Math.sign(dz || 1) * (halfZ + DECK_LIGHT_WALL_CLEARANCE) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nearest(points: readonly Vec3[], x: number, z: number): Vec3 {
  let best = points[0]!;
  for (const p of points) {
    if (Math.hypot(p.x - x, p.z - z) < Math.hypot(best.x - x, best.z - z)) best = p;
  }
  return best;
}
