/**
 * A rectangle on the floor plane rotated by `yaw` about +Y, in the three.js sense the
 * renderer and `movement.ts` use: a local point `(lx, lz)` lands at
 * `(x + lx cos + lz sin, z - lx sin + lz cos)`.
 */
export interface Rect2 {
  x: number;
  z: number;
  yaw: number;
  halfX: number;
  halfZ: number;
}

/** Grid positions snap to, in metres, unless an operation is asked to place freely. */
export const POSITION_SNAP = 0.5;
/** Slack for comparing snapped values, so a value already on the grid never moves a step. */
export const SNAP_EPSILON = 1e-9;

/** Snap `value` to the position grid, rounding up for a positive `direction` and down otherwise. */
export function snapToward(value: number, direction: number): number {
  const steps = value / POSITION_SNAP;
  return (
    (direction > 0 ? Math.ceil(steps - SNAP_EPSILON) : Math.floor(steps + SNAP_EPSILON)) *
    POSITION_SNAP
  );
}

/** Axis-aligned extent on the floor plane. */
export interface Extent2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Whether two vertical spans share more than a boundary, so the shapes can collide at all. */
export function spansMeet(
  a: { yMin: number; yMax: number },
  b: { yMin: number; yMax: number },
): boolean {
  return a.yMin < b.yMax && b.yMin < a.yMax;
}

/** Rotate a local offset by `yaw` into world axes. */
export function rotateOffset(lx: number, lz: number, yaw: number): { x: number; z: number } {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return { x: lx * cos + lz * sin, z: -lx * sin + lz * cos };
}

/** An axis-aligned rectangle as a {@link Rect2}. */
export function rectFromExtent(extent: Extent2): Rect2 {
  return {
    x: (extent.minX + extent.maxX) / 2,
    z: (extent.minZ + extent.maxZ) / 2,
    yaw: 0,
    halfX: (extent.maxX - extent.minX) / 2,
    halfZ: (extent.maxZ - extent.minZ) / 2,
  };
}

/** The axis-aligned extent that bounds a rotated rectangle. */
export function rectExtent(rect: Rect2): Extent2 {
  const cos = Math.abs(Math.cos(rect.yaw));
  const sin = Math.abs(Math.sin(rect.yaw));
  const ex = rect.halfX * cos + rect.halfZ * sin;
  const ez = rect.halfX * sin + rect.halfZ * cos;
  return { minX: rect.x - ex, maxX: rect.x + ex, minZ: rect.z - ez, maxZ: rect.z + ez };
}

/** The four corners of a rotated rectangle. */
export function rectCorners(rect: Rect2): { x: number; z: number }[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sz]) => {
    const offset = rotateOffset(sx! * rect.halfX, sz! * rect.halfZ, rect.yaw);
    return { x: rect.x + offset.x, z: rect.z + offset.z };
  });
}

function axes(rect: Rect2): [number, number][] {
  const cos = Math.cos(rect.yaw);
  const sin = Math.sin(rect.yaw);
  return [
    [cos, -sin],
    [sin, cos],
  ];
}

function projectedHalf(rect: Rect2, nx: number, nz: number): number {
  const [u, v] = axes(rect);
  return (
    rect.halfX * Math.abs(u![0] * nx + u![1] * nz) + rect.halfZ * Math.abs(v![0] * nx + v![1] * nz)
  );
}

/** How two rectangles interpenetrate: the depth and the unit axis that would part them, from `a` towards `b`. */
export interface Penetration {
  depth: number;
  nx: number;
  nz: number;
}

/**
 * The smallest overlap of two rotated rectangles' projections over their four
 * separating axes. A depth of zero or less means they are apart.
 */
export function penetration(a: Rect2, b: Rect2): Penetration {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let best: Penetration = { depth: Infinity, nx: 1, nz: 0 };
  for (const [nx, nz] of [...axes(a), ...axes(b)]) {
    const along = dx * nx + dz * nz;
    const depth = projectedHalf(a, nx, nz) + projectedHalf(b, nx, nz) - Math.abs(along);
    if (depth < best.depth) {
      const sign = along < 0 ? -1 : 1;
      best = { depth, nx: nx * sign, nz: nz * sign };
    }
  }
  return best;
}

/** How deep two rotated rectangles interpenetrate; zero or less means they are apart. */
export function overlapDepth(a: Rect2, b: Rect2): number {
  return penetration(a, b).depth;
}

/** Whether a circle of `radius` at (`x`, `z`) intrudes into a rotated rectangle. */
export function circleHitsRect(x: number, z: number, radius: number, rect: Rect2): boolean {
  const dx = x - rect.x;
  const dz = z - rect.z;
  const cos = Math.cos(rect.yaw);
  const sin = Math.sin(rect.yaw);
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const ox = lx - Math.max(-rect.halfX, Math.min(rect.halfX, lx));
  const oz = lz - Math.max(-rect.halfZ, Math.min(rect.halfZ, lz));
  return ox * ox + oz * oz < radius * radius;
}

/** Whether a point lies inside a rotated rectangle. */
export function rectContains(rect: Rect2, x: number, z: number): boolean {
  return circleHitsRect(x, z, Number.EPSILON, rect);
}
