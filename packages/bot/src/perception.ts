import type { MapDefinition, PropBounds, Vec3 } from "@morphy/shared";
import type { Rng } from "./aim";
import {
  GLANCE_ANGLE_MAX_RAD,
  GLANCE_ANGLE_MIN_RAD,
  GLANCE_HOLD_MS,
  GLANCE_INTERVAL_MAX_MS,
  GLANCE_INTERVAL_MIN_MS,
  GLANCE_TURN_RATE,
  lerp,
  SIGHT_CELL_SIZE,
  SIGHT_SAMPLE_EDGE_SHARE,
  SIGHT_SAMPLE_TOP_SHARE,
} from "./config";

/** No sightline is longer than this many grid cells; a guard, never reached on a real map. */
const MAX_CELL_STEPS = 4_096;
const NO_OWNER = -1;
const SEGMENT_EPSILON = 1e-9;

/**
 * A Y-rotated box that blocks sight: a wall, or a part of a piece of furniture
 * turned with it, the same oriented shape the client moves a player against.
 * `owner` is the furniture's index in the map's prop list, so a piece of
 * furniture never hides itself.
 */
interface Occluder {
  x: number;
  z: number;
  cos: number;
  sin: number;
  hx: number;
  hz: number;
  yMin: number;
  yMax: number;
  owner: number;
}

/** Where a bot looks from, and, for a hunter, the cone it looks along. */
export interface Viewer {
  x: number;
  y: number;
  z: number;
  /** The way it faces (0 is +Z), the heading of its camera. */
  heading: number;
  /** The cone's half-angle, or null for a viewer who sees all round. */
  halfAngle: number | null;
  range: number;
}

/** A body the bot might see: where it stands, its visible bounds, and the furniture it is (if any). */
export interface Body {
  x: number;
  y: number;
  z: number;
  bounds: PropBounds;
  owner?: number;
}

/**
 * Everything on a map that blocks sight, bucketed in a grid so that a
 * sightline tests only the walls and furniture it crosses. Walls are the
 * map's colliders, the same boxes shots stop at; furniture is every placed
 * prop's catalog parts turned with it, the shape its model is fitted to,
 * which shots do not stop at but eyes do. Only what never moves is here:
 * players and decoys block no one's view, an approximation that errs on the
 * side of the hunter seeing.
 */
export class SightIndex {
  private readonly occluders: Occluder[] = [];
  private readonly cells = new Map<number, number[]>();
  private readonly originX: number;
  private readonly originZ: number;
  private readonly columns: number;
  private readonly visited: Uint32Array;
  private visit = 0;

  constructor(map: MapDefinition) {
    this.originX = map.bounds.min.x;
    this.originZ = map.bounds.min.z;
    this.columns = Math.max(1, Math.ceil((map.bounds.max.x - this.originX) / SIGHT_CELL_SIZE) + 1);
    for (const collider of map.colliders) {
      if (collider.position.y <= 0) continue;
      this.add({
        x: collider.position.x,
        z: collider.position.z,
        cos: 1,
        sin: 0,
        hx: collider.size.x / 2,
        hz: collider.size.z / 2,
        yMin: collider.position.y - collider.size.y / 2,
        yMax: collider.position.y + collider.size.y / 2,
        owner: NO_OWNER,
      });
    }
    const catalog = new Map(map.propCatalog.map((def) => [def.id, def] as const));
    map.props.forEach((prop, index) => {
      const def = catalog.get(prop.type);
      if (!def) return;
      const cos = Math.cos(prop.rotation);
      const sin = Math.sin(prop.rotation);
      for (const part of def.parts) {
        this.add({
          x: prop.position.x + part.position.x * cos + part.position.z * sin,
          z: prop.position.z - part.position.x * sin + part.position.z * cos,
          cos,
          sin,
          hx: part.size.x / 2,
          hz: part.size.z / 2,
          yMin: prop.position.y + part.position.y - part.size.y / 2,
          yMax: prop.position.y + part.position.y + part.size.y / 2,
          owner: index,
        });
      }
    });
    this.visited = new Uint32Array(this.occluders.length);
  }

  /** Whether nothing stands between two points, furniture `ignore` (a map prop index) aside. */
  clear(from: Vec3, to: Vec3, ignore = NO_OWNER): boolean {
    this.visit += 1;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    let ix = this.column(from.x);
    let iz = this.row(from.z);
    const stepX = Math.sign(dx);
    const stepZ = Math.sign(dz);
    const deltaX = stepX === 0 ? Number.POSITIVE_INFINITY : SIGHT_CELL_SIZE / Math.abs(dx);
    const deltaZ = stepZ === 0 ? Number.POSITIVE_INFINITY : SIGHT_CELL_SIZE / Math.abs(dz);
    let nextX =
      stepX === 0
        ? Number.POSITIVE_INFINITY
        : (this.originX + (ix + (stepX > 0 ? 1 : 0)) * SIGHT_CELL_SIZE - from.x) / dx;
    let nextZ =
      stepZ === 0
        ? Number.POSITIVE_INFINITY
        : (this.originZ + (iz + (stepZ > 0 ? 1 : 0)) * SIGHT_CELL_SIZE - from.z) / dz;
    for (let steps = 0; steps < MAX_CELL_STEPS; steps++) {
      if (this.blockedIn(ix, iz, from, to, ignore)) return false;
      if (Math.min(nextX, nextZ) > 1) return true;
      if (nextX < nextZ) {
        ix += stepX;
        nextX += deltaX;
      } else {
        iz += stepZ;
        nextZ += deltaZ;
      }
    }
    return true;
  }

  private blockedIn(ix: number, iz: number, from: Vec3, to: Vec3, ignore: number): boolean {
    const bucket = this.cells.get(this.key(ix, iz));
    if (!bucket) return false;
    for (const index of bucket) {
      if (this.visited[index] === this.visit) continue;
      this.visited[index] = this.visit;
      const occluder = this.occluders[index]!;
      if (occluder.owner !== NO_OWNER && occluder.owner === ignore) continue;
      if (segmentHits(occluder, from, to)) return true;
    }
    return false;
  }

  private add(occluder: Occluder): void {
    const index = this.occluders.length;
    this.occluders.push(occluder);
    const reachX = Math.abs(occluder.hx * occluder.cos) + Math.abs(occluder.hz * occluder.sin);
    const reachZ = Math.abs(occluder.hx * occluder.sin) + Math.abs(occluder.hz * occluder.cos);
    for (let ix = this.column(occluder.x - reachX); ix <= this.column(occluder.x + reachX); ix++) {
      for (let iz = this.row(occluder.z - reachZ); iz <= this.row(occluder.z + reachZ); iz++) {
        const key = this.key(ix, iz);
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(index);
        else this.cells.set(key, [index]);
      }
    }
  }

  private column(x: number): number {
    return Math.floor((x - this.originX) / SIGHT_CELL_SIZE);
  }

  private row(z: number): number {
    return Math.floor((z - this.originZ) / SIGHT_CELL_SIZE);
  }

  private key(ix: number, iz: number): number {
    return iz * this.columns + ix;
  }
}

/** The part of a segment, as a fraction of its length, still inside every slab tested so far. */
const span = { enter: 0, exit: 1 };

/** Narrow {@link span} to one slab of a box; false once nothing of the segment is left inside. */
function narrow(start: number, direction: number, low: number, high: number): boolean {
  if (Math.abs(direction) < SEGMENT_EPSILON) return start >= low && start <= high;
  const t1 = (low - start) / direction;
  const t2 = (high - start) / direction;
  span.enter = Math.max(span.enter, Math.min(t1, t2));
  span.exit = Math.min(span.exit, Math.max(t1, t2));
  return span.enter <= span.exit;
}

/** Whether the segment `from`→`to` passes through the box, tested in the box's own frame. */
function segmentHits(box: Occluder, from: Vec3, to: Vec3): boolean {
  const px = from.x - box.x;
  const pz = from.z - box.z;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  span.enter = 0;
  span.exit = 1;
  return (
    narrow(px * box.cos - pz * box.sin, dx * box.cos - dz * box.sin, -box.hx, box.hx) &&
    narrow(px * box.sin + pz * box.cos, dx * box.sin + dz * box.cos, -box.hz, box.hz) &&
    narrow(from.y, to.y - from.y, box.yMin, box.yMax) &&
    span.enter < 1
  );
}

/**
 * The points of a body a viewer looks for, nearest first in the order a
 * player's eye finds them: its middle, near its top, then its two sides
 * across the line of sight.
 */
export function bodySamples(viewer: Viewer, body: Body): Vec3[] {
  const { bounds } = body;
  const mid = body.y + (bounds.yMin + bounds.yMax) / 2;
  const top = body.y + bounds.yMin + (bounds.yMax - bounds.yMin) * SIGHT_SAMPLE_TOP_SHARE;
  const dx = body.x - viewer.x;
  const dz = body.z - viewer.z;
  const len = Math.hypot(dx, dz) || 1;
  const side = bounds.radius * SIGHT_SAMPLE_EDGE_SHARE;
  const sx = (-dz / len) * side;
  const sz = (dx / len) * side;
  return [
    { x: body.x, y: mid, z: body.z },
    { x: body.x, y: top, z: body.z },
    { x: body.x + sx, y: mid, z: body.z + sz },
    { x: body.x - sx, y: mid, z: body.z - sz },
  ];
}

/** Whether a point falls inside the viewer's cone; always, for one who sees all round. */
export function inView(viewer: Viewer, point: { x: number; z: number }): boolean {
  if (viewer.halfAngle === null) return true;
  const dx = point.x - viewer.x;
  const dz = point.z - viewer.z;
  const len = Math.hypot(dx, dz);
  if (len < SEGMENT_EPSILON) return true;
  const along = (dx * Math.sin(viewer.heading) + dz * Math.cos(viewer.heading)) / len;
  return along >= Math.cos(viewer.halfAngle);
}

/**
 * The one test of whether a bot sees a body: within range, some part of it
 * inside the viewer's cone and in the clear of every wall and piece of
 * furniture, the body's own furniture aside. Returns the first point of it
 * seen, which is where a hunter aims, or null when none is.
 */
export function sightOf(index: SightIndex, viewer: Viewer, body: Body): Vec3 | null {
  if (Math.hypot(body.x - viewer.x, body.z - viewer.z) > viewer.range) return null;
  const eye: Vec3 = { x: viewer.x, y: viewer.y, z: viewer.z };
  for (const sample of bodySamples(viewer, body)) {
    if (!inView(viewer, sample)) continue;
    if (index.clear(eye, sample, body.owner ?? NO_OWNER)) return sample;
  }
  return null;
}

/**
 * Where a hunter with nothing in its sights is looking, off the way it walks:
 * at most every {@link GLANCE_INTERVAL_MIN_MS} it turns aside to one side or
 * the other, holds the look, and turns back, at a bounded rate, so a bot
 * searching a room covers more than the cone ahead of it but is never
 * looking everywhere at once.
 */
export class Glance {
  private offset = 0;
  private goal = 0;
  private nextAt: number | null = null;
  private backAt = 0;

  /** Advance the look by one tick and return its offset from the heading, in radians. */
  update(now: number, dt: number, rng: Rng): number {
    this.nextAt ??= now + lerp(GLANCE_INTERVAL_MIN_MS, GLANCE_INTERVAL_MAX_MS, rng());
    if (now >= this.nextAt) {
      const side = rng() < 0.5 ? -1 : 1;
      this.goal = side * lerp(GLANCE_ANGLE_MIN_RAD, GLANCE_ANGLE_MAX_RAD, rng());
      this.backAt = now + GLANCE_HOLD_MS;
      this.nextAt = this.backAt + lerp(GLANCE_INTERVAL_MIN_MS, GLANCE_INTERVAL_MAX_MS, rng());
    } else if (now >= this.backAt) {
      this.goal = 0;
    }
    const step = GLANCE_TURN_RATE * dt;
    this.offset += Math.max(-step, Math.min(step, this.goal - this.offset));
    return this.offset;
  }

  /** Look straight ahead again, and wait a whole interval before the next glance. */
  reset(): void {
    this.offset = 0;
    this.goal = 0;
    this.nextAt = null;
  }
}
