import type { BoxCollider, Vec3 } from "./map";

export const RAY_EPSILON = 1e-6;

/** Distance along a ray to an axis-aligned box, or `null` when it does not intersect. */
export function rayAabb(
  origin: Vec3,
  dir: Vec3,
  min: Vec3,
  max: Vec3,
  maxDist: number,
): number | null {
  const origins = [origin.x, origin.y, origin.z];
  const directions = [dir.x, dir.y, dir.z];
  const minima = [min.x, min.y, min.z];
  const maxima = [max.x, max.y, max.z];
  let tEnter = 0;
  let tExit = maxDist;
  for (let axis = 0; axis < 3; axis++) {
    const direction = directions[axis] ?? 0;
    const start = origins[axis] ?? 0;
    const low = minima[axis] ?? 0;
    const high = maxima[axis] ?? 0;
    if (Math.abs(direction) < RAY_EPSILON) {
      if (start < low || start > high) return null;
      continue;
    }
    let t1 = (low - start) / direction;
    let t2 = (high - start) / direction;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tEnter) tEnter = t1;
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return null;
  }
  return tEnter;
}

export function colliderAabb(collider: BoxCollider): { min: Vec3; max: Vec3 } {
  return {
    min: {
      x: collider.position.x - collider.size.x / 2,
      y: collider.position.y - collider.size.y / 2,
      z: collider.position.z - collider.size.z / 2,
    },
    max: {
      x: collider.position.x + collider.size.x / 2,
      y: collider.position.y + collider.size.y / 2,
      z: collider.position.z + collider.size.z / 2,
    },
  };
}
