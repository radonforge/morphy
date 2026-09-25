export const ROOM_NAME = "morphy";

export const DEFAULT_PORT = 2567;
export const COLYSEUS_PROXY_PATH = "/colyseus";
export const STATS_PATH = "/stats";

export const MAX_PLAYERS = 12;
export const MIN_PLAYERS_TO_START = 2;
export const HUNTER_RATIO = 0.25;

export const LOBBY_AUTOSTART_MS = 20_000;
export const BOT_FILL_DELAY_MS = 10_000;
export const BOT_FILL_TARGET = 4;
export const START_COUNTDOWN_MS = 5_000;
export const HIDE_DURATION_MS = 20_000;
export const ROUND_DURATION_MS = 240_000;
export const ROUND_END_MS = 8_000;
export const TAUNT_INTERVAL_MS = 30_000;
export const RECONNECT_WINDOW_MS = 30_000;

export const HUNTER_MAX_HP = 100;
/** A captured prop joins the hunt below full health, so each capture snowballs less. */
export const CONVERTED_HUNTER_HP = 60;
/** HP a hunter wins back per prop captured, capped at {@link HUNTER_MAX_HP}: one pistol miss refunded. */
export const HUNTER_CAPTURE_HEAL = 20;
export const UNTRANSFORMED_PROP_RADIUS = 0.5;
export const UNTRANSFORMED_PROP_HEIGHT = 1.8;

export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE_HEIGHT = 1.6;

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
