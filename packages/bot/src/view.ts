import type { Phase, Role, Winner } from "@webhunt/shared";

export interface BotPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  aim: number;
  role: Role;
  alive: boolean;
  hp: number;
  kills: number;
  propType: string;
  ready: boolean;
}

interface PlayersView {
  get(key: string): BotPlayer | undefined;
  forEach(cb: (value: BotPlayer, key: string) => void): void;
  readonly size: number;
}

interface RoomStateView {
  phase: Phase;
  phaseEndsAt: number;
  winner: Winner;
  players: PlayersView;
}

export interface WorldSnapshot {
  phase: Phase;
  winner: Winner;
  self: BotPlayer | undefined;
  others: BotPlayer[];
}

/** Read the synced Colyseus room state (an untyped Schema) into a plain snapshot. */
export function snapshot(rawState: unknown, selfId: string): WorldSnapshot {
  const state = rawState as RoomStateView;
  const others: BotPlayer[] = [];
  state.players.forEach((player, key) => {
    if (key !== selfId) others.push(player);
  });
  return {
    phase: state.phase,
    winner: state.winner,
    self: state.players.get(selfId),
    others,
  };
}
