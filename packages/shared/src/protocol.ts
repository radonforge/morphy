import type { Vec3 } from "./map";

export type Phase = "lobby" | "starting" | "hiding" | "hunting" | "round_end";

export type Role = "hunter" | "prop";

export type Winner = "hunters" | "props" | "";

export const MSG_INPUT = "input";
export const MSG_TRANSFORM = "transform";
export const MSG_SHOOT = "shoot";
export const MSG_TELEPORT = "teleport";
export const MSG_TAUNT = "taunt";
export const MSG_CHAT = "chat";

export interface InputMessage {
  x: number;
  y: number;
  z: number;
  rot: number;
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
