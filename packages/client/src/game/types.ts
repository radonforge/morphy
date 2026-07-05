import type { Role, WeaponId } from "@webhunt/shared";

export interface RemotePlayerView {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  role: Role;
  alive: boolean;
  hp: number;
  kills: number;
  propType: string;
  ready: boolean;
  avatar: string;
  ping: number;
}

export type PlayersRef = { readonly current: Map<string, RemotePlayerView> };

export interface PlayerMeta {
  name: string;
  role: Role;
  alive: boolean;
  hp: number;
  kills: number;
  propType: string;
  ready: boolean;
  avatar: string;
  ping: number;
}

export type MetaMap = Record<string, PlayerMeta>;

export type TeleportRef = { current: { x: number; z: number } | null };

export type TauntPulseRef = { readonly current: Map<string, number> };

export interface ShotFx {
  weapon: WeaponId;
  origin: { x: number; y: number; z: number };
  ends: { x: number; y: number; z: number }[];
}

/** Queue of resolved shots, filled by the network hub and drained by the scene's tracer pool. */
export type ShotsRef = { readonly current: ShotFx[] };
