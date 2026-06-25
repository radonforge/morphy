import type { Role } from "@webhunt/shared";

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
}

export type MetaMap = Record<string, PlayerMeta>;

export type TeleportRef = { current: { x: number; z: number } | null };

export type TauntPulseRef = { readonly current: Map<string, number> };
