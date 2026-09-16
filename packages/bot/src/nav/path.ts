import { ARRIVE_EPSILON } from "../config";
import { type Cell, cellCenter, isBlocked, type NavGrid, type Point2 } from "./grid";

function initialTMax(pos: number, step: number, delta: number): number {
  if (step === 0) return Infinity;
  const frac = pos - Math.floor(pos);
  return step > 0 ? (1 - frac) * delta : frac * delta;
}

/**
 * True when no blocked cell lies on the segment between two world points, using
 * an Amanatides–Woo grid traversal that visits every cell the segment enters
 * (no sampling gaps). This is the line-of-sight test the string-pull relies on
 * to drop interior waypoints without cutting through a wall.
 */
export function hasLineOfSight(
  grid: NavGrid,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  const cs = grid.cellSize;
  const x0 = (ax - grid.originX) / cs;
  const z0 = (az - grid.originZ) / cs;
  const x1 = (bx - grid.originX) / cs;
  const z1 = (bz - grid.originZ) / cs;
  const dx = x1 - x0;
  const dz = z1 - z0;

  let i = Math.floor(x0);
  let j = Math.floor(z0);
  const iEnd = Math.floor(x1);
  const jEnd = Math.floor(z1);
  if (isBlocked(grid, i, j)) return false;

  const stepI = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepJ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = initialTMax(x0, stepI, tDeltaX);
  let tMaxZ = initialTMax(z0, stepJ, tDeltaZ);

  const TIE_EPS = 1e-9;
  const guard = grid.cols + grid.rows + 2;
  for (let steps = 0; steps < guard; steps++) {
    if (i === iEnd && j === jEnd) return true;
    if (Math.abs(tMaxX - tMaxZ) < TIE_EPS) {
      // The segment passes through a grid corner: both diagonal-adjacent cells
      // must be free, matching A*'s no-corner-cut rule, before stepping through.
      if (isBlocked(grid, i + stepI, j) || isBlocked(grid, i, j + stepJ)) return false;
      tMaxX += tDeltaX;
      tMaxZ += tDeltaZ;
      i += stepI;
      j += stepJ;
    } else if (tMaxX < tMaxZ) {
      tMaxX += tDeltaX;
      i += stepI;
    } else {
      tMaxZ += tDeltaZ;
      j += stepJ;
    }
    if (isBlocked(grid, i, j)) return false;
  }
  return true;
}

/**
 * Reduce an A* cell path to a short list of world waypoints by string-pulling:
 * keep a corner only where the straight line from the last kept waypoint loses
 * sight of the next cell. Yields few real-world corners that feed the steering.
 */
export function smoothPath(grid: NavGrid, cells: Cell[]): Point2[] {
  if (cells.length === 0) return [];
  const pts = cells.map((c) => cellCenter(grid, c));
  if (pts.length <= 2) return pts;

  const out: Point2[] = [pts[0]!];
  let anchor = 0;
  for (let k = 2; k < pts.length; k++) {
    const a = pts[anchor]!;
    const probe = pts[k]!;
    if (!hasLineOfSight(grid, a.x, a.z, probe.x, probe.z)) {
      out.push(pts[k - 1]!);
      anchor = k - 1;
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/**
 * Walks the bot along smoothed waypoints, retiring each as the body arrives
 * within {@link ARRIVE_EPSILON}. Returns the current steering target, or `null`
 * once the final waypoint is reached.
 */
export class PathFollower {
  private waypoints: Point2[] = [];
  private index = 0;

  setPath(points: Point2[]): void {
    this.waypoints = points;
    this.index = 0;
  }

  clear(): void {
    this.waypoints = [];
    this.index = 0;
  }

  get hasPath(): boolean {
    return this.index < this.waypoints.length;
  }

  /**
   * True once every waypoint of a planned path has been retired. Distinct from
   * `!hasPath`, which is also true when planning failed and left no path at
   * all — the caller must not read a failure as an arrival.
   */
  get consumed(): boolean {
    return this.waypoints.length > 0 && this.index >= this.waypoints.length;
  }

  get goal(): Point2 | null {
    return this.waypoints.length > 0 ? this.waypoints[this.waypoints.length - 1]! : null;
  }

  advance(x: number, z: number): Point2 | null {
    while (this.index < this.waypoints.length) {
      const wp = this.waypoints[this.index]!;
      if (Math.hypot(wp.x - x, wp.z - z) <= ARRIVE_EPSILON) {
        this.index++;
        continue;
      }
      return wp;
    }
    return null;
  }
}
