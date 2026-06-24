import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Callbacks } from "@colyseus/sdk";
import { type Connection } from "../net/connection";
import { officeMap } from "../officeMap";
import { Scene } from "./Scene";
import type { RemotePlayerView } from "./types";

interface GameProps {
  connection: Connection;
  onLeave: () => void;
}

export function Game({ connection, onLeave }: GameProps) {
  const { room, sessionId } = connection;
  const playersRef = useRef<Map<string, RemotePlayerView>>(new Map());
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    const callbacks = Callbacks.get(room);

    callbacks.onAdd("players", (player: unknown, key: unknown) => {
      const id = String(key);
      playersRef.current.set(id, player as RemotePlayerView);
      setIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    });

    callbacks.onRemove("players", (_player: unknown, key: unknown) => {
      const id = String(key);
      playersRef.current.delete(id);
      setIds((prev) => prev.filter((existing) => existing !== id));
    });

    room.onError((code, message) => {
      console.error("[webhunt] room error", code, message);
      onLeave();
    });
    room.onLeave(() => onLeave());

    return () => {
      void room.leave();
    };
  }, [room, onLeave]);

  return (
    <>
      <Canvas shadows camera={{ position: [0, 12, 18], fov: 55 }}>
        <Scene room={room} map={officeMap} localId={sessionId} ids={ids} playersRef={playersRef} />
      </Canvas>
      <div className="hud">
        <div>
          Mappa: <b>{officeMap.name}</b>
        </div>
        <div>
          Giocatori: <b>{ids.length}</b>
        </div>
        <div>{ids.map((id) => playersRef.current.get(id)?.name ?? "…").join(", ")}</div>
        <div style={{ marginTop: 6, opacity: 0.8 }}>WASD muovi · click + mouse ruota visuale · Esc libera</div>
      </div>
    </>
  );
}
