import { useCallback, useState } from "react";
import { COLYSEUS_PROXY_PATH, MAX_NAME_LENGTH } from "@webhunt/shared";
import { connectToRoom, type Connection } from "../net/connection";
import { Game } from "../game/Game";

type Status = { kind: "idle" } | { kind: "connecting" } | { kind: "error"; message: string };

const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  `${window.location.origin}${COLYSEUS_PROXY_PATH}`;

export function App() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const handleLeave = useCallback(() => setConnection(null), []);

  const handleConnect = useCallback(async () => {
    setStatus({ kind: "connecting" });
    try {
      const conn = await connectToRoom(SERVER_URL, name);
      setConnection(conn);
      setStatus({ kind: "idle" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "connessione fallita";
      setStatus({ kind: "error", message });
    }
  }, [name]);

  if (connection) {
    return <Game connection={connection} onLeave={handleLeave} />;
  }

  const connecting = status.kind === "connecting";
  return (
    <div className="lobby">
      <form
        className="lobby-card panel"
        onSubmit={(e) => {
          e.preventDefault();
          void handleConnect();
        }}
      >
        <h1>webhunt.lol</h1>
        <input
          value={name}
          maxLength={MAX_NAME_LENGTH}
          placeholder="Il tuo nome"
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={connecting}>
          {connecting ? "Connessione…" : "Entra"}
        </button>
        {status.kind === "error" && <span className="lobby-error">{status.message}</span>}
        <span className="lobby-meta">Server: {SERVER_URL}</span>
      </form>
    </div>
  );
}
