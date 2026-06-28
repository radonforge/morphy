import { type AvatarId, COLYSEUS_PROXY_PATH, type MapId } from "@webhunt/shared";
import { useCallback, useState } from "react";
import { Game } from "../game/Game";
import { type Connection, connectToRoom } from "../net/connection";
import { type ConnectStatus, Lobby } from "./Lobby";

const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  `${window.location.origin}${COLYSEUS_PROXY_PATH}`;

export function App() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [status, setStatus] = useState<ConnectStatus>({ kind: "idle" });

  const handleLeave = useCallback(() => setConnection(null), []);

  const handleConnect = useCallback(async (name: string, map: MapId, avatar: AvatarId) => {
    setStatus({ kind: "connecting" });
    try {
      const conn = await connectToRoom(SERVER_URL, { name, map, avatar });
      setConnection(conn);
      setStatus({ kind: "idle" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "connessione fallita";
      setStatus({ kind: "error", message });
    }
  }, []);

  if (connection) {
    return <Game connection={connection} onLeave={handleLeave} />;
  }

  return <Lobby status={status} onConnect={handleConnect} />;
}
