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
import { MatchErrorBoundary } from "./MatchErrorBoundary";

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
   * Own the current room's lifecycle, from subscribing to its close signals to
   * ending exactly once. A room that died between being handed to
   * `setConnection` and this effect subscribing fired those signals into
   * nobody, so a closed socket found at subscription time counts as a close,
   * but the socket's own event may still be a queued task, so every ending
   * goes through `ended` and the first one wins. Otherwise a late real drop
   * would start a reconnect for a match the player has already left.
   */
  useEffect(() => {
    if (!connection) return;
    const { room } = connection;
    let ended = false;
    const handleError = (code: number, message?: string) => {
      console.error("[morphy] room error", code, message);
      if (ended || droppedRef.current) return;
      disconnect();
    };
    const handleLeave = () => {
      if (ended || droppedRef.current) return;
      ended = true;
      setConnection(null);
      setView("menu");
    };
    const handleDrop = () => {
      if (ended || droppedRef.current) return;
      ended = true;
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
      stopReconnecting();
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
  const restartMatch = useCallback(() => setMatchSeq((seq) => seq + 1), []);

  if (view === "game" && connection) {
    return (
      <Suspense fallback={<div className="game-loading">Loading match…</div>}>
        <MatchErrorBoundary key={matchSeq} onRejoin={restartMatch} onLeave={disconnect}>
          <Game
            connection={connection}
            onBackToParty={handleBackToParty}
            onLeaveMatch={disconnect}
            onRestartView={restartMatch}
          />
        </MatchErrorBoundary>
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
