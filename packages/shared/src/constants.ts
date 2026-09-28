export const ROOM_NAME = "morphy";

export const DEFAULT_PORT = 2567;
export const COLYSEUS_PROXY_PATH = "/colyseus";
export const STATS_PATH = "/stats";

export const MAX_PLAYERS = 12;
export const MIN_PLAYERS_TO_START = 2;
export const HUNTER_RATIO = 0.25;

export const LOBBY_AUTOSTART_MS = 8_000;
export const BOT_FILL_DELAY_MS = 2_000;
export const BOT_FILL_TARGET = 4;
export const START_COUNTDOWN_MS = 3_000;
export const HIDE_DURATION_MS = 15_000;
export const ROUND_DURATION_MS = 180_000;
export const ROUND_END_MS = 5_000;
/** A prop that has not taunted for this long during the hunt is made to, for no points. */
export const TAUNT_INTERVAL_MS = 30_000;
/** How far apart the props' first forced taunts of a hunt are spread, so they never honk in unison. */
export const TAUNT_FORCED_STAGGER_MS = 10_000;
/** How often the room looks for a prop overdue a forced taunt. */
export const TAUNT_CHECK_MS = 1_000;
export const TAUNT_COOLDOWN_MS = 10_000;
export const TAUNT_POINTS = 1;
/** Points for a taunt with a live hunter within {@link TAUNT_DARING_RADIUS}. */
export const TAUNT_DARING_POINTS = 3;
export const TAUNT_DARING_RADIUS = 10;
/** Beyond this distance a taunt is not heard, by a player's client or by a bot. */
export const TAUNT_HEARING_RADIUS = 40;

/** A hunter's sonar makes every live prop within this radius honk; decoys stay silent. */
export const SONAR_RADIUS = 12;
export const SONAR_COOLDOWN_MS = 30_000;
/** The pulse itself carries this far, so a prop hears a hunter sounding close by. */
export const SONAR_HEARING_RADIUS = SONAR_RADIUS * 2;
export const RECONNECT_WINDOW_MS = 30_000;

export const HUNTER_MAX_HP = 100;
/** A captured prop joins the hunt below full health, so each capture snowballs less. */
export const CONVERTED_HUNTER_HP = 60;
/**
 * HP a hunter wins back per prop captured, capped at {@link HUNTER_MAX_HP}: half
 * a health bar, so a find pays for the wrong guesses that led to it.
 */
export const HUNTER_CAPTURE_HEAL = 50;
/**
 * How long a hunter who ran out of HP waits before rejoining the hunt, at
 * {@link CONVERTED_HUNTER_HP}: long enough to sting, never long enough to
 * spectate a round away.
 */
export const HUNTER_RESPAWN_MS = 6_000;
export const UNTRANSFORMED_PROP_RADIUS = 0.5;
export const UNTRANSFORMED_PROP_HEIGHT = 1.8;

export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE_HEIGHT = 1.6;
/**
 * How far a moving player is heard: a remote prop's rustle fades out here for a
 * player, and a bot senses any mover within it. One number for both, so moving
 * is the same risk whoever is listening.
 */
export const FOOTSTEP_HEARING_RADIUS = 12;

export const MOVE_SPEED = 5;
export const RUN_MULTIPLIER_HUNTER = 1.7;
export const RUN_MULTIPLIER_PROP = 1.5;
export const MOVE_ACCEL = 40;
export const MOVE_DECEL = 50;
export const AIR_CONTROL = 0.35;
export const JUMP_SPEED = 6;
export const GRAVITY = 20;
export const JUMP_BUFFER_MS = 120;
export const JUMP_RELEASE_GRAVITY_MULT = 2.4;
export const FALL_GRAVITY_MULT = 1.35;

export const PROP_TURN_SPEED = 2.4;
export const PROP_TURN_SNAP = Math.PI / 2;
export const PROP_TURN_TAP_MS = 200;

export const REROLL_BUDGET = 2;
export const DECOY_BUDGET = 3;
export const DECOY_COOLDOWN_MS = 1_500;
/** Share of a weapon's miss damage a shot pays when all it breaks is a decoy. */
export const DECOY_MISS_DAMAGE_FACTOR = 0.5;

export const PING_INTERVAL_MS = 2_000;
export const PING_MAX_MS = 999;

export const PATCH_RATE_MS = 50;
export const INPUT_SEND_RATE_MS = 50;
export const INPUT_IDLE_EPSILON = 0.001;
export const MAX_CLIENT_MESSAGES_PER_SECOND = 60;

export const MAX_NAME_LENGTH = 16;
/** Stands in for a player who never named themselves, on the stage and in the room alike. */
export const DEFAULT_PLAYER_NAME = "Player";
export const MAX_CHAT_LENGTH = 200;

export const PARTY_CODE_LENGTH = 5;
export const PARTY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Radius of a player's body in the level checks; the client's `PLAYER_RADIUS` in `movement.ts`. */
export const LEVEL_BODY_RADIUS = 0.4;
/** Tallest collision box a body walks over in the level checks; the client's `STEP_HEIGHT`. */
export const LEVEL_STEP_HEIGHT = 0.35;
/** Side of one sample cell of the level checks' reachability and sightline grid, in metres. */
export const LEVEL_SAMPLE_CELL = 0.5;
/** Penetration below which two footprints count as touching rather than overlapping. */
export const LEVEL_OVERLAP_TOLERANCE = 0.05;
/** Width, along the wall, of the floor kept clear on each side of a doorway. */
export const LEVEL_DOOR_CLEARANCE_WIDTH = 2;
/** Depth, away from the wall, of the floor kept clear on each side of a doorway. */
export const LEVEL_DOOR_CLEARANCE_DEPTH = 1.5;
/** A pocket of floor no hunter can reach is reported once it covers this many square metres. */
export const LEVEL_UNREACHABLE_MIN_AREA = 1;
/** An object at least this tall hides a crouching prop, so it blocks a sightline. */
export const LEVEL_SIGHT_BLOCK_HEIGHT = 1;
/** A room whose longest clear sightline exceeds this many metres leaves props nowhere to hide. */
export const LEVEL_SIGHTLINE_MAX = 24;
/** A room with fewer objects of a repeated type than this offers too few disguises. */
export const LEVEL_MIN_DISGUISES = 3;
