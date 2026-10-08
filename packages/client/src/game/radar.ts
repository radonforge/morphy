import {
  type MapDefinition,
  MINIMAP_MOVE_MIN_DIST,
  MINIMAP_MOVE_WINDOW_MS,
  MINIMAP_RADIUS,
  type Role,
} from "@morphy/shared";

/** A jump this large between two samples is a respawn or a teleport, not a step. */
const TELEPORT_SKIP = 4;
/** A collider whose top is this low is the ground slab under the map, not something standing on it. */
const GROUND_SLAB_TOP = 0.01;
/** Colliders thinner than this on both sides (lamp poles, posts) are left off the plan. */
const MIN_BLOCK_SIDE = 1;

/** Where a player stood when it last stepped, and when, as the minimap judges motion. */
export interface MotionTrack {
  x: number;
  z: number;
  steppedAt: number | null;
}

/**
 * Advance one player's motion track to where it now stands. A step is a move
 * of more than {@link MINIMAP_MOVE_MIN_DIST} from where it last stepped, so
 * the trickle of synced positions a turn or a jitter makes never counts; a
 * jump past {@link TELEPORT_SKIP} re-anchors without counting as a step.
 */
export function trackMotion(
  track: MotionTrack | undefined,
  x: number,
  z: number,
  now: number,
): MotionTrack {
  if (!track) return { x, z, steppedAt: null };
  const moved = Math.hypot(x - track.x, z - track.z);
  if (moved > TELEPORT_SKIP) return { x, z, steppedAt: null };
  if (moved > MINIMAP_MOVE_MIN_DIST) return { x, z, steppedAt: now };
  return track;
}

/** How long ago the player last stepped, if it did within {@link MINIMAP_MOVE_WINDOW_MS}. */
export function stepAge(track: MotionTrack | undefined, now: number): number | null {
  if (!track || track.steppedAt === null) return null;
  const age = now - track.steppedAt;
  return age <= MINIMAP_MOVE_WINDOW_MS ? age : null;
}

/** The fields of a player the minimap reads. */
export interface MinimapPlayer {
  x: number;
  z: number;
  role: Role;
  alive: boolean;
}

/** A hunter drawn on the minimap, and how long ago it stepped (null when standing still). */
export interface MinimapBlip {
  id: string;
  x: number;
  z: number;
  stepAgeMs: number | null;
}

/**
 * Who the local player sees on the minimap. A prop sees a live hunter only
 * while it moves and within {@link MINIMAP_RADIUS}, so a still hunter can lie
 * in ambush; a hunter sees its live teammates within the radius, moving or
 * not. Nobody ever sees a prop, a prop included: an infected prop would carry
 * the hiding spots over to the hunters.
 */
export function minimapBlips(
  players: Iterable<readonly [string, MinimapPlayer]>,
  localId: string,
  localRole: Role,
  center: { x: number; z: number },
  tracks: ReadonlyMap<string, MotionTrack>,
  now: number,
): MinimapBlip[] {
  const blips: MinimapBlip[] = [];
  for (const [id, player] of players) {
    if (id === localId || player.role !== "hunter" || !player.alive) continue;
    if (Math.hypot(player.x - center.x, player.z - center.z) > MINIMAP_RADIUS) continue;
    const age = stepAge(tracks.get(id), now);
    if (localRole === "prop" && age === null) continue;
    blips.push({ id, x: player.x, z: player.z, stepAgeMs: age });
  }
  return blips;
}

/**
 * Where a world point lands on the minimap, in pixels from its centre, for a
 * player at `center`: north (-Z) is always up and east (+X) right.
 */
export function worldToMinimap(
  center: { x: number; z: number },
  x: number,
  z: number,
  pxPerMetre: number,
): { x: number; y: number } {
  return { x: (x - center.x) * pxPerMetre, y: (z - center.z) * pxPerMetre };
}

/**
 * The clockwise rotation, in radians, of the self arrow for a camera yaw. The
 * camera looks along (-sin yaw, -cos yaw), so yaw 0 faces north.
 */
export function arrowRotation(yaw: number): number {
  return -yaw;
}

export type PlanKind = "floor" | "paving" | "grass" | "yard" | "block";

/** One axis-aligned rectangle of the plan, centred on `x`/`z`, `w` wide along x and `d` deep along z. */
export interface PlanRect {
  x: number;
  z: number;
  w: number;
  d: number;
  kind: PlanKind;
}

/**
 * The static plan of a map as rectangles in paint order: open ground first
 * (an indoor map's floor cells; an outdoor map's whole bounds, then its
 * ground patches), then the
 * solid blocks over it (walls, building lots). The ground slab under the map
 * and colliders thinner than {@link MIN_BLOCK_SIDE} (lamp poles) are left
 * off, as is furniture, which a plan would hand the hiding spots away with.
 */
export function minimapPlan(map: MapDefinition): PlanRect[] {
  const rects: PlanRect[] = [];
  if (!map.ceiling) {
    const { min, max } = map.bounds;
    rects.push({
      x: (min.x + max.x) / 2,
      z: (min.z + max.z) / 2,
      w: max.x - min.x,
      d: max.z - min.z,
      kind: "floor",
    });
  }
  for (const panel of map.ceiling ?? []) {
    rects.push({ x: panel.x, z: panel.z, w: panel.size, d: panel.size, kind: "floor" });
  }
  for (const patch of map.ground ?? []) {
    rects.push({ x: patch.x, z: patch.z, w: patch.w, d: patch.d, kind: patch.kind });
  }
  for (const collider of map.colliders) {
    if (collider.position.y + collider.size.y / 2 <= GROUND_SLAB_TOP) continue;
    if (Math.max(collider.size.x, collider.size.z) < MIN_BLOCK_SIDE) continue;
    rects.push({
      x: collider.position.x,
      z: collider.position.z,
      w: collider.size.x,
      d: collider.size.z,
      kind: "block",
    });
  }
  return rects;
}
