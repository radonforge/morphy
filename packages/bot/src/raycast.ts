import { type BoxCollider, type PropBounds, SHOOT_RANGE } from "@webhunt/shared";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

type Triple = [number, number, number];

const SLAB_EPSILON = 1e-6;

/** Distance along the ray to an axis-aligned box (slab method), or null if it misses or lies beyond `maxDist`. Mirrors the server's `rayAabb`. */
function rayAabb(
  origin: Vec3,
  dir: Vec3,
  min: Triple,
  max: Triple,
  maxDist: number,
): number | null {
  const o: Triple = [origin.x, origin.y, origin.z];
  const d: Triple = [dir.x, dir.y, dir.z];
  let tEnter = 0;
  let tExit = maxDist;
  for (let axis = 0; axis < 3; axis++) {
    const da = d[axis] ?? 0;
    const oa = o[axis] ?? 0;
    const lo = min[axis] ?? 0;
    const hi = max[axis] ?? 0;
    if (Math.abs(da) < SLAB_EPSILON) {
      if (oa < lo || oa > hi) return null;
      continue;
    }
    let t1 = (lo - oa) / da;
    let t2 = (hi - oa) / da;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tEnter) tEnter = t1;
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return null;
  }
  return tEnter;
}

function colliderAabb(c: BoxCollider): { min: Triple; max: Triple } {
  return {
    min: [c.position.x - c.size.x / 2, c.position.y - c.size.y / 2, c.position.z - c.size.z / 2],
    max: [c.position.x + c.size.x / 2, c.position.y + c.size.y / 2, c.position.z + c.size.z / 2],
  };
}

function wallDistance(origin: Vec3, dir: Vec3, colliders: BoxCollider[]): number {
  let nearest = SHOOT_RANGE;
  for (const collider of colliders) {
    if (collider.position.y <= 0) continue;
    const { min, max } = colliderAabb(collider);
    const t = rayAabb(origin, dir, min, max, SHOOT_RANGE);
    if (t !== null && t < nearest) nearest = t;
  }
  return nearest;
}

function rayHitsProp(
  origin: Vec3,
  dir: Vec3,
  cx: number,
  cz: number,
  bounds: PropBounds,
): number | null {
  return rayAabb(
    origin,
    dir,
    [cx - bounds.radius, bounds.yMin, cz - bounds.radius],
    [cx + bounds.radius, bounds.yMax, cz + bounds.radius],
    SHOOT_RANGE,
  );
}

export function normalize3(v: Vec3): Vec3 | null {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len === 0) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Whether the straight segment from `origin` to `target` reaches it without a
 * wall in between — the bot's line-of-sight test for {@link buildObservation}.
 * Uses the same wall colliders and slab test as shot resolution, so "I can see
 * it" and "I could hit it" share one geometry.
 */
export function lineOfSightClear(origin: Vec3, target: Vec3, colliders: BoxCollider[]): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < SLAB_EPSILON) return true;
  const dir: Vec3 = { x: dx / dist, y: dy / dist, z: dz / dist };
  for (const collider of colliders) {
    if (collider.position.y <= 0) continue;
    const { min, max } = colliderAabb(collider);
    const t = rayAabb(origin, dir, min, max, dist);
    if (t !== null && t < dist) return false;
  }
  return true;
}

/**
 * Replicates the server's hit resolution for a single intended target: the shot
 * lands on a prop only if the target's hit box is reached before any wall. A
 * closer prop on the same ray would also convert, so this is sufficient to know
 * the shot will not be wasted (and cost the hunter HP).
 */
export function canHitTarget(
  origin: Vec3,
  dir: Vec3,
  cx: number,
  cz: number,
  bounds: PropBounds,
  colliders: BoxCollider[],
): boolean {
  const t = rayHitsProp(origin, dir, cx, cz, bounds);
  if (t === null) return false;
  return t < wallDistance(origin, dir, colliders);
}
