import type { Phase, Role, Winner } from "@morphy/shared";

export interface BotPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  aim: number;
  propRot: number;
  role: Role;
  alive: boolean;
  hp: number;
  kills: number;
  propType: string;
  decoysLeft: number;
  ready: boolean;
}

export interface BotDecoy {
  id: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  propType: string;
}

interface PlayersView {
  get(key: string): BotPlayer | undefined;
  forEach(cb: (value: BotPlayer, key: string) => void): void;
  readonly size: number;
}

interface DecoysView {
  forEach(cb: (value: BotDecoy, key: string) => void): void;
}

interface RoomStateView {
  phase: Phase;
  phaseEndsAt: number;
  winner: Winner;
  players: PlayersView;
  decoys: DecoysView;
}

export interface WorldSnapshot {
  phase: Phase;
  winner: Winner;
  self: BotPlayer | undefined;
  others: BotPlayer[];
  decoys: BotDecoy[];
}

/** Read the synced Colyseus room state (an untyped Schema) into a plain snapshot. */
export function snapshot(rawState: unknown, selfId: string): WorldSnapshot {
  const state = rawState as RoomStateView;
  const others: BotPlayer[] = [];
  const decoys: BotDecoy[] = [];
  state.players.forEach((player, key) => {
    if (key !== selfId) others.push(player);
  });
  state.decoys.forEach((decoy, key) => {
    decoys.push({
      id: key,
      x: decoy.x,
      y: decoy.y,
      z: decoy.z,
      rot: decoy.rot,
      propType: decoy.propType,
    });
  });
  return {
    phase: state.phase,
    winner: state.winner,
    self: state.players.get(selfId),
    others,
    decoys,
  };
}
