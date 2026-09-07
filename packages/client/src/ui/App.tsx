import {
  type AvatarId,
  type MapId,
  MSG_SET_MAP,
  MSG_SET_PROFILE,
  MSG_START,
  type SetMapMessage,
  type SetProfileMessage,
} from "@morphy/shared";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { type Connection, connectToRoom, createPartyRoom, joinPartyRoom } from "../net/connection";
import { SERVER_URL } from "../net/endpoints";
import { usePartyRoom } from "../net/usePartyRoom";
import { getDeviceId } from "../storage";
import { type ConnectStatus, Lobby, type PartyViewProps } from "./Lobby";

type View = "menu" | "party" | "game";

const Game = lazy(() => import("../game/Game").then((module) => ({ default: module.Game })));

export function App() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [status, setStatus] = useState<ConnectStatus>({ kind: "idle" });
  const [view, setView] = useState<View>("menu");
  const party = usePartyRoom(view === "party" ? connection : null);

  const disconnect = useCallback(() => {
    setConnection((prev) => {
      if (prev) void prev.room.leave();
      return null;
    });
    setView("menu");
  }, []);

  useEffect(() => {
    if (!connection) return;
    const { room } = connection;
    const handleError = (code: number, message?: string) => {
      console.error("[morphy] room error", code, message);
      disconnect();
    };
    const handleLeave = () => {
      setConnection(null);
      setView("menu");
    };
    room.onError(handleError);
    room.onLeave(handleLeave);
    return () => {
      room.onError.remove(handleError);
      room.onLeave.remove(handleLeave);
    };
  }, [connection, disconnect]);

  useEffect(() => {
    if (view === "party" && party.phase !== "lobby") setView("game");
  }, [view, party.phase]);

  const handleConnect = useCallback(async (name: string, map: MapId, avatar: AvatarId) => {
    setStatus({ kind: "connecting" });
    try {
      const conn = await connectToRoom(SERVER_URL, { name, map, avatar, deviceId: getDeviceId() });
      setConnection(conn);
      setView("game");
      setStatus({ kind: "idle" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "connection failed";
      setStatus({ kind: "error", message });
    }
  }, []);

  const handleCreateParty = useCallback(async (name: string, map: MapId, avatar: AvatarId) => {
    setStatus({ kind: "connecting" });
    try {
      const conn = await createPartyRoom(SERVER_URL, {
        name,
        map,
        avatar,
        deviceId: getDeviceId(),
      });
      setConnection(conn);
      setView("party");
      setStatus({ kind: "idle" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not create the room";
      setStatus({ kind: "error", message });
    }
  }, []);

  const handleJoinParty = useCallback(async (code: string, name: string, avatar: AvatarId) => {
    setStatus({ kind: "connecting" });
    try {
      const conn = await joinPartyRoom(SERVER_URL, code, { name, avatar, deviceId: getDeviceId() });
      setConnection(conn);
      setView("party");
      setStatus({ kind: "idle" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not join the room";
      setStatus({ kind: "error", message });
    }
  }, []);

  const handleBackToParty = useCallback(() => setView("party"), []);

  if (view === "game" && connection) {
    return (
      <Suspense fallback={<div className="game-loading">Loading match…</div>}>
        <Game connection={connection} onBackToParty={handleBackToParty} onLeaveMatch={disconnect} />
      </Suspense>
    );
  }

  const partyProps: PartyViewProps | null =
    view === "party" && connection
      ? {
          code: connection.room.roomId,
          selfId: connection.sessionId,
          hostId: party.hostId,
          mapId: party.mapId,
          members: party.members,
          onStart: () => connection.room.send(MSG_START),
          onSetMap: (map) => connection.room.send(MSG_SET_MAP, { map } satisfies SetMapMessage),
          onSetProfile: (name, avatar) =>
            connection.room.send(MSG_SET_PROFILE, { name, avatar } satisfies SetProfileMessage),
          onLeaveParty: disconnect,
        }
      : null;

  return (
    <Lobby
      status={status}
      party={partyProps}
      onConnect={handleConnect}
      onCreateParty={handleCreateParty}
      onJoinParty={handleJoinParty}
    />
  );
}
