import type { MapBounds } from "./map";
import type { Phase, Role } from "./protocol";

/**
 * The two-level agent contract shared by the server and the bot. A policy emits
 * a declarative {@link Intent} (*what* to achieve) at low frequency; the
 * bot's synchronous reflex decides *how/when* (pathfinding, aim, fire cooldown)
 * from a compact {@link Observation}.
 *
 * Types only. Both sides run in the same process (the server drives its
 * room-filling bots through `@morphy/bot/brain`), so an `Intent` is never
 * serialised and never crosses a trust boundary. The validators that used to
 * live here guarded output from an out-of-process policy; that policy does not
 * exist, and the game is multiplayer-first, so they were removed rather than
 * kept warm. Reinstate them from git history the day a policy speaks over a
 * wire.
 */

/** Fields every {@link Intent} carries regardless of `kind`. */
export interface IntentMeta {
  /** Monotonic decision id (echoes {@link Observation.seq}); used for trace correlation and stale-result drop. */
  seq: number;
  /** Optional one-shot chat line spoken when this intent becomes current. */
  say?: string;
}

/**
 * A declarative goal produced by a {@link Policy}. The reflex executes the
 * current intent fluidly until the next one replaces it. The policy never
 * computes a firing direction: it names a target and the reflex aims, gates on
 * line-of-sight and respects the fire cooldown, so a slow or weak policy can
 * never waste HP.
 */
export type Intent =
  | (IntentMeta & { kind: "idle" })
  | (IntentMeta & { kind: "patrol" })
  | (IntentMeta & { kind: "moveTo"; x: number; z: number; run: boolean })
  | (IntentMeta & { kind: "hideAs"; x: number; z: number })
  | (IntentMeta & { kind: "inspect"; targetId: string; run: boolean })
  | (IntentMeta & { kind: "shootTarget"; targetId: string })
  | (IntentMeta & { kind: "chat"; text: string });

export type Visibility = "full" | "limited";

/** The bot's own state, always known in full. */
export interface ObservedSelf {
  role: Role;
  alive: boolean;
  hp: number;
  x: number;
  z: number;
  rot: number;
  propType: string;
  canShootNow: boolean;
}

/**
 * Another player as perceived by the bot. Ground-truth fields
 * (`role`/`alive`/`propType`) are present only under `"full"` visibility; under
 * `"limited"` the list is filtered to what the bot can sense and only the
 * deduction signals remain, and a decoy in sight is listed exactly as a
 * disguised player standing still would be, because that is what it looks like.
 */
export interface ObservedEntity {
  /**
   * Under `"full"` visibility, the player's session id. Under `"limited"`, an
   * opaque handle drawn from one sequence for players and decoys alike, so the
   * id says nothing a player could not see: a session id would name a player,
   * and a decoy's key would name a decoy.
   */
  id: string;
  x: number;
  z: number;
  distance: number;
  hasLineOfSight: boolean;
  role?: Role;
  alive?: boolean;
  propType?: string;
  /**
   * Whether this contact is wearing a disguise at all, rather than which one:
   * the shape a player reads off the screen. An undisguised contact renders as a
   * character carrying a weapon, so it can only be a hunter; a disguised one
   * renders as a scene object.
   *
   * **Absent when the contact is not in line of sight**, because footsteps
   * through a wall tell a player nothing about shape. A contact known only by
   * sound is therefore "might be anyone", not "known teammate": the difference
   * between a bot that searches a noise and one that reads the room. `"full"`
   * visibility always reports it: that mode is ground truth by definition.
   */
  disguised?: boolean;
  movedRecently?: boolean;
  /** This entity has line of sight to the bot and is aiming roughly at it, i.e. it is watching the bot right now. */
  facingMe?: boolean;
}

export interface ObservedDoorway {
  x: number;
  z: number;
}

export interface ObservedProp {
  type: string;
  x: number;
  z: number;
}

export interface ObservedMap {
  bounds: MapBounds;
  doorways: ObservedDoorway[];
  nearbyProps: ObservedProp[];
}

/** The compact JSON snapshot handed to a {@link Policy.decide} call. */
export interface Observation {
  /** Monotonic decision id; the returned {@link Intent} echoes it for stale-drop. */
  seq: number;
  visibility: Visibility;
  phase: Phase;
  /** True when the reflex could not path to the current intent's target. */
  pathBlocked: boolean;
  /**
   * True once the reflex has reached the current intent's target and parked
   * there. A policy that re-issues the same goal while this is set gets a bot
   * that stands still, because an unchanged goal never resets the reflex.
   */
  arrived: boolean;
  self: ObservedSelf;
  entities: ObservedEntity[];
  map: ObservedMap;
}
