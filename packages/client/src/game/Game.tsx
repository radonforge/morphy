import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Callbacks } from "@colyseus/sdk";
import type { Phase, Role } from "@webhunt/shared";
import { type Connection } from "../net/connection";
import { officeMap } from "../officeMap";
import { Scene } from "./Scene";
import type { MetaMap, RemotePlayerView } from "./types";

const STATE_POLL_MS = 200;
const COUNTDOWN_TICK_MS = 250;

interface GameProps {
  connection: Connection;
  onLeave: () => void;
}

interface RoomStateView {
  phase: Phase;
  phaseEndsAt: number;
}

const PHASE_LABEL: Record<Phase, string> = {
  lobby: "In attesa di giocatori",
  starting: "Si parte…",
  hiding: "Nascondetevi!",
  hunting: "Caccia!",
  round_end: "Fine round",
};

const ROLE_LABEL: Record<Role, string> = {
  hunter: "Cacciatore",
  prop: "Prop",
};

function metaEqual(a: MetaMap, b: MetaMap): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => {
    const ai = a[key];
    const bi = b[key];
    return bi !== undefined && ai !== undefined && ai.role === bi.role && ai.propType === bi.propType;
  });
}

function Countdown({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  if (endsAt <= 0) return null;
  const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return <span> · {remaining}s</span>;
}

export function Game({ connection, onLeave }: GameProps) {
  const { room, sessionId } = connection;
  const playersRef = useRef<Map<string, RemotePlayerView>>(new Map());
  const [ids, setIds] = useState<string[]>([]);
  const [meta, setMeta] = useState<MetaMap>({});
  const [phase, setPhase] = useState<Phase>("lobby");
  const [phaseEndsAt, setPhaseEndsAt] = useState(0);

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

  useEffect(() => {
    const poll = setInterval(() => {
      const view = room.state as unknown as RoomStateView;
      setPhase((prev) => (prev === view.phase ? prev : view.phase));
      setPhaseEndsAt((prev) => (prev === view.phaseEndsAt ? prev : view.phaseEndsAt));

      const next: MetaMap = {};
      for (const [id, player] of playersRef.current) {
        next[id] = { role: player.role, propType: player.propType };
      }
      setMeta((prev) => (metaEqual(prev, next) ? prev : next));
    }, STATE_POLL_MS);
    return () => clearInterval(poll);
  }, [room]);

  const localRole: Role = meta[sessionId]?.role ?? "prop";
  const localProp = meta[sessionId]?.propType ?? "";
  const canTransform = localRole === "prop" && (phase === "hiding" || phase === "hunting");

  const hint =
    canTransform
      ? "Guarda un oggetto e premi E per trasformarti"
      : localRole === "hunter" && phase === "hiding"
        ? "Sei accecato… attendi la caccia"
        : "WASD muovi · click + mouse ruota visuale · Esc libera";

  return (
    <>
      <Canvas shadows camera={{ position: [0, 12, 18], fov: 55 }}>
        <Scene
          room={room}
          map={officeMap}
          localId={sessionId}
          ids={ids}
          playersRef={playersRef}
          meta={meta}
          phase={phase}
        />
      </Canvas>

      {canTransform && <div className="crosshair" />}

      <div className="hud">
        <div>
          <b>{PHASE_LABEL[phase]}</b>
          <Countdown endsAt={phaseEndsAt} />
        </div>
        <div>
          Ruolo: <b>{ROLE_LABEL[localRole]}</b>
          {localProp ? ` (${localProp})` : ""}
        </div>
        <div>Giocatori: {ids.length}</div>
        <div style={{ marginTop: 6, opacity: 0.8 }}>{hint}</div>
      </div>
    </>
  );
}
