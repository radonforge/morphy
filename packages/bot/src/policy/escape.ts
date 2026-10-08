import {
  BOT_EYE_HEIGHT,
  BOT_VISION_RANGE,
  ESCAPE_AVOID_RADIUS,
  ESCAPE_BEARINGS,
  ESCAPE_CROSSING_RADIUS,
  ESCAPE_DETOUR_FACTOR,
  ESCAPE_DISTANCES,
  ESCAPE_ROUTE_ATTEMPTS,
  ESCAPE_WEIGHT_GAIN,
  ESCAPE_WEIGHT_HIDDEN,
  ESCAPE_WEIGHT_TRAVEL,
  NAV_SNAP_RADIUS_CELLS,
} from "../config";
import { cellCenter, isBlocked, nearestFreeCell, type Point2, worldToCell } from "../nav/grid";
import { hasLineOfSight } from "../nav/path";
import { type Body, sightOf } from "../perception";
import type { Terrain } from "../terrain";
import { walkDistance } from "./hiding";

/** What a prop running for cover knows: where it is, what it wears, and where the threats it perceived are. */
export interface EscapeQuery {
  from: Point2;
  type: string;
  /** Where hunters were last seen or heard: perceived positions, never where anyone is now. */
  threats: readonly Point2[];
  /** Waypoints it already gave up on, blocked or reached with a hunter still on it. */
  avoid: readonly Point2[];
}

interface Candidate extends Point2 {
  score: number;
  straight: boolean;
  distance: number;
}

const FULL_TURN = 2 * Math.PI;
const MAX_DISTANCE = Math.max(...ESCAPE_DISTANCES);
const CROSSING_EPSILON = 1e-6;

/** The distance from `p` to the segment a→b. */
function toSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/**
 * Whether running from `from` to `to` takes the prop past `threat`: closer
 * to it than {@link ESCAPE_CROSSING_RADIUS} somewhere along the way, and
 * closer than it starts. Running straight away from a hunter at point blank
 * starts within the radius, and is no crossing.
 */
function runsPast(threat: Point2, from: Point2, to: Point2): boolean {
  const closest = toSegment(threat, from, to);
  const start = Math.hypot(threat.x - from.x, threat.z - from.z);
  return closest < ESCAPE_CROSSING_RADIUS && closest < start - CROSSING_EPSILON;
}

/**
 * The waypoint a cornered or spotted prop runs to. Points on rings round it
 * are scored by how many of the threats it perceived would no longer see it
 * there, how much further from them it gets, and how short the run is, so a
 * prop with no cover in reach makes one long run, not a string of short hops
 * that each end in a stop; a run
 * that passes close to a threat is never taken. A point it can run to in a
 * straight line is preferred; failing those, the best few are tried by a
 * planned path, so a prop backed against furniture slips out sideways round
 * it instead of trying blind angles. Null when it is boxed in.
 */
export function pickEscape(terrain: Terrain, query: EscapeQuery): Point2 | null {
  const { grid } = terrain;
  const startCell = nearestFreeCell(
    grid,
    worldToCell(grid, query.from.x, query.from.z),
    NAV_SNAP_RADIUS_CELLS,
  );
  if (!startCell) return null;
  const start = cellCenter(grid, startCell);
  const extent = terrain.extentOf(query.type);
  const candidates: Candidate[] = [];
  for (const distance of ESCAPE_DISTANCES) {
    for (let k = 0; k < ESCAPE_BEARINGS; k++) {
      const bearing = (FULL_TURN * k) / ESCAPE_BEARINGS;
      const p = {
        x: query.from.x + Math.sin(bearing) * distance,
        z: query.from.z + Math.cos(bearing) * distance,
      };
      const cell = worldToCell(grid, p.x, p.z);
      if (isBlocked(grid, cell.i, cell.j)) continue;
      if (query.avoid.some((a) => Math.hypot(a.x - p.x, a.z - p.z) < ESCAPE_AVOID_RADIUS)) continue;
      if (query.threats.some((t) => runsPast(t, query.from, p))) continue;
      const body: Body = { x: p.x, y: 0, z: p.z, yaw: 0, extent };
      let hidden = 0;
      let gain = 0;
      for (const threat of query.threats) {
        const eye = {
          x: threat.x,
          y: BOT_EYE_HEIGHT,
          z: threat.z,
          heading: 0,
          halfAngle: null,
          range: BOT_VISION_RANGE,
        };
        if (!sightOf(terrain.sight, eye, body)) hidden++;
        gain +=
          Math.hypot(p.x - threat.x, p.z - threat.z) -
          Math.hypot(query.from.x - threat.x, query.from.z - threat.z);
      }
      const count = Math.max(1, query.threats.length);
      candidates.push({
        ...p,
        distance,
        straight: hasLineOfSight(grid, start.x, start.z, p.x, p.z),
        score:
          (ESCAPE_WEIGHT_HIDDEN * hidden) / count +
          ESCAPE_WEIGHT_GAIN * Math.max(-1, Math.min(1, gain / count / MAX_DISTANCE)) -
          (ESCAPE_WEIGHT_TRAVEL * distance) / MAX_DISTANCE,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const straight = candidates.find((c) => c.straight);
  if (straight) return { x: straight.x, z: straight.z };
  for (const candidate of candidates.slice(0, ESCAPE_ROUTE_ATTEMPTS)) {
    const walk = walkDistance(terrain, query.from, candidate);
    if (walk !== null && walk <= candidate.distance * ESCAPE_DETOUR_FACTOR) {
      return { x: candidate.x, z: candidate.z };
    }
  }
  return null;
}
