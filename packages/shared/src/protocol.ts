import type { AvatarId } from "./avatars";
import type { Vec3 } from "./map";
import type { MapId } from "./maps";

export type Phase = "lobby" | "starting" | "hiding" | "hunting" | "round_end";

export type Role = "hunter" | "prop";

export type Winner = "hunters" | "props" | "";

export const MSG_INPUT = "input";
export const MSG_TRANSFORM = "transform";
export const MSG_SHOOT = "shoot";
export const MSG_TELEPORT = "teleport";
export const MSG_TAUNT = "taunt";
export const MSG_CHAT = "chat";
export const MSG_SHOT_RESULT = "shot_result";
export const MSG_READY = "ready";
export const MSG_MAP = "map";
export const MSG_KILL = "kill";
export const MSG_START = "start";
export const MSG_SET_MAP = "set_map";
export const MSG_SET_PROFILE = "set_profile";

export type KillReason = "shot" | "self" | "converted";

export interface KillEvent {
  byId: string;
  byName: string;
  victimId: string;
  victimName: string;
  reason: KillReason;
}

export interface InputMessage {
  x: number;
  y: number;
  z: number;
  /** Body heading (movement direction), forward = (sin rot, cos rot). Drives mesh orientation. */
  rot: number;
  /** Look/aim heading in the same convention as {@link rot}; what the player is facing/aiming at. */
  aim: number;
}

export interface TransformMessage {
  propType: string;
}

export interface ShootMessage {
  origin: Vec3;
  dir: Vec3;
}

export interface TeleportMessage {
  x: number;
  z: number;
}

export interface TauntMessage {
  playerId: string;
  x: number;
  z: number;
}

export interface ChatSend {
  text: string;
}

export interface ChatEvent {
  fromId: string;
  name: string;
  text: string;
}

export interface ShotResult {
  hit: boolean;
}

export interface ReadyMessage {
  ready: boolean;
}

/** Host request to switch the party's map while waiting in the lobby. */
export interface SetMapMessage {
  map: string;
}

/** Live name/avatar change from the menu stage while in a party lobby. */
export interface SetProfileMessage {
  name: string;
  avatar: string;
}

/** Options every client sends when joining a room, whatever the entry path. */
export interface RoomJoinOptions {
  name: string;
  avatar: AvatarId;
}

/** Options for public matchmaking (`joinOrCreate`, filtered by map). */
export interface PublicJoinOptions extends RoomJoinOptions {
  map: MapId;
}

/** Options for `client.create` when opening a code-protected party room. */
export interface PartyCreateOptions extends PublicJoinOptions {
  private: true;
}
