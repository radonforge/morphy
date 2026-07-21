import { Callbacks } from "@colyseus/sdk";
import {
  DEFAULT_MAP_ID,
  isMapId,
  isPhase,
  type MapId,
  MSG_MAP,
  MSG_TELEPORT,
  type Phase,
} from "@morphy/shared";
import { useEffect, useRef, useState } from "react";
import type { Connection } from "./connection";

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
 * Schema callbacks update a compact, equality-gated snapshot only when one of
 * the fields used by the menu changes; high-frequency position patches do not
 * cause React work.
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
    const ignore = () => {};
    const memberUnsubscribers = new Map<string, Array<() => void>>();
    const update = () => {
      const state = room.state as unknown as PartyStateView;
      const next: PartyView = {
        phase: isPhase(state.phase) ? state.phase : "lobby",
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
    const unsubscribers: Array<() => void> = [
      callbacks.onAdd("players", (player: unknown, key: unknown) => {
        const id = String(key);
        const member = player as PartyPlayerView;
        players.set(id, member);
        memberUnsubscribers.set(id, [
          callbacks.listen(member, "name", update),
          callbacks.listen(member, "avatar", update),
        ]);
        update();
      }),
      callbacks.onRemove("players", (_player: unknown, key: unknown) => {
        const id = String(key);
        for (const unsubscribe of memberUnsubscribers.get(id) ?? []) unsubscribe();
        memberUnsubscribers.delete(id);
        players.delete(id);
        update();
      }),
      callbacks.listen("phase", update),
      callbacks.listen("hostId", update),
      callbacks.listen("isPrivate", update),
      callbacks.listen("mapId", update),
      room.onMessage(MSG_MAP, ignore),
      room.onMessage(MSG_TELEPORT, ignore),
    ];
    update();
    return () => {
      for (const nested of memberUnsubscribers.values()) {
        for (const unsubscribe of nested) unsubscribe();
      }
      for (const unsubscribe of unsubscribers) unsubscribe();
      memberUnsubscribers.clear();
      players.clear();
      setView(EMPTY_PARTY);
    };
  }, [connection]);

  return view;
}
