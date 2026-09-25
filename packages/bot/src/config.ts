import {
  DEFAULT_PORT,
  DEFAULT_WEAPON,
  FOOTSTEP_HEARING_RADIUS,
  PLAYER_EYE_HEIGHT,
  WEAPONS,
} from "@morphy/shared";

export const CONNECT_TIMEOUT_MS = 8_000;

export const BOT_EYE_HEIGHT = PLAYER_EYE_HEIGHT;
export const BOT_BODY_RADIUS = 0.4;
export const FURNITURE_MIN_RADIUS = 0.3;

export const ARRIVE_EPSILON = 0.45;

export const STUCK_TICK_LIMIT = 6;
export const STUCK_PROGRESS_FRACTION = 0.3;
export const MAX_REPLANS_BEFORE_BLOCKED = 2;
/**
 * Consecutive blocked hide spots a prop will discard before giving up on the
 * catalogue and hiding where it stands. Without a cap, a bot sealed off from
 * every nearby prop re-picks on each blocked-path event, and that event wakes
 * the policy off-cycle, measured at ~6.7x the ordinary decision rate.
 */
export const MAX_HIDE_REPICKS = 4;
/** How far each blocked escape rotates the away-vector before the prop tries again. */
export const FLEE_DEFLECTION_RAD = (2 * Math.PI) / 5;
/**
 * Blocked escape angles a cornered prop tries before it gives up and stands
 * still. A held escape point matters more than the angle: recomputing it every
 * decision made the goal drift past ARRIVE_EPSILON, which reset the reflex's
 * replan counter so a blocked path never latched.
 */
export const MAX_FLEE_DEFLECTIONS = 4;

/**
 * Per-decision chance that a hidden prop with no hunter in sight taunts once it
 * can, lerped by difficulty: at the default a taunt comes some ten seconds after
 * the cooldown, ahead of the forced one but not on the dot.
 */
export const TAUNT_CHANCE_MIN = 0.03;
export const TAUNT_CHANCE_MAX = 0.1;
/**
 * The same with a possible hunter inside the daring radius that has not seen
 * the prop: three times the points for a far likelier capture, so taken rarely.
 */
export const TAUNT_DARING_CHANCE_MIN = 0.01;
export const TAUNT_DARING_CHANCE_MAX = 0.05;

/**
 * Decisions in a row a hunter spends searching with nothing to follow before it
 * sounds its sonar, about five seconds at the decision rate.
 */
export const SONAR_PATIENCE_DECISIONS = 7;

export const HIDE_OFFSET_MIN = 1.2;
export const HIDE_OFFSET_MAX = 2.4;
export const PANIC_RADIUS = 7;
/**
 * In plain sight of a hunter during the hunt, a prop bolts only when it is this
 * close: anywhere further, moving is the one thing that gives a disguise away,
 * so it holds still and lets the hunter guess.
 */
export const PANIC_SEEN_RADIUS = 2;
export const WAYPOINT_MARGIN = 1.5;

/** A contact counts as "watching me" when its aim is within this half-angle cone of the bearing to the bot. */
export const FACING_CONE_COS = Math.cos((35 * Math.PI) / 180);
/** A watched prop freezes (rather than relocating) only when the watcher is within this range. */
export const FREEZE_RADIUS = 20;

export const ENGAGE_RANGE_MIN = 14;
export const ENGAGE_RANGE_MAX = WEAPONS[DEFAULT_WEAPON].range;
export const BOT_FIRE_COOLDOWN_MS = WEAPONS[DEFAULT_WEAPON].cooldownMs;
export const REACTION_MS_MAX = 950;
export const REACTION_MS_MIN = 180;

/**
 * Combat aim is a bounded turn, not a snap: the bot may only rotate toward a
 * target this fast and can fire only once aligned within {@link AIM_TOLERANCE_RAD}.
 * Difficulty lerps the rate: a low-difficulty bot visibly swings its aim around
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

export const BOT_VISION_RANGE = WEAPONS[DEFAULT_WEAPON].range;
export const BOT_HEARING_RADIUS = FOOTSTEP_HEARING_RADIUS;
/** Cell size a contact known only by sound is snapped to, so hearing yields a
 * neighbourhood rather than a point. Sized to a map tile: within earshot a
 * heard contact resolves to one of a handful of cells. */
export const HEARD_POSITION_CELL = 4;
/** How long a bot remembers a sound it heard: long enough for its next few decisions to act on it. */
export const HEARD_SOUND_MEMORY_MS = 3_000;
export const MOVED_RECENTLY_MS = 600;
export const MOVED_RECENTLY_MIN_DIST = 0.3;
/** A disguise turning by more than this in place is seen to move, as a player sees it spin. */
export const MOVED_RECENTLY_MIN_TURN_RAD = 0.2;
/**
 * How long a disguise stays a suspect after it gave itself away (seen moving,
 * changing shape or honking): a player remembers which crate twitched for a
 * few seconds, not for the round.
 */
export const BOT_TELL_WINDOW_MS = 3_000;
/** A honk seen this close to a contact is pinned on it, as a player pins it on the object it came from. */
export const BOT_TELL_MATCH_RADIUS = 0.75;
/**
 * The pace at which a hunter with no suspect spends a shot on a disguise that
 * gave nothing away, lerped by difficulty from the first to the second. Every
 * such shot that hits scenery costs the miss damage a player pays.
 */
export const BOT_PROBE_INTERVAL_MAX_MS = 6_000;
export const BOT_PROBE_INTERVAL_MIN_MS = 2_500;
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
