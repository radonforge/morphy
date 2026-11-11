import {
  DEFAULT_PORT,
  DEFAULT_WEAPON,
  FOOTSTEP_HEARING_RADIUS,
  INPUT_SEND_RATE_MS,
  PLAYER_EYE_HEIGHT,
  WEAPONS,
} from "@morphy/shared";

export const CONNECT_TIMEOUT_MS = 8_000;

export const BOT_EYE_HEIGHT = PLAYER_EYE_HEIGHT;
export const BOT_BODY_RADIUS = 0.4;
export const FURNITURE_MIN_RADIUS = 0.3;

export const ARRIVE_EPSILON = 0.45;
/** A honk of the bot's own disguise this soon after it pressed the taunt key is that taunt, not a forced one. */
export const OWN_TAUNT_ECHO_MS = 1_000;
/** How close a prop gets to the exact spot it hides on before it counts as there. */
export const HIDE_ARRIVE_EPSILON = 0.1;

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

/**
 * How far from where it stands a prop looks for a spot: while the hunters are
 * blind, and when it hides again during the hunt, on foot and closer.
 */
export const HIDE_SEARCH_RADIUS = 30;
export const REHIDE_SEARCH_RADIUS = 14;
/** The longest walk a prop takes to hide again during the hunt. */
export const REHIDE_MAX_PATH = 18;
/** The share of the hide phase left that the walk to a spot may take, the rest kept for turning and slack. */
export const HIDE_TRAVEL_SHARE = 0.6;
/** Gaps a prop leaves beside an object of its own kind, as a row or a cluster would. */
export const HIDE_ROW_GAPS: readonly number[] = [0.25, 0.6];
/** How far from a wall a wall-mounted disguise looks for one to back onto, and the gap it leaves. */
export const HIDE_WALL_REACH = 3;
export const HIDE_WALL_GAP = 0.05;
/** Ground points sampled for spots beside a wall or other furniture, on top of those beside its own kind. */
export const HIDE_SAMPLES = 24;
/** How much a disguise may overlap furniture or a wall by before the spot counts as inside it. */
export const HIDE_OVERLAP_TOLERANCE = 0.05;
/** The objects of its own kind within this radius a disguise is judged against, the radius the sim counts in. */
export const HIDE_SAME_TYPE_RADIUS = 3;
/** Same-type objects that count toward a spot's score; more are no more convincing. */
export const HIDE_SAME_TYPE_CAP = 3;
/** The yaw within which a disguise is turned like an object beside it, its symmetry allowed for. */
export const HIDE_ALIGN_TOLERANCE_RAD = (10 * Math.PI) / 180;
/** A wall-mounted disguise counts as backed onto a wall when one stands within this of its back. */
export const HIDE_WALL_BACK_REACH = 0.3;
/** A surface object counts as beside furniture when one stands within this. */
export const HIDE_SURFACE_REACH = 0.8;
/** The ring of open ground a spot's cover is judged from: its radius and the bearings on it. */
export const HIDE_COVER_RADIUS = 8;
export const HIDE_COVER_BEARINGS = 8;
/** A spot has a way out along a bearing when the ground this far along it is walkable in a straight line. */
export const HIDE_EXIT_RADIUS = 2.5;
export const HIDE_EXIT_BEARINGS = 8;
export const HIDE_EXITS_WANTED = 3;
/** Candidates kept, nearest first, before any is checked against the scenery: the bound on a pick's cost. */
export const HIDE_MAX_CANDIDATES = 96;
/** Candidates judged for cover, the best by everything cheaper first. */
export const HIDE_SCORED_CANDIDATES = 16;
/** Every candidate scoring within this share of the best is in the draw, so spots do not repeat. */
export const HIDE_PICK_SHARE = 0.75;
/** Candidates drawn and found unreachable before a prop gives up and hides where it stands. */
export const HIDE_PICK_ATTEMPTS = 6;
/** A new spot keeps at least this far from the one a prop gives up. */
export const HIDE_MOVE_AWAY = 3;
/** What each quality of a spot is worth to its score. */
export const HIDE_WEIGHT_SAME_TYPE = 3;
export const HIDE_WEIGHT_ALIGNED = 1.5;
export const HIDE_WEIGHT_MOUNT = 1;
export const HIDE_WEIGHT_COVER = 2;
export const HIDE_WEIGHT_SPAWN_COVER = 2;
export const HIDE_WEIGHT_THREAT_COVER = 2;
export const HIDE_WEIGHT_EXITS = 0.5;
export const HIDE_WEIGHT_TRAVEL = 0.5;
/** The least a spot scores, so a draw weighted by score always has something to draw. */
export const HIDE_SCORE_FLOOR = 0.01;

/** A hunter in sight aiming at a prop this close makes it run: holding still at point blank only waits for the shot. */
export const POINT_BLANK_RADIUS = 1.8;
/**
 * A hunter kept in sight this long that has closed this far on the prop, and
 * is now within the radius looking its way, is after it: the prop runs.
 */
export const PURSUIT_MS = 2_000;
export const PURSUIT_CLOSING = 3;
export const PURSUIT_RADIUS = 6;
/**
 * A prop that moved or honked with a hunter in sight looking its way was
 * seen doing it: for this long, a hunter in sight within the radius makes it
 * run rather than freeze into the suspect it just made itself.
 */
export const EXPOSED_MS = 2_500;
export const EXPOSED_RADIUS = 12;
/** A sonar pulse this close is a hunter on top of the prop: it runs. */
export const SONAR_FLEE_RADIUS = 5;
/** How long a prop keeps a hunter it lost sight of, or a pulse it heard, among the threats it runs and hides from. */
export const THREAT_MEMORY_MS = 4_000;
/** How long an escape runs before the prop may stop, drawn between the two. */
export const ESCAPE_COMMIT_MIN_MS = 1_500;
export const ESCAPE_COMMIT_MAX_MS = 3_000;
/**
 * A hunter this close, seen within the clear time, keeps an escaping prop
 * running past its commitment: stopping in view, or just round the corner it
 * is coming round, only makes a still suspect.
 */
export const ESCAPE_KEEP_RADIUS = 14;
export const ESCAPE_CLEAR_MS = 1_500;
/** How long a prop that stopped running waits with no hunter in sight before it hides again, drawn between the two. */
export const REHIDE_CALM_MIN_MS = 1_000;
export const REHIDE_CALM_MAX_MS = 2_000;
/** The rings and bearings an escape waypoint is drawn from. */
export const ESCAPE_DISTANCES: readonly number[] = [4, 7, 10];
export const ESCAPE_BEARINGS = 12;
/** An escape never runs past a threat closer than this to its line. */
export const ESCAPE_CROSSING_RADIUS = 2.5;
/** Waypoints with no straight run to them tried by planned path before the prop is cornered. */
export const ESCAPE_ROUTE_ATTEMPTS = 3;
/** A planned path to a waypoint may be at most this many times the straight distance. */
export const ESCAPE_DETOUR_FACTOR = 2;
/** How long a prop that found nowhere to run waits before it looks again, which bounds what a cornered prop spends. */
export const ESCAPE_RETRY_MS = 1_000;
/** A waypoint a prop gave up on, blocked or reached under pressure, is not drawn again within this. */
export const ESCAPE_AVOID_RADIUS = 1.5;
/** What breaking sight, getting away and a short run are each worth to an escape waypoint. */
export const ESCAPE_WEIGHT_HIDDEN = 3;
export const ESCAPE_WEIGHT_GAIN = 1.5;
export const ESCAPE_WEIGHT_TRAVEL = 0.5;
/** Decoys a prop keeps back for running from a hunter at point blank. */
export const DECOY_RESERVE = 1;
/** A prop counts as on its hiding spot, where a decoy it drops stays believable, within this of where it settled. */
export const DECOY_SPOT_RADIUS = 1;

/**
 * When a hidden prop taunts of its own accord: first some time into the hunt,
 * drawn between the two, then a draw between the gaps after each taunt's
 * cooldown, always ahead of the room's forced one. The clock is the hunt's,
 * never the decision count, so how often the policy is asked does not change
 * how often it honks.
 */
export const FIRST_TAUNT_MIN_MS = 8_000;
export const FIRST_TAUNT_MAX_MS = 15_000;
export const TAUNT_GAP_MIN_MS = 2_000;
export const TAUNT_GAP_MAX_MS = 12_000;
/**
 * The chance a taunt that falls due with a hunter known to be close is taken
 * anyway, lerped by difficulty: three times the points for a far likelier
 * capture. One not taken waits this long before it is weighed again.
 */
export const TAUNT_DARING_CHANCE_MIN = 0.15;
export const TAUNT_DARING_CHANCE_MAX = 0.4;
export const TAUNT_POSTPONE_MS = 3_000;

/**
 * Decisions in a row a hunter spends searching with nothing to follow before it
 * sounds its sonar, about five seconds at the decision rate.
 */
export const SONAR_PATIENCE_DECISIONS = 7;

export const WAYPOINT_MARGIN = 1.5;

/** A contact counts as "watching me" when its aim is within this half-angle cone of the bearing to the bot. */
export const FACING_CONE_COS = Math.cos((35 * Math.PI) / 180);

export const ENGAGE_RANGE_MIN = 14;
export const ENGAGE_RANGE_MAX = WEAPONS[DEFAULT_WEAPON].range;
export const BOT_FIRE_COOLDOWN_MS = WEAPONS[DEFAULT_WEAPON].cooldownMs;
export const REACTION_MS_MAX = 950;
export const REACTION_MS_MIN = 180;

/**
 * Spread of the reaction time drawn each time a hunter acquires a new target,
 * as a fraction of the difficulty's mean, and the floor no draw goes under: a
 * player is sometimes quick and sometimes slow on the trigger, never instant.
 */
export const REACTION_JITTER = 0.3;
export const REACTION_FLOOR_FRACTION = 0.5;
/**
 * The extra beat a hunter takes past the fire cooldown before its next shot at
 * the same target, drawn per shot as the absolute value of a normal draw of
 * this spread: a player does not fire on the cooldown's exact frame.
 */
export const AIM_FOLLOW_UP_JITTER_MS = 150;

/**
 * Combat aim is a bounded turn, not a snap: the bot may only rotate toward a
 * target this fast. Difficulty lerps the rate: a low-difficulty bot visibly
 * swings its aim around and a strafing player can stay ahead of it, instead of
 * being instantly locked.
 */
export const AIM_TURN_RATE_MIN = 1.6;
export const AIM_TURN_RATE_MAX = 14;
/**
 * The crosshair never sits dead on a target: it wanders around it with this
 * standard deviation, lerped by difficulty, and drifts back over
 * {@link AIM_DRIFT_TAU_S}, the slow hand-shake of a player tracking something.
 */
export const AIM_DRIFT_MAX_RAD = (2 * Math.PI) / 180;
export const AIM_DRIFT_MIN_RAD = (0.4 * Math.PI) / 180;
export const AIM_DRIFT_TAU_S = 0.4;
/**
 * Now and then the flick onto a new target carries past it by up to this
 * fraction of the turn, and the aim comes back from the far side, at the
 * latest once the reaction time is up.
 */
export const AIM_OVERSHOOT_CHANCE = 0.35;
export const AIM_OVERSHOOT_MAX_FRACTION = 0.25;
/** Below this the aim counts as having reached the far end of an overshoot. */
export const AIM_OVERSHOOT_SETTLE_RAD = (1 * Math.PI) / 180;
/**
 * The trigger is a judgement on how far the crosshair sits off the target: the
 * chance of firing on a tick falls as a Gaussian of the aim error with this
 * width, so a bot fires on a near miss now and then and almost never far off.
 */
export const AIM_FIRE_ERROR_RAD = (3 * Math.PI) / 180;
/**
 * The tick the trigger chance is stated for: a bot ticking at another rate
 * scales its chance to match, so how readily it fires never depends on how
 * often it is asked.
 */
export const AIM_TRIGGER_TICK_S = INPUT_SEND_RATE_MS / 1_000;
/**
 * The standard deviation of the error a shot leaves the crosshair with, drawn
 * per shot and never seen by the bot before it fires: a base, plus a share per
 * m/s the target moves across the line of sight, per metre of distance and per
 * m/s the hunter itself was moving. Difficulty scales the sum from the first
 * scale to the second, so a running prop is a hard shot for every bot and a
 * near-impossible one for a weak bot.
 */
export const AIM_SPREAD_BASE_RAD = (1.2 * Math.PI) / 180;
export const AIM_SPREAD_PER_LATERAL_SPEED_RAD = (0.7 * Math.PI) / 180;
export const AIM_SPREAD_PER_METER_RAD = (0.05 * Math.PI) / 180;
export const AIM_SPREAD_PER_SELF_SPEED_RAD = (0.4 * Math.PI) / 180;
export const AIM_SPREAD_SCALE_MAX = 1.8;
export const AIM_SPREAD_SCALE_MIN = 0.6;
/** Vertical error is this share of the horizontal: a player's aim slides sideways more than up and down. */
export const AIM_PITCH_SPREAD_SHARE = 0.5;
/** How quickly a velocity seen (the target's, or the bot's own) settles to a new value. */
export const AIM_VELOCITY_SMOOTHING_S = 0.2;

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
/**
 * The vertical field of view a player's camera opens at by default (the
 * client's `FIELD_OF_VIEW_DEFAULT`) and the screen shape it is judged on. A
 * hunter bot sees what a hunter player sees at those settings: a horizontal
 * cone of the half-angle a perspective camera derives from them, about 43
 * degrees either side of where it looks.
 */
export const HUNTER_VERTICAL_FOV_DEG = 55;
export const REFERENCE_ASPECT = 16 / 9;
export const HUNTER_VIEW_HALF_ANGLE_RAD = Math.atan(
  Math.tan((HUNTER_VERTICAL_FOV_DEG * Math.PI) / 360) * REFERENCE_ASPECT,
);
/**
 * A hunter with nothing in its sights glances aside now and then, the way a
 * player searching a room looks around: every so often (a draw between the
 * two intervals) it turns its view this far off the way it walks (a draw
 * between the two angles), holds it, and turns back, never faster than
 * {@link GLANCE_TURN_RATE} radians a second.
 */
export const GLANCE_INTERVAL_MIN_MS = 1_500;
export const GLANCE_INTERVAL_MAX_MS = 3_500;
export const GLANCE_ANGLE_MIN_RAD = (50 * Math.PI) / 180;
export const GLANCE_ANGLE_MAX_RAD = (110 * Math.PI) / 180;
export const GLANCE_HOLD_MS = 700;
export const GLANCE_TURN_RATE = 6;
/**
 * Where on a body the bot looks for it: its middle, near its top
 * ({@link SIGHT_SAMPLE_TOP_SHARE} of its height) and both sides at mid height
 * ({@link SIGHT_SAMPLE_EDGE_SHARE} of the way from its middle to the edge of the
 * model it renders as), so a disguise half behind a cabinet is still seen by
 * the half that shows.
 */
export const SIGHT_SAMPLE_TOP_SHARE = 0.85;
export const SIGHT_SAMPLE_EDGE_SHARE = 0.8;
/** Side of the grid cells sight blockers are bucketed in, so a sightline tests only what stands along it. */
export const SIGHT_CELL_SIZE = 4;
export const BOT_HEARING_RADIUS = FOOTSTEP_HEARING_RADIUS;
/** Cell size a contact known only by sound is snapped to, so hearing yields a
 * neighbourhood rather than a point. Sized to a map tile: within earshot a
 * heard contact resolves to one of a handful of cells. */
export const HEARD_POSITION_CELL = 4;
/** How long a bot remembers a sound it heard: long enough for its next few decisions to act on it. */
export const HEARD_SOUND_MEMORY_MS = 3_000;
/**
 * How long a step keeps a contact moving: a disguise seen to step or spin
 * within this is `movedRecently`, and one whose rustle carried within this
 * is heard where it went.
 */
export const MOVED_RECENTLY_MS = 600;
export const MOVED_RECENTLY_MIN_DIST = 0.3;
/** A disguise turning by more than this in place is seen to move, as a player sees it spin. It makes no sound. */
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
/**
 * How soon a hunter tests again after a probe that went past what it tested:
 * a miss says nothing about the object, so a player shoots it again once the
 * crosshair is back on it rather than waiting out a whole probe interval.
 */
export const BOT_PROBE_RETRY_MS = 1_500;

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

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "[::1]"]);
const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const TRAILING_DOT = /\.$/;

/** Whether a server URL points at this machine: full vision is refused against any other server. */
export function isLoopbackServerUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const hostname = new URL(url).hostname.replace(TRAILING_DOT, "");
  return LOOPBACK_HOSTNAMES.has(hostname) || LOOPBACK_IPV4.test(hostname);
}

export function clampDifficulty(value: number): number {
  return Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * Math.min(1, Math.max(0, t));
}
