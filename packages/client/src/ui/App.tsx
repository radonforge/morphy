import {
  type AvatarId,
  type MapId,
  MSG_SET_MAP,
  MSG_SET_PROFILE,
  MSG_START,
  type SetMapMessage,
  type SetProfileMessage,
} from "@morphy/shared";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  type Connection,
  connectToRoom,
  createPartyRoom,
  joinPartyRoom,
  reconnectToRoom,
} from "../net/connection";
import { SERVER_URL } from "../net/endpoints";
import { usePartyRoom } from "../net/usePartyRoom";
import { getDeviceId } from "../storage";
import { type ConnectStatus, Lobby, type PartyViewProps } from "./Lobby";

type View = "menu" | "party" | "game";

const Game = lazy(() => import("../game/Game").then((module) => ({ default: module.Game })));

/**
 * Shown over a frozen match while {@link reconnectToRoom} works: the round is
 * still running on the server and the seat is held, so the way out has to be
 * deliberate rather than automatic.
 */
function Reconnecting({ onLeave }: { onLeave: () => void }) {
  return (
    <div className="pause">
      <div className="pause-card panel">
        <span className="eyebrow">Connection lost</span>
        <h2>Reconnecting…</h2>
        <span className="pause-hint">Your seat is held for a few seconds.</span>
        <button type="button" className="btn-ghost" onClick={onLeave}>
          Leave match
        </button>
      </div>
    </div>
  );
}

export function App() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [status, setStatus] = useState<ConnectStatus>({ kind: "idle" });
  const [view, setView] = useState<View>("menu");
  const [reconnecting, setReconnecting] = useState(false);
  const [matchSeq, setMatchSeq] = useState(0);
  const droppedRef = useRef(false);
  const reconnectRef = useRef<AbortController | null>(null);
  const party = usePartyRoom(view === "party" ? connection : null);

  const stopReconnecting = useCallback(() => {
    reconnectRef.current?.abort();
    reconnectRef.current = null;
    droppedRef.current = false;
    setReconnecting(false);
  }, []);

  const disconnect = useCallback(() => {
    stopReconnecting();
    setConnection((prev) => {
      if (prev) void prev.room.leave();
      return null;
    });
    setView("menu");
  }, [stopReconnecting]);

  /**
   * Own the current room's lifecycle. A room that died between being handed to
   * `setConnection` and this effect subscribing would have fired its close
   * signals into nobody, leaving the app holding a dead room with no overlay
   * and no retry — hence the `isOpen` check after subscribing.
   */
  useEffect(() => {
    if (!connection) return;
    const { room } = connection;
    const handleError = (code: number, message?: string) => {
      console.error("[morphy] room error", code, message);
      if (droppedRef.current) return;
      disconnect();
    };
    const handleLeave = () => {
      if (droppedRef.current) return;
      setConnection(null);
      setView("menu");
    };
    const handleDrop = () => {
      if (droppedRef.current) return;
      droppedRef.current = true;
      setReconnecting(true);
      const controller = new AbortController();
      reconnectRef.current = controller;
      void reconnectToRoom(SERVER_URL, room.reconnectionToken, controller.signal)
        .then((next) => {
          if (controller.signal.aborted) {
            void next.room.leave();
            return;
          }
          stopReconnecting();
          setMatchSeq((seq) => seq + 1);
          setConnection(next);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          stopReconnecting();
          setConnection(null);
          setView("menu");
          setStatus({
            kind: "error",
            message: error instanceof Error ? error.message : "the connection was lost",
          });
        });
    };
    room.onError(handleError);
    room.onLeave(handleLeave);
    room.onDrop(handleDrop);
    if (!room.connection.isOpen) handleLeave();
    return () => {
      room.onError.remove(handleError);
      room.onLeave.remove(handleLeave);
      room.onDrop.remove(handleDrop);
    };
  }, [connection, disconnect, stopReconnecting]);

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
        <Game
          key={matchSeq}
          connection={connection}
          onBackToParty={handleBackToParty}
          onLeaveMatch={disconnect}
        />
        {reconnecting && <Reconnecting onLeave={disconnect} />}
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
    <>
      <Lobby
        status={status}
        party={partyProps}
        onConnect={handleConnect}
        onCreateParty={handleCreateParty}
        onJoinParty={handleJoinParty}
      />
      {reconnecting && <Reconnecting onLeave={disconnect} />}
    </>
  );
}
