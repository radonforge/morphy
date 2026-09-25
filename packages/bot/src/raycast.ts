import {
  type BoxCollider,
  colliderAabb,
  DEFAULT_WEAPON,
  type PropBounds,
  RAY_EPSILON,
  rayAabb,
  type Vec3,
  WEAPONS,
} from "@morphy/shared";

export type { Vec3 } from "@morphy/shared";

function wallDistance(origin: Vec3, dir: Vec3, colliders: BoxCollider[]): number {
  const range = WEAPONS[DEFAULT_WEAPON].range;
  let nearest = range;
  for (const collider of colliders) {
    if (collider.position.y <= 0) continue;
    const { min, max } = colliderAabb(collider);
    const t = rayAabb(origin, dir, min, max, range);
    if (t !== null && t < nearest) nearest = t;
  }
  return nearest;
}

function rayHitsProp(
  origin: Vec3,
  dir: Vec3,
  cx: number,
  cy: number,
  cz: number,
  bounds: PropBounds,
): number | null {
  return rayAabb(
    origin,
    dir,
    { x: cx - bounds.radius, y: cy + bounds.yMin, z: cz - bounds.radius },
    { x: cx + bounds.radius, y: cy + bounds.yMax, z: cz + bounds.radius },
    WEAPONS[DEFAULT_WEAPON].range,
  );
}

/** A sphere that blocks sight and nothing else: a confetti cloud. */
export interface SightOccluder {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/** Whether the segment from `origin` along unit `dir` for `dist` passes through the sphere. */
function segmentMeetsSphere(origin: Vec3, dir: Vec3, dist: number, sphere: SightOccluder): boolean {
  const cx = sphere.x - origin.x;
  const cy = sphere.y - origin.y;
  const cz = sphere.z - origin.z;
  const along = Math.min(dist, Math.max(0, cx * dir.x + cy * dir.y + cz * dir.z));
  const nx = cx - dir.x * along;
  const ny = cy - dir.y * along;
  const nz = cz - dir.z * along;
  return nx * nx + ny * ny + nz * nz <= sphere.radius * sphere.radius;
}

export function normalize3(v: Vec3): Vec3 | null {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len === 0) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Whether the straight segment from `origin` to `target` reaches it without a
 * wall in between: the bot's line-of-sight test for {@link buildObservation}.
 * Uses the same wall colliders and slab test as shot resolution, so "I can see
 * it" and "I could hit it" share one geometry. `occluders` block sight only,
 * so a target behind one can still be hit, just not seen.
 */
export function lineOfSightClear(
  origin: Vec3,
  target: Vec3,
  colliders: BoxCollider[],
  occluders: readonly SightOccluder[] = [],
): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < RAY_EPSILON) return true;
  const dir: Vec3 = { x: dx / dist, y: dy / dist, z: dz / dist };
  for (const sphere of occluders) {
    if (segmentMeetsSphere(origin, dir, dist, sphere)) return false;
  }
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
  cy: number,
  cz: number,
  bounds: PropBounds,
  colliders: BoxCollider[],
): boolean {
  const t = rayHitsProp(origin, dir, cx, cy, cz, bounds);
  if (t === null) return false;
  return t < wallDistance(origin, dir, colliders);
}
