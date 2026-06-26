import { ASTAR_MAX_EXPANDED } from "../config";
import { type Cell, type NavGrid, inGrid, isBlocked } from "./grid";

const SQRT2 = Math.SQRT2;
const DIAGONAL_EXTRA = SQRT2 - 2;

interface Step {
  di: number;
  dj: number;
  cost: number;
  diagonal: boolean;
}

const STEPS: Step[] = [
  { di: 1, dj: 0, cost: 1, diagonal: false },
  { di: -1, dj: 0, cost: 1, diagonal: false },
  { di: 0, dj: 1, cost: 1, diagonal: false },
  { di: 0, dj: -1, cost: 1, diagonal: false },
  { di: 1, dj: 1, cost: SQRT2, diagonal: true },
  { di: 1, dj: -1, cost: SQRT2, diagonal: true },
  { di: -1, dj: 1, cost: SQRT2, diagonal: true },
  { di: -1, dj: -1, cost: SQRT2, diagonal: true },
];

/** Binary min-heap of grid indices keyed by f-score. */
class MinHeap {
  private idx: number[] = [];
  private f: number[] = [];

  get size(): number {
    return this.idx.length;
  }

  push(index: number, fScore: number): void {
    this.idx.push(index);
    this.f.push(fScore);
    let c = this.idx.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.f[p]! <= this.f[c]!) break;
      this.swap(p, c);
      c = p;
    }
  }

  pop(): number {
    const top = this.idx[0]!;
    const lastIdx = this.idx.pop()!;
    const lastF = this.f.pop()!;
    if (this.idx.length > 0) {
      this.idx[0] = lastIdx;
      this.f[0] = lastF;
      this.siftDown(0);
    }
    return top;
  }

  private siftDown(start: number): void {
    const n = this.idx.length;
    let p = start;
    for (;;) {
      const l = p * 2 + 1;
      const r = l + 1;
      let smallest = p;
      if (l < n && this.f[l]! < this.f[smallest]!) smallest = l;
      if (r < n && this.f[r]! < this.f[smallest]!) smallest = r;
      if (smallest === p) break;
      this.swap(p, smallest);
      p = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const ti = this.idx[a]!;
    this.idx[a] = this.idx[b]!;
    this.idx[b] = ti;
    const tf = this.f[a]!;
    this.f[a] = this.f[b]!;
    this.f[b] = tf;
  }
}

function octile(di: number, dj: number): number {
  const adi = Math.abs(di);
  const adj = Math.abs(dj);
  return adi + adj + DIAGONAL_EXTRA * Math.min(adi, adj);
}

/**
 * Shortest 8-connected path from `start` to `goal` on the grid, or `null` when
 * the goal is unreachable or the search exceeds {@link ASTAR_MAX_EXPANDED}
 * nodes. Diagonal moves are forbidden through blocked corners. Both endpoints
 * must be free cells (the caller snaps via {@link nearestFreeCell}). Returns the
 * cell sequence inclusive of both endpoints.
 */
export function findPath(grid: NavGrid, start: Cell, goal: Cell): Cell[] | null {
  const { cols, rows } = grid;
  const total = cols * rows;
  const startIdx = start.j * cols + start.i;
  const goalIdx = goal.j * cols + goal.i;
  if (startIdx === goalIdx) return [start];

  const gScore = new Float64Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);

  gScore[startIdx] = 0;
  const open = new MinHeap();
  open.push(startIdx, octile(start.i - goal.i, start.j - goal.j));
  let expanded = 0;

  while (open.size > 0) {
    const current = open.pop();
    if (closed[current] === 1) continue;
    closed[current] = 1;
    if (current === goalIdx) return reconstruct(cameFrom, current, cols);
    if (++expanded > ASTAR_MAX_EXPANDED) return null;

    const ci = current % cols;
    const cj = (current - ci) / cols;
    const cg = gScore[current]!;

    for (const step of STEPS) {
      const ni = ci + step.di;
      const nj = cj + step.dj;
      if (!inGrid(grid, ni, nj) || isBlocked(grid, ni, nj)) continue;
      if (step.diagonal && (isBlocked(grid, ni, cj) || isBlocked(grid, ci, nj))) continue;
      const nIdx = nj * cols + ni;
      if (closed[nIdx] === 1) continue;
      const tentative = cg + step.cost;
      if (tentative < gScore[nIdx]!) {
        gScore[nIdx] = tentative;
        cameFrom[nIdx] = current;
        open.push(nIdx, tentative + octile(ni - goal.i, nj - goal.j));
      }
    }
  }

  return null;
}

function reconstruct(cameFrom: Int32Array, goalIdx: number, cols: number): Cell[] {
  const path: Cell[] = [];
  let node = goalIdx;
  while (node !== -1) {
    const i = node % cols;
    const j = (node - i) / cols;
    path.push({ i, j });
    node = cameFrom[node]!;
  }
  path.reverse();
  return path;
}
