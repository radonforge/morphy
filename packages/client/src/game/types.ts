import type { Role, WeaponId } from "@morphy/shared";

export interface RemotePlayerView {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  propRot: number;
  role: Role;
  alive: boolean;
  hp: number;
  kills: number;
  propType: string;
  rerollsLeft: number;
  decoysLeft: number;
  ready: boolean;
  avatar: string;
  weapon: WeaponId;
  ping: number;
  connected: boolean;
}

export type PlayersRef = { readonly current: Map<string, RemotePlayerView> };

export interface DecoyView {
  id: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  propType: string;
}

/**
 * The player fields lifted from the schema into React state. This list is the
 * single source of truth: it drives the per-field subscriptions, the snapshot
 * type and the equality check, so a field added here cannot be silently left
 * out of one of the three.
 */
export const PLAYER_META_FIELDS = [
  "name",
  "role",
  "alive",
  "hp",
  "kills",
  "propType",
  "rerollsLeft",
  "decoysLeft",
  "ready",
  "avatar",
  "weapon",
  "ping",
  "connected",
] as const;

export type PlayerMetaField = (typeof PLAYER_META_FIELDS)[number];

export type PlayerMeta = Pick<RemotePlayerView, PlayerMetaField>;

export type MetaMap = Record<string, PlayerMeta>;

/**
 * The player fields the 3D scene reads. Everything else in {@link PlayerMeta} is
 * HUD-only, and `ping` alone changes every 2 s per human: handing the scene the
 * full map re-rendered the whole R3F tree on each of those.
 */
export const SCENE_META_FIELDS = ["role", "alive", "propType", "avatar"] as const;

export type SceneMeta = Pick<PlayerMeta, (typeof SCENE_META_FIELDS)[number]>;

export type SceneMetaMap = Record<string, SceneMeta>;

export type TeleportRef = { current: { x: number; z: number } | null };

/**
 * Taunt start times, as `performance.now()` milliseconds keyed by player id.
 *
 * Storing the start rather than the time left is what keeps a pulse from
 * outliving its player: a remaining-time counter only reaches zero if something
 * still renders that player's mesh, so a taunt interrupted by a leave or a
 * death stayed positive forever and held the scene permanently "animating".
 */
export type TauntPulseRef = { readonly current: Map<string, number> };

export interface ShotFx {
  weapon: WeaponId;
  origin: { x: number; y: number; z: number };
  ends: { x: number; y: number; z: number }[];
}

/** Queue of resolved shots, filled by the network hub and drained by the scene's tracer pool. */
export type ShotsRef = { readonly current: ShotFx[] };

export interface DecoyBreakFx {
  x: number;
  y: number;
  z: number;
  propType: string;
}

/** Queue of decoy breaks, filled by the network hub and drained by the scene's debris pool. */
export type BreaksRef = { readonly current: DecoyBreakFx[] };
