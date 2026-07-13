import type { MapBounds } from "@morphy/shared";
import type { Obstacle, Wall } from "../collision";
import { BOT_BODY_RADIUS, NAV_CELL_SIZE, NAV_INFLATION_EPS } from "../config";

/**
 * A uniform occupancy grid over the map interior. A cell is blocked when its
 * inflated centre would clip a wall or furniture circle, so the same geometry
 * the physics resolves against (the `Wall[]`/`Obstacle[]` from
 * {@link buildWalls}/{@link buildObstacles}) drives navigability — no second
 * source of truth that could drift and re-introduce wall snags.
 */
export interface NavGrid {
  originX: number;
  originZ: number;
  cellSize: number;
  cols: number;
  rows: number;
  blocked: Uint8Array;
}

export interface Cell {
  i: number;
  j: number;
}

export interface Point2 {
  x: number;
  z: number;
}

function distToWallSq(cx: number, cz: number, wall: Wall): number {
  const nx = Math.min(Math.max(cx, wall.minX), wall.maxX);
  const nz = Math.min(Math.max(cz, wall.minZ), wall.maxZ);
  const dx = cx - nx;
  const dz = cz - nz;
  return dx * dx + dz * dz;
}

/**
 * Build the occupancy grid for the interior {@link MapBounds}. Walls are
 * inflated by `BOT_BODY_RADIUS + ε`; furniture by `BOT_BODY_RADIUS + radius` —
 * matching {@link resolveCollisions} so a path the grid calls clear is one the
 * physics will let the body traverse. A 4-unit doorway leaves ~3 passable cells
 * at {@link NAV_CELL_SIZE} 1.0 after inflation.
 */
export function buildNavGrid(bounds: MapBounds, walls: Wall[], obstacles: Obstacle[]): NavGrid {
  const cellSize = NAV_CELL_SIZE;
  const originX = bounds.min.x;
  const originZ = bounds.min.z;
  const cols = Math.max(1, Math.ceil((bounds.max.x - bounds.min.x) / cellSize));
  const rows = Math.max(1, Math.ceil((bounds.max.z - bounds.min.z) / cellSize));
  const blocked = new Uint8Array(cols * rows);
  const wallReach = BOT_BODY_RADIUS + NAV_INFLATION_EPS;
  const wallReachSq = wallReach * wallReach;

  for (let j = 0; j < rows; j++) {
    const cz = originZ + (j + 0.5) * cellSize;
    for (let i = 0; i < cols; i++) {
      const cx = originX + (i + 0.5) * cellSize;
      let isBlocked = false;
      for (const wall of walls) {
        if (distToWallSq(cx, cz, wall) < wallReachSq) {
          isBlocked = true;
          break;
        }
      }
      if (!isBlocked) {
        for (const obstacle of obstacles) {
          const dx = cx - obstacle.x;
          const dz = cz - obstacle.z;
          const reach = BOT_BODY_RADIUS + obstacle.radius;
          if (dx * dx + dz * dz < reach * reach) {
            isBlocked = true;
            break;
          }
        }
      }
      if (isBlocked) blocked[j * cols + i] = 1;
    }
  }

  return { originX, originZ, cellSize, cols, rows, blocked };
}

export function inGrid(grid: NavGrid, i: number, j: number): boolean {
  return i >= 0 && i < grid.cols && j >= 0 && j < grid.rows;
}

/** Out-of-range cells read as blocked so pathing never leaves the interior. */
export function isBlocked(grid: NavGrid, i: number, j: number): boolean {
  if (!inGrid(grid, i, j)) return true;
  return grid.blocked[j * grid.cols + i] === 1;
}

export function cellCenter(grid: NavGrid, cell: Cell): Point2 {
  return {
    x: grid.originX + (cell.i + 0.5) * grid.cellSize,
    z: grid.originZ + (cell.j + 0.5) * grid.cellSize,
  };
}

export function worldToCell(grid: NavGrid, x: number, z: number): Cell {
  const i = Math.min(grid.cols - 1, Math.max(0, Math.floor((x - grid.originX) / grid.cellSize)));
  const j = Math.min(grid.rows - 1, Math.max(0, Math.floor((z - grid.originZ) / grid.cellSize)));
  return { i, j };
}

/**
 * The free cell nearest `cell` by Chebyshev rings, or `null` if none lies within
 * `maxRadius` rings. Lets pathing recover when the body is pushed into a cell
 * the inflation marks blocked, or when a target stands flush against furniture.
 */
export function nearestFreeCell(grid: NavGrid, cell: Cell, maxRadius: number): Cell | null {
  if (!isBlocked(grid, cell.i, cell.j)) return cell;
  for (let r = 1; r <= maxRadius; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = cell.i + di;
        const j = cell.j + dj;
        if (!isBlocked(grid, i, j)) return { i, j };
      }
    }
  }
  return null;
}
