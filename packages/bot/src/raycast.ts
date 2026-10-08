import {
  type BoxCollider,
  colliderAabb,
  DEFAULT_WEAPON,
  type PropBounds,
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

export function normalize3(v: Vec3): Vec3 | null {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len === 0) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
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
