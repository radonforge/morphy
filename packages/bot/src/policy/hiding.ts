import { PLAYER_HEIGHT, type PropInstance } from "@morphy/shared";
import { resolveCollisions } from "../collision";
import {
  BOT_EYE_HEIGHT,
  BOT_VISION_RANGE,
  HIDE_ALIGN_TOLERANCE_RAD,
  HIDE_COVER_BEARINGS,
  HIDE_COVER_RADIUS,
  HIDE_EXIT_BEARINGS,
  HIDE_EXIT_RADIUS,
  HIDE_EXITS_WANTED,
  HIDE_MAX_CANDIDATES,
  HIDE_MOVE_AWAY,
  HIDE_OVERLAP_TOLERANCE,
  HIDE_PICK_ATTEMPTS,
  HIDE_PICK_SHARE,
  HIDE_ROW_GAPS,
  HIDE_SAME_TYPE_CAP,
  HIDE_SAME_TYPE_RADIUS,
  HIDE_SAMPLES,
  HIDE_SCORE_FLOOR,
  HIDE_SCORED_CANDIDATES,
  HIDE_SURFACE_REACH,
  HIDE_WALL_BACK_REACH,
  HIDE_WALL_GAP,
  HIDE_WALL_REACH,
  HIDE_WEIGHT_ALIGNED,
  HIDE_WEIGHT_COVER,
  HIDE_WEIGHT_EXITS,
  HIDE_WEIGHT_MOUNT,
  HIDE_WEIGHT_SAME_TYPE,
  HIDE_WEIGHT_SPAWN_COVER,
  HIDE_WEIGHT_THREAT_COVER,
  HIDE_WEIGHT_TRAVEL,
  NAV_SNAP_RADIUS_CELLS,
} from "../config";
import { findPath } from "../nav/astar";
import {
  type Cell,
  cellCenter,
  isBlocked,
  nearestFreeCell,
  type Point2,
  worldToCell,
} from "../nav/grid";
import { hasLineOfSight } from "../nav/path";
import { type Body, sightOf, type Viewer } from "../perception";
import type { Shape, Terrain } from "../terrain";

/** Where a disguise stands and which way it is turned. */
export interface HideSite extends Point2 {
  yaw: number;
}

/** What a prop wants of a spot, all of it static map knowledge or what it perceived. */
export interface HideQuery {
  /** The disguise it wears. */
  type: string;
  /** Where it stands. */
  from: Point2;
  /** How far round it looks. */
  radius: number;
  /** The longest walk it accepts. */
  maxPath: number;
  /**
   * Where hunters were last seen or heard, which the spot should be hidden
   * from: perceived positions, never where anyone is now.
   */
  threats: readonly Point2[];
  /** A spot it is giving up, which the new one keeps away from. */
  leaving: Point2 | null;
}

/** A Y-rotated rectangle on the ground, turned the way a placed object turns its model. */
interface Footprint {
  x: number;
  z: number;
  cos: number;
  sin: number;
  hx: number;
  hz: number;
}

interface Placed {
  prop: PropInstance;
  shape: Shape;
  footprint: Footprint;
}

/** What a terrain offers every pick, worked out once per map. */
interface Prepared {
  furniture: Placed[];
  walls: Footprint[];
}

interface Scored extends HideSite {
  score: number;
}

const prepared = new WeakMap<Terrain, Prepared>();
const QUARTER_TURN = Math.PI / 2;
const FULL_TURN = 2 * Math.PI;
const DIAGONAL_STEP = Math.SQRT2;
const SAME_SPOT = 1e-3;

function footprintOf(x: number, z: number, yaw: number, hx: number, hz: number): Footprint {
  return { x, z, cos: Math.cos(yaw), sin: Math.sin(yaw), hx, hz };
}

/** Where a point given in an object's own frame lands once the object is placed at (x, z) turned by `yaw`. */
function toWorld(x: number, z: number, yaw: number, lx: number, lz: number): Point2 {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return { x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos };
}

function radiusAlong(f: Footprint, ux: number, uz: number): number {
  return f.hx * Math.abs(ux * f.cos - uz * f.sin) + f.hz * Math.abs(ux * f.sin + uz * f.cos);
}

/** Whether two footprints overlap by more than `tolerance`, by the separating axis test. */
function overlaps(a: Footprint, b: Footprint, tolerance: number): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const axes = [
    [a.cos, -a.sin],
    [a.sin, a.cos],
    [b.cos, -b.sin],
    [b.sin, b.cos],
  ] as const;
  for (const [ux, uz] of axes) {
    const gap = Math.abs(dx * ux + dz * uz);
    if (gap >= radiusAlong(a, ux, uz) + radiusAlong(b, ux, uz) - tolerance) return false;
  }
  return true;
}

/**
 * The yaw between two turns of a model, folded by its symmetry: a model that
 * looks the same after every quarter turn is aligned with any quarter turn.
 */
export function yawGap(a: number, b: number, symmetry: number): number {
  const period = FULL_TURN / symmetry;
  const d = (((a - b) % period) + period) % period;
  return Math.min(d, period - d);
}

function prepare(terrain: Terrain): Prepared {
  const known = prepared.get(terrain);
  if (known) return known;
  const furniture: Placed[] = [];
  for (const prop of terrain.map.props) {
    const shape = terrain.shape(prop.type);
    if (!shape || prop.position.y >= PLAYER_HEIGHT) continue;
    const { x, z } = prop.position;
    furniture.push({
      prop,
      shape,
      footprint: footprintOf(x, z, prop.rotation, shape.extent.halfX, shape.extent.halfZ),
    });
  }
  const walls = terrain.walls.map((wall) =>
    footprintOf(
      (wall.minX + wall.maxX) / 2,
      (wall.minZ + wall.maxZ) / 2,
      0,
      (wall.maxX - wall.minX) / 2,
      (wall.maxZ - wall.minZ) / 2,
    ),
  );
  const made = { furniture, walls };
  prepared.set(terrain, made);
  return made;
}

/** Whether a model's front lies along its own Z axis, so it backs onto a wall across X. */
function frontsAlongZ(shape: Shape): boolean {
  return Math.abs(Math.sin(shape.frontYaw)) < 0.5;
}

/**
 * Spots beside objects of the prop's own kind, turned exactly as they are: in
 * a row with one, or for a floor object in front of or behind it, leaving
 * each gap in {@link HIDE_ROW_GAPS}. A wall-mounted object only extends a row
 * along the wall, never out into the room. They are looked for as far as the
 * prop can walk, not only within its search radius: a rare shape is worth the
 * walk to the few objects of its kind.
 */
function besideOwnKind(land: Prepared, shape: Shape, query: HideQuery): HideSite[] {
  const sites: HideSite[] = [];
  const along: ("x" | "z")[] =
    shape.mount === "wall" ? [frontsAlongZ(shape) ? "x" : "z"] : ["x", "z"];
  const reach = Math.max(query.radius, query.maxPath);
  for (const { prop } of land.furniture) {
    if (prop.type !== query.type) continue;
    const { x, z } = prop.position;
    if (Math.hypot(x - query.from.x, z - query.from.z) > reach) continue;
    for (const axis of along) {
      const half = axis === "x" ? shape.extent.halfX : shape.extent.halfZ;
      for (const gap of HIDE_ROW_GAPS) {
        for (const side of [-1, 1]) {
          const offset = side * (2 * half + gap);
          const at =
            axis === "x"
              ? toWorld(x, z, prop.rotation, offset, 0)
              : toWorld(x, z, prop.rotation, 0, offset);
          sites.push({ ...at, yaw: prop.rotation });
        }
      }
    }
  }
  return sites;
}

/** A point drawn uniformly within the query's radius. */
function samplePoint(query: HideQuery, rng: () => number): Point2 {
  const angle = rng() * FULL_TURN;
  const r = Math.sqrt(rng()) * query.radius;
  return { x: query.from.x + Math.sin(angle) * r, z: query.from.z + Math.cos(angle) * r };
}

/**
 * The nearest wall face to `p` within {@link HIDE_WALL_REACH} that `p` stands
 * square in front of: the point on it and the way it faces into the room.
 */
function nearestWallFace(land: Prepared, p: Point2): { at: Point2; nx: number; nz: number } | null {
  let best: { at: Point2; nx: number; nz: number } | null = null;
  let bestDistance = HIDE_WALL_REACH;
  for (const wall of land.walls) {
    const minX = wall.x - wall.hx;
    const maxX = wall.x + wall.hx;
    const minZ = wall.z - wall.hz;
    const maxZ = wall.z + wall.hz;
    const faces: { distance: number; at: Point2; nx: number; nz: number }[] = [];
    if (p.x >= minX && p.x <= maxX) {
      if (p.z < minZ) faces.push({ distance: minZ - p.z, at: { x: p.x, z: minZ }, nx: 0, nz: -1 });
      if (p.z > maxZ) faces.push({ distance: p.z - maxZ, at: { x: p.x, z: maxZ }, nx: 0, nz: 1 });
    }
    if (p.z >= minZ && p.z <= maxZ) {
      if (p.x < minX) faces.push({ distance: minX - p.x, at: { x: minX, z: p.z }, nx: -1, nz: 0 });
      if (p.x > maxX) faces.push({ distance: p.x - maxX, at: { x: maxX, z: p.z }, nx: 1, nz: 0 });
    }
    for (const face of faces) {
      if (face.distance >= bestDistance) continue;
      bestDistance = face.distance;
      best = { at: face.at, nx: face.nx, nz: face.nz };
    }
  }
  return best;
}

/** Spots with the disguise's back to a wall and its front to the room, for a wall-mounted object. */
function againstWalls(
  land: Prepared,
  shape: Shape,
  query: HideQuery,
  rng: () => number,
): HideSite[] {
  const sites: HideSite[] = [];
  const depth = frontsAlongZ(shape) ? shape.extent.halfZ : shape.extent.halfX;
  for (let k = 0; k < HIDE_SAMPLES; k++) {
    const face = nearestWallFace(land, samplePoint(query, rng));
    if (!face) continue;
    const out = depth + HIDE_WALL_GAP;
    sites.push({
      x: face.at.x + face.nx * out,
      z: face.at.z + face.nz * out,
      yaw: Math.atan2(face.nx, face.nz) - shape.frontYaw,
    });
  }
  return sites;
}

/**
 * Spots beside other furniture, squared to it by a quarter turn, as objects
 * set down in a room line up with what is already there.
 */
function besideFurniture(
  land: Prepared,
  shape: Shape,
  query: HideQuery,
  rng: () => number,
): HideSite[] {
  const near = land.furniture.filter(
    ({ prop }) =>
      Math.hypot(prop.position.x - query.from.x, prop.position.z - query.from.z) <= query.radius,
  );
  const sites: HideSite[] = [];
  if (near.length === 0) return sites;
  const gap = HIDE_ROW_GAPS[0] ?? 0;
  for (let k = 0; k < HIDE_SAMPLES; k++) {
    const { prop, shape: other } = near[Math.floor(rng() * near.length)]!;
    const turns = Math.floor(rng() * 4);
    const yaw = prop.rotation + turns * QUARTER_TURN;
    const acrossX = rng() < 0.5;
    const side = rng() < 0.5 ? -1 : 1;
    const mine = (turns % 2 === 0) === acrossX ? shape.extent.halfX : shape.extent.halfZ;
    const theirs = acrossX ? other.extent.halfX : other.extent.halfZ;
    const offset = side * (theirs + mine + gap);
    const { x, z } = prop.position;
    const at = acrossX
      ? toWorld(x, z, prop.rotation, offset, 0)
      : toWorld(x, z, prop.rotation, 0, offset);
    sites.push({ ...at, yaw });
  }
  return sites;
}

/**
 * Whether a disguise can stand at a site: inside the map, its body clear of
 * walls and furniture as the bot moves, its model overlapping none of the
 * scenery, and next to walkable ground.
 */
function fits(terrain: Terrain, land: Prepared, shape: Shape, site: HideSite): boolean {
  const { bounds } = terrain.map;
  const reach = Math.max(shape.extent.halfX, shape.extent.halfZ);
  if (site.x - reach < bounds.min.x || site.x + reach > bounds.max.x) return false;
  if (site.z - reach < bounds.min.z || site.z + reach > bounds.max.z) return false;
  const pushed = resolveCollisions(site, terrain.walls, terrain.obstacles, bounds);
  if (Math.hypot(pushed.x - site.x, pushed.z - site.z) > SAME_SPOT) return false;
  const mine = footprintOf(site.x, site.z, site.yaw, shape.extent.halfX, shape.extent.halfZ);
  for (const wall of land.walls) {
    if (overlaps(mine, wall, HIDE_OVERLAP_TOLERANCE)) return false;
  }
  for (const { footprint } of land.furniture) {
    if (overlaps(mine, footprint, HIDE_OVERLAP_TOLERANCE)) return false;
  }
  return nearestFreeCell(terrain.grid, worldToCell(terrain.grid, site.x, site.z), 1) !== null;
}

/** How well a spot suits where the shape belongs: 1 for a floor object anywhere, a wall one backed onto a wall, a surface one beside furniture. */
function mountFit(land: Prepared, shape: Shape, site: HideSite): number {
  if (shape.mount === "floor") return 1;
  if (shape.mount === "wall") {
    const depth = frontsAlongZ(shape) ? shape.extent.halfZ : shape.extent.halfX;
    const back = site.yaw + shape.frontYaw + Math.PI;
    const probe = {
      x: site.x + Math.sin(back) * (depth + HIDE_WALL_BACK_REACH),
      z: site.z + Math.cos(back) * (depth + HIDE_WALL_BACK_REACH),
    };
    return land.walls.some(
      (wall) => Math.abs(probe.x - wall.x) <= wall.hx && Math.abs(probe.z - wall.z) <= wall.hz,
    )
      ? 1
      : 0;
  }
  const around = footprintOf(
    site.x,
    site.z,
    site.yaw,
    shape.extent.halfX + HIDE_SURFACE_REACH,
    shape.extent.halfZ + HIDE_SURFACE_REACH,
  );
  return land.furniture.some(({ footprint }) => overlaps(around, footprint, 0)) ? 1 : 0;
}

/** The objects of the same kind round a spot, and whether one is turned as the disguise would be. */
function ownKindAround(
  land: Prepared,
  shape: Shape,
  type: string,
  site: HideSite,
): { count: number; aligned: boolean } {
  let count = 0;
  let aligned = false;
  for (const { prop } of land.furniture) {
    if (prop.type !== type) continue;
    if (Math.hypot(prop.position.x - site.x, prop.position.z - site.z) > HIDE_SAME_TYPE_RADIUS) {
      continue;
    }
    count++;
    if (yawGap(prop.rotation, site.yaw, shape.symmetry) <= HIDE_ALIGN_TOLERANCE_RAD) aligned = true;
  }
  return { count, aligned };
}

/** The free navigation cell a point stands on or next to, as a point, or null when it is boxed in. */
function walkableNear(terrain: Terrain, p: Point2, rings: number): Point2 | null {
  const cell = nearestFreeCell(terrain.grid, worldToCell(terrain.grid, p.x, p.z), rings);
  return cell ? cellCenter(terrain.grid, cell) : null;
}

/** The share of {@link HIDE_EXITS_WANTED} ways out of a spot a body can walk straight along. */
function exits(terrain: Terrain, site: Point2): number {
  const start = walkableNear(terrain, site, 1);
  if (!start) return 0;
  let open = 0;
  for (let k = 0; k < HIDE_EXIT_BEARINGS; k++) {
    const bearing = (FULL_TURN * k) / HIDE_EXIT_BEARINGS;
    const x = start.x + Math.sin(bearing) * HIDE_EXIT_RADIUS;
    const z = start.z + Math.cos(bearing) * HIDE_EXIT_RADIUS;
    if (hasLineOfSight(terrain.grid, start.x, start.z, x, z)) open++;
  }
  return Math.min(1, open / HIDE_EXITS_WANTED);
}

function viewerAt(p: Point2, range: number): Viewer {
  return { x: p.x, y: BOT_EYE_HEIGHT, z: p.z, heading: 0, halfAngle: null, range };
}

/** The share of `eyes` that do not see a body: 1 when there are none to see it. */
function hiddenFrom(terrain: Terrain, eyes: readonly Viewer[], body: Body): number {
  if (eyes.length === 0) return 1;
  let unseen = 0;
  for (const eye of eyes) {
    if (!sightOf(terrain.sight, eye, body)) unseen++;
  }
  return unseen / eyes.length;
}

/** The open ground round a spot it is looked at from: points on a ring that a body could stand on. */
function coverRing(terrain: Terrain, site: Point2): Viewer[] {
  const eyes: Viewer[] = [];
  for (let k = 0; k < HIDE_COVER_BEARINGS; k++) {
    const bearing = (FULL_TURN * k) / HIDE_COVER_BEARINGS;
    const x = site.x + Math.sin(bearing) * HIDE_COVER_RADIUS;
    const z = site.z + Math.cos(bearing) * HIDE_COVER_RADIUS;
    const cell = worldToCell(terrain.grid, x, z);
    if (isBlocked(terrain.grid, cell.i, cell.j)) continue;
    eyes.push(viewerAt({ x, z }, HIDE_COVER_RADIUS + 1));
  }
  return eyes;
}

/** The length of a path planned on the grid, cell centre to cell centre. */
function pathLength(cells: readonly Cell[], cellSize: number): number {
  let length = 0;
  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1]!;
    const b = cells[k]!;
    length += (a.i !== b.i && a.j !== b.j ? DIAGONAL_STEP : 1) * cellSize;
  }
  return length;
}

/** How far a body walks from `from` to `to` round what stands between, or null when it cannot get there. */
export function walkDistance(terrain: Terrain, from: Point2, to: Point2): number | null {
  const { grid } = terrain;
  const start = nearestFreeCell(grid, worldToCell(grid, from.x, from.z), NAV_SNAP_RADIUS_CELLS);
  const goal = nearestFreeCell(grid, worldToCell(grid, to.x, to.z), 1);
  if (!start || !goal) return null;
  const cells = findPath(grid, start, goal);
  if (!cells) return null;
  const end = cellCenter(grid, goal);
  return pathLength(cells, grid.cellSize) + Math.hypot(end.x - to.x, end.z - to.z);
}

/**
 * Every candidate spot near the prop for its disguise, scored: at most
 * {@link HIDE_MAX_CANDIDATES}, the nearest. Cheap qualities (objects of its kind round it and turned like it, where the
 * shape belongs, ways out, distance) rank them all; cover is judged only for
 * the best {@link HIDE_SCORED_CANDIDATES}, which bounds what one pick costs.
 */
export function scoreHideSites(terrain: Terrain, query: HideQuery, rng: () => number): Scored[] {
  const shape = terrain.shape(query.type);
  if (!shape) return [];
  const land = prepare(terrain);
  const away = (site: Point2): number => Math.hypot(site.x - query.from.x, site.z - query.from.z);
  const candidates = [
    ...besideOwnKind(land, shape, query),
    ...(shape.mount === "wall" ? againstWalls(land, shape, query, rng) : []),
    ...besideFurniture(land, shape, query, rng),
  ]
    .sort((a, b) => away(a) - away(b))
    .slice(0, HIDE_MAX_CANDIDATES);
  const cheap: Scored[] = [];
  for (const site of candidates) {
    if (
      query.leaving &&
      Math.hypot(site.x - query.leaving.x, site.z - query.leaving.z) < HIDE_MOVE_AWAY
    ) {
      continue;
    }
    if (!fits(terrain, land, shape, site)) continue;
    const kind = ownKindAround(land, shape, query.type, site);
    const travel = away(site) / Math.max(query.radius, query.maxPath);
    cheap.push({
      ...site,
      score:
        (HIDE_WEIGHT_SAME_TYPE * Math.min(kind.count, HIDE_SAME_TYPE_CAP)) / HIDE_SAME_TYPE_CAP +
        (kind.aligned ? HIDE_WEIGHT_ALIGNED : 0) +
        HIDE_WEIGHT_MOUNT * mountFit(land, shape, site) +
        HIDE_WEIGHT_EXITS * exits(terrain, site) -
        HIDE_WEIGHT_TRAVEL * travel,
    });
  }
  cheap.sort((a, b) => b.score - a.score);
  const spawns = terrain.map.spawnPoints.hunters.map((p) => viewerAt(p, BOT_VISION_RANGE));
  const threats = query.threats.map((p) => viewerAt(p, BOT_VISION_RANGE));
  return cheap
    .slice(0, HIDE_SCORED_CANDIDATES)
    .map((site) => {
      const body: Body = { x: site.x, y: 0, z: site.z, yaw: site.yaw, extent: shape.extent };
      return {
        ...site,
        score: Math.max(
          HIDE_SCORE_FLOOR,
          site.score +
            HIDE_WEIGHT_COVER * hiddenFrom(terrain, coverRing(terrain, site), body) +
            HIDE_WEIGHT_SPAWN_COVER * hiddenFrom(terrain, spawns, body) +
            HIDE_WEIGHT_THREAT_COVER * hiddenFrom(terrain, threats, body),
        ),
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Pick where to hide: a draw weighted by score among every spot within
 * {@link HIDE_PICK_SHARE} of the best, so props of one kind do not all take
 * the same spot round after round, then the rest best first, each checked
 * for a walk of at most `maxPath`. Null when none is reachable in
 * {@link HIDE_PICK_ATTEMPTS} tries, or the map does not list the disguise.
 */
export function pickHideSite(
  terrain: Terrain,
  query: HideQuery,
  rng: () => number,
): HideSite | null {
  const ranked = scoreHideSites(terrain, query, rng);
  const best = ranked[0]?.score ?? 0;
  const pool = ranked.filter((site) => site.score >= best * HIDE_PICK_SHARE);
  const rest = ranked.slice(pool.length);
  for (let attempt = 0; attempt < HIDE_PICK_ATTEMPTS; attempt++) {
    const site = pool.length > 0 ? drawWeighted(pool, rng) : rest.shift();
    if (!site) return null;
    const walk = walkDistance(terrain, query.from, site);
    if (walk !== null && walk <= query.maxPath) return { x: site.x, z: site.z, yaw: site.yaw };
  }
  return null;
}

/** Take one site out of `pool`, drawn with a chance in proportion to its score. */
function drawWeighted(pool: Scored[], rng: () => number): Scored {
  const total = pool.reduce((sum, site) => sum + site.score, 0);
  let roll = rng() * total;
  let index = pool.length - 1;
  for (let k = 0; k < pool.length; k++) {
    roll -= pool[k]!.score;
    if (roll <= 0) {
      index = k;
      break;
    }
  }
  return pool.splice(index, 1)[0]!;
}
