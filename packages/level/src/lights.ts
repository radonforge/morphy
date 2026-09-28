import type { BoxCollider, MapDefinition, Vec3 } from "@morphy/shared";

/** A point light hung over the deck, with a colour picked per source. */
export interface DeckLight {
  x: number;
  z: number;
  kind: "room" | "corridor";
}

const CLUSTER_PASSES = 8;
const WALL_CLEARANCE = 3;
const CLEARANCE_PASSES = 2;

/**
 * Where a night map hangs its few point lights: one over the middle of each of
 * `roomCount` clusters of furniture, so every furnished room gets a pool of light
 * over its props rather than against its walls, and one over every hunter spawn,
 * which the station authors along its corridor spine. The clusters are seeded by
 * farthest-point sampling from the prop nearest the map centre and settled with a
 * few k-means passes, so the pick is deterministic for a given layout. A room
 * light that settles near a wall is then pushed back to {@link WALL_CLEARANCE}:
 * furniture lines the walls, and a light hung against one burns a hotspot into it.
 */
export function pickDeckLights(map: MapDefinition, roomCount: number): DeckLight[] {
  const corridor = map.spawnPoints.hunters.map((p) => ({
    x: p.x,
    z: p.z,
    kind: "corridor" as const,
  }));
  const points = map.props.map((p) => p.position);
  if (points.length === 0 || roomCount <= 0) return corridor;
  const cx = (map.bounds.min.x + map.bounds.max.x) / 2;
  const cz = (map.bounds.min.z + map.bounds.max.z) / 2;
  let centres = farthestPoints(points, nearest(points, cx, cz), roomCount);
  for (let pass = 0; pass < CLUSTER_PASSES; pass++) centres = settle(points, centres);
  const walls = map.colliders.filter((c) => c.position.y + c.size.y / 2 > 0);
  centres = centres.map((c) => clearOfWalls(c, walls));
  return [...centres.map((c) => ({ x: c.x, z: c.z, kind: "room" as const })), ...corridor];
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
      if (d >= WALL_CLEARANCE) continue;
      const push = (WALL_CLEARANCE - d) / d;
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
    return { x: wall.position.x + Math.sign(dx || 1) * (halfX + WALL_CLEARANCE), z: p.z };
  }
  return { x: p.x, z: wall.position.z + Math.sign(dz || 1) * (halfZ + WALL_CLEARANCE) };
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
