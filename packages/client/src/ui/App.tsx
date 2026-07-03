import {
  type AvatarId,
  COLYSEUS_PROXY_PATH,
  type MapId,
  MSG_SET_MAP,
  MSG_SET_PROFILE,
  MSG_START,
  type SetMapMessage,
  type SetProfileMessage,
} from "@webhunt/shared";
import { useCallback, useEffect, useState } from "react";
import { Game } from "../game/Game";
import { type Connection, connectToRoom, createPartyRoom, joinPartyRoom } from "../net/connection";
import { usePartyRoom } from "../net/usePartyRoom";
import { type ConnectStatus, Lobby, type PartyViewProps } from "./Lobby";

const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  `${window.location.origin}${COLYSEUS_PROXY_PATH}`;

type View = "menu" | "party" | "game";

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
      console.error("[webhunt] room error", code, message);
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
      const conn = await connectToRoom(SERVER_URL, { name, map, avatar });
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
      const conn = await createPartyRoom(SERVER_URL, { name, map, avatar });
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
      const conn = await joinPartyRoom(SERVER_URL, code, { name, avatar });
      setConnection(conn);
      setView("party");
      setStatus({ kind: "idle" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not join the room";
      setStatus({ kind: "error", message });
    }
  }, []);

  const handleBackToMenu = useCallback(() => setView("party"), []);

  if (view === "game" && connection) {
    return <Game connection={connection} onBackToMenu={handleBackToMenu} />;
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
