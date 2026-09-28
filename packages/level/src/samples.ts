import { LEVEL_BODY_RADIUS, LEVEL_SAMPLE_CELL, LEVEL_SIGHT_BLOCK_HEIGHT } from "@morphy/shared";
import type { LevelPoint } from "./document";
import { circleHitsRect, overlapDepth, type Rect2, rectExtent } from "./geometry";
import type { LevelSpace } from "./space";

const SIGHT_DIRECTIONS = 16;
const SIGHT_STEP = LEVEL_SAMPLE_CELL / 2;
const SIGHT_ORIGIN_STRIDE = 2;
const NEIGHBOURS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * The map sampled on a {@link LEVEL_SAMPLE_CELL} grid: where a player's body fits, and
 * where a wall or an object tall enough to hide a crouching prop stops a line of sight.
 */
export interface SampleGrid {
  halfW: number;
  halfD: number;
  nx: number;
  nz: number;
  walkable: Uint8Array;
  sightBlocked: Uint8Array;
  /** Object ids whose collision boxes keep a body off each sample, for naming what encloses a pocket. */
  blockers: Map<number, Set<string>>;
  centre(index: number): LevelPoint;
  indexAt(x: number, z: number): number;
}

/** The edge-adjacent samples of `index` that lie on the grid. */
export function neighbours(grid: SampleGrid, index: number): number[] {
  const a = Math.floor(index / grid.nz);
  const b = index % grid.nz;
  const out: number[] = [];
  for (const [da, db] of NEIGHBOURS) {
    const na = a + da;
    const nb = b + db;
    if (na >= 0 && na < grid.nx && nb >= 0 && nb < grid.nz) out.push(na * grid.nz + nb);
  }
  return out;
}

/** A straight clear line inside the map, from where it starts to where it is stopped. */
export interface Sightline {
  from: LevelPoint;
  to: LevelPoint;
  length: number;
}

function forSamplesUnder(
  grid: SampleGrid,
  rect: Rect2,
  margin: number,
  visit: (index: number, point: LevelPoint) => void,
): void {
  const { halfW, halfD } = grid;
  const extent = rectExtent(rect);
  const a0 = Math.max(0, Math.floor((extent.minX - margin + halfW) / LEVEL_SAMPLE_CELL));
  const a1 = Math.min(grid.nx - 1, Math.floor((extent.maxX + margin + halfW) / LEVEL_SAMPLE_CELL));
  const b0 = Math.max(0, Math.floor((extent.minZ - margin + halfD) / LEVEL_SAMPLE_CELL));
  const b1 = Math.min(grid.nz - 1, Math.floor((extent.maxZ + margin + halfD) / LEVEL_SAMPLE_CELL));
  for (let a = a0; a <= a1; a++) {
    for (let b = b0; b <= b1; b++) {
      const index = a * grid.nz + b;
      visit(index, grid.centre(index));
    }
  }
}

/** Sample a laid-out document for reachability and sight. */
export function sampleSpace(space: LevelSpace): SampleGrid {
  const { halfW, halfD } = space;
  const nx = Math.round((2 * halfW) / LEVEL_SAMPLE_CELL);
  const nz = Math.round((2 * halfD) / LEVEL_SAMPLE_CELL);
  const grid: SampleGrid = {
    halfW,
    halfD,
    nx,
    nz,
    walkable: new Uint8Array(nx * nz).fill(1),
    sightBlocked: new Uint8Array(nx * nz),
    blockers: new Map(),
    centre: (index) => ({
      x: -halfW + (Math.floor(index / nz) + 0.5) * LEVEL_SAMPLE_CELL,
      z: -halfD + ((index % nz) + 0.5) * LEVEL_SAMPLE_CELL,
    }),
    indexAt: (x, z) => {
      const a = Math.floor((x + halfW) / LEVEL_SAMPLE_CELL);
      const b = Math.floor((z + halfD) / LEVEL_SAMPLE_CELL);
      return a < 0 || a >= nx || b < 0 || b >= nz ? -1 : a * nz + b;
    },
  };

  for (let index = 0; index < nx * nz; index++) {
    const { x, z } = grid.centre(index);
    if (
      x - LEVEL_BODY_RADIUS < -halfW ||
      x + LEVEL_BODY_RADIUS > halfW ||
      z - LEVEL_BODY_RADIUS < -halfD ||
      z + LEVEL_BODY_RADIUS > halfD
    ) {
      grid.walkable[index] = 0;
    }
  }

  const cell = (index: number): Rect2 => {
    const { x, z } = grid.centre(index);
    return { x, z, yaw: 0, halfX: LEVEL_SAMPLE_CELL / 2, halfZ: LEVEL_SAMPLE_CELL / 2 };
  };
  const block = (rect: Rect2, owner: string | null, sight: boolean): void =>
    forSamplesUnder(grid, rect, LEVEL_BODY_RADIUS, (index, { x, z }) => {
      if (circleHitsRect(x, z, LEVEL_BODY_RADIUS, rect)) {
        grid.walkable[index] = 0;
        if (owner !== null) {
          const set = grid.blockers.get(index) ?? new Set<string>();
          set.add(owner);
          grid.blockers.set(index, set);
        }
      }
      if (sight && overlapDepth(cell(index), rect) > 0) grid.sightBlocked[index] = 1;
    });

  for (const wall of space.walls) block(wall, null, true);
  for (const [id, boxes] of space.hitboxes) {
    for (const box of boxes) block(box, id, false);
  }
  for (const [, footprint] of space.footprints) {
    if (footprint.yMax - footprint.yMin < LEVEL_SIGHT_BLOCK_HEIGHT) continue;
    forSamplesUnder(grid, footprint.rect, 0, (index) => {
      if (overlapDepth(cell(index), footprint.rect) > 0) grid.sightBlocked[index] = 1;
    });
  }
  return grid;
}

/**
 * The walkable sample holding `p`, or else the nearest walkable one next to it, so a
 * spawn whose body fits is never lost to where the sample grid happens to fall. -1 if none.
 */
export function nearestWalkable(grid: SampleGrid, p: LevelPoint): number {
  const index = grid.indexAt(p.x, p.z);
  if (index < 0 || grid.walkable[index]) return index;
  let best = -1;
  let bestDistance = Infinity;
  for (const next of neighbours(grid, index)) {
    const c = grid.centre(next);
    const distance = Math.hypot(c.x - p.x, c.z - p.z);
    if (grid.walkable[next] && distance < bestDistance) {
      best = next;
      bestDistance = distance;
    }
  }
  return best;
}

/** Flood the walkable samples from the `seeds` indices through edge-adjacent steps; returns the reached set. */
export function floodReach(grid: SampleGrid, seeds: readonly number[]): Uint8Array {
  const reached = new Uint8Array(grid.nx * grid.nz);
  const queue: number[] = [];
  for (const index of seeds) {
    if (reached[index]) continue;
    reached[index] = 1;
    queue.push(index);
  }
  for (let head = 0; head < queue.length; head++) {
    for (const next of neighbours(grid, queue[head]!)) {
      if (!grid.walkable[next] || reached[next]) continue;
      reached[next] = 1;
      queue.push(next);
    }
  }
  return reached;
}

/** Group the samples where `member` holds into edge-connected components. */
export function components(grid: SampleGrid, member: (index: number) => boolean): number[][] {
  const seen = new Uint8Array(grid.nx * grid.nz);
  const groups: number[][] = [];
  for (let start = 0; start < grid.nx * grid.nz; start++) {
    if (seen[start] || !member(start)) continue;
    seen[start] = 1;
    const group = [start];
    for (let head = 0; head < group.length; head++) {
      for (const next of neighbours(grid, group[head]!)) {
        if (seen[next] || !member(next)) continue;
        seen[next] = 1;
        group.push(next);
      }
    }
    groups.push(group);
  }
  return groups;
}

function march(
  grid: SampleGrid,
  from: LevelPoint,
  dx: number,
  dz: number,
  within: (point: LevelPoint) => boolean,
): number {
  let length = 0;
  for (;;) {
    const next = length + SIGHT_STEP;
    const at = { x: from.x + dx * next, z: from.z + dz * next };
    const index = grid.indexAt(at.x, at.z);
    if (index < 0 || grid.sightBlocked[index] || !within(at)) return length;
    length = next;
  }
}

/**
 * The longest clear line of sight inside the area where `within` holds, from every
 * other walkable sample there over {@link SIGHT_DIRECTIONS} headings. A line stops at
 * a wall, at an object tall enough to hide a crouching prop, or where it leaves the area.
 */
export function longestSightline(
  grid: SampleGrid,
  within: (point: LevelPoint) => boolean,
): Sightline | null {
  let best: Sightline | null = null;
  for (let a = 0; a < grid.nx; a += SIGHT_ORIGIN_STRIDE) {
    for (let b = 0; b < grid.nz; b += SIGHT_ORIGIN_STRIDE) {
      const index = a * grid.nz + b;
      if (!grid.walkable[index]) continue;
      const from = grid.centre(index);
      if (!within(from)) continue;
      for (let k = 0; k < SIGHT_DIRECTIONS; k++) {
        const angle = (2 * Math.PI * k) / SIGHT_DIRECTIONS;
        const dx = Math.cos(angle);
        const dz = Math.sin(angle);
        const length = march(grid, from, dx, dz, within);
        if (best === null || length > best.length) {
          best = { from, to: { x: from.x + dx * length, z: from.z + dz * length }, length };
        }
      }
    }
  }
  return best;
}
