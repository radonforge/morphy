import { DEFAULT_PORT, SHOOT_RANGE } from "@webhunt/shared";

export const CONNECT_TIMEOUT_MS = 8_000;

export const BOT_EYE_HEIGHT = 1.6;
export const BOT_BODY_RADIUS = 0.4;
export const FURNITURE_MIN_RADIUS = 0.3;

export const ARRIVE_EPSILON = 0.45;

export const STUCK_TICK_LIMIT = 6;
export const STUCK_PROGRESS_FRACTION = 0.3;
export const MAX_REPLANS_BEFORE_BLOCKED = 2;

export const HIDE_OFFSET_MIN = 1.2;
export const HIDE_OFFSET_MAX = 2.4;
export const PANIC_RADIUS = 7;
export const WAYPOINT_MARGIN = 1.5;

/** A contact counts as "watching me" when its aim is within this half-angle cone of the bearing to the bot. */
export const FACING_CONE_COS = Math.cos((35 * Math.PI) / 180);
/** A watched prop freezes (rather than relocating) only when the watcher is within this range. */
export const FREEZE_RADIUS = 20;

export const ENGAGE_RANGE_MIN = 14;
export const ENGAGE_RANGE_MAX = SHOOT_RANGE;
export const REACTION_MS_MAX = 950;
export const REACTION_MS_MIN = 180;

/**
 * Combat aim is a bounded turn, not a snap: the bot may only rotate toward a
 * target this fast and can fire only once aligned within {@link AIM_TOLERANCE_RAD}.
 * Difficulty lerps the rate — a low-difficulty bot visibly swings its aim around
 * and a strafing player can stay ahead of it, instead of being instantly locked.
 */
export const AIM_TURN_RATE_MIN = 1.6;
export const AIM_TURN_RATE_MAX = 14;
export const AIM_TOLERANCE_RAD = (4 * Math.PI) / 180;

export const NAV_CELL_SIZE = 1.0;
export const NAV_INFLATION_EPS = 0.05;
export const NAV_SNAP_RADIUS_CELLS = 8;
export const ASTAR_MAX_EXPANDED = 8_000;
export const PATH_REPLAN_MS = 500;
export const TARGET_MOVE_REPLAN_CELLS = 1;

/** Substring identifying the server's doorway gate tiles, from which the bot derives walkable doorways. */
export const DOORWAY_TILE_MARKER = "gate";

export const MAX_TICK_SECONDS = 0.25;
export const PATROL_PICK_ATTEMPTS = 8;

export const DECIDE_INTERVAL_MS = 700;
export const DECIDE_TIMEOUT_MS = 500;

export const BOT_VISION_RANGE = SHOOT_RANGE;
export const BOT_HEARING_RADIUS = 12;
export const MOVED_RECENTLY_MS = 600;
export const MOVED_RECENTLY_MIN_DIST = 0.3;
export const NEARBY_PROP_RADIUS = 12;

export const DEFAULT_BOT_COUNT = 3;
export const DEFAULT_DIFFICULTY = 0.6;
export const MIN_DIFFICULTY = 0;
export const MAX_DIFFICULTY = 1;

export const BOT_NAMES: readonly string[] = [
  "Zara",
  "Echo",
  "Nova",
  "Pixel",
  "Rusty",
  "Volt",
  "Mimi",
  "Cosmo",
  "Bolt",
  "Glitch",
  "Turbo",
  "Vega",
];

export function defaultServerUrl(): string {
  const fromEnv = process.env.BOT_SERVER_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  return `ws://127.0.0.1:${port}`;
}

export function clampDifficulty(value: number): number {
  return Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * Math.min(1, Math.max(0, t));
}
