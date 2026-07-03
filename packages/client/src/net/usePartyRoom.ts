import { Callbacks } from "@colyseus/sdk";
import { DEFAULT_MAP_ID, isMapId, type MapId, type Phase } from "@webhunt/shared";
import { useEffect, useRef, useState } from "react";
import type { Connection } from "./connection";

const PARTY_POLL_MS = 200;

export interface PartyMember {
  id: string;
  name: string;
  avatar: string;
}

export interface PartyView {
  phase: Phase;
  hostId: string;
  isPrivate: boolean;
  mapId: MapId;
  members: PartyMember[];
}

interface PartyPlayerView {
  name: string;
  avatar: string;
}

interface PartyStateView {
  phase: Phase;
  hostId: string;
  isPrivate: boolean;
  mapId: string;
}

const EMPTY_PARTY: PartyView = {
  phase: "lobby",
  hostId: "",
  isPrivate: false,
  mapId: DEFAULT_MAP_ID,
  members: [],
};

function partyViewEqual(a: PartyView, b: PartyView): boolean {
  if (
    a.phase !== b.phase ||
    a.hostId !== b.hostId ||
    a.isPrivate !== b.isPrivate ||
    a.mapId !== b.mapId ||
    a.members.length !== b.members.length
  ) {
    return false;
  }
  return a.members.every((member, index) => {
    const other = b.members[index];
    return (
      other !== undefined &&
      member.id === other.id &&
      member.name === other.name &&
      member.avatar === other.avatar
    );
  });
}

/**
 * Lifts the live room state the menu needs (phase, host, privacy, map, roster
 * in join order) into React state while the player is on the menu stage.
 * Mirrors Game's pattern: schema callbacks feed a ref, a poll snapshots it,
 * gated by an equality check so unchanged state never re-renders.
 */
export function usePartyRoom(connection: Connection | null): PartyView {
  const [view, setView] = useState<PartyView>(EMPTY_PARTY);
  const playersRef = useRef<Map<string, PartyPlayerView>>(new Map());

  useEffect(() => {
    const players = playersRef.current;
    if (!connection) {
      players.clear();
      setView(EMPTY_PARTY);
      return;
    }
    const { room } = connection;
    const callbacks = Callbacks.get(room);
    const unsubscribers = [
      callbacks.onAdd("players", (player: unknown, key: unknown) => {
        players.set(String(key), player as PartyPlayerView);
      }),
      callbacks.onRemove("players", (_player: unknown, key: unknown) => {
        players.delete(String(key));
      }),
    ];
    const update = () => {
      const state = room.state as unknown as PartyStateView;
      const next: PartyView = {
        phase: state.phase,
        hostId: state.hostId,
        isPrivate: state.isPrivate,
        mapId: isMapId(state.mapId) ? state.mapId : DEFAULT_MAP_ID,
        members: [...players].map(([id, player]) => ({
          id,
          name: player.name,
          avatar: player.avatar,
        })),
      };
      setView((prev) => (partyViewEqual(prev, next) ? prev : next));
    };
    update();
    const poll = setInterval(update, PARTY_POLL_MS);
    return () => {
      clearInterval(poll);
      for (const unsubscribe of unsubscribers) unsubscribe();
      players.clear();
      setView(EMPTY_PARTY);
    };
  }, [connection]);

  return view;
}
