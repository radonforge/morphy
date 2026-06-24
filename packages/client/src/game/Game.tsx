import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Callbacks } from "@colyseus/sdk";
import { MSG_TELEPORT, type Phase, type Role, type Winner } from "@webhunt/shared";
import { type Connection } from "../net/connection";
import { officeMap } from "../officeMap";
import { Scene } from "./Scene";
import type { MetaMap, RemotePlayerView, TeleportRef } from "./types";

const STATE_POLL_MS = 200;
const COUNTDOWN_TICK_MS = 250;

interface GameProps {
  connection: Connection;
  onLeave: () => void;
}

interface RoomStateView {
  phase: Phase;
  phaseEndsAt: number;
  winner: Winner;
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

const WINNER_LABEL: Record<Winner, string> = {
  hunters: "Hanno vinto i Cacciatori!",
  props: "Hanno vinto i Prop!",
  "": "",
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function metaEqual(a: MetaMap, b: MetaMap): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => {
    const ai = a[key];
    const bi = b[key];
    return (
      ai !== undefined &&
      bi !== undefined &&
      ai.role === bi.role &&
      ai.alive === bi.alive &&
      ai.hp === bi.hp &&
      ai.propType === bi.propType
    );
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
  const teleportRef = useRef<{ x: number; z: number } | null>(null) as TeleportRef;
  const [ids, setIds] = useState<string[]>([]);
  const [meta, setMeta] = useState<MetaMap>({});
  const [phase, setPhase] = useState<Phase>("lobby");
  const [phaseEndsAt, setPhaseEndsAt] = useState(0);
  const [winner, setWinner] = useState<Winner>("");

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

    room.onMessage(MSG_TELEPORT, (message: unknown) => {
      if (typeof message !== "object" || message === null) return;
      const m = message as Record<string, unknown>;
      if (isFiniteNumber(m.x) && isFiniteNumber(m.z)) {
        teleportRef.current = { x: m.x, z: m.z };
      }
    });

    room.onError((code, message) => {
      console.error("[webhunt] room error", code, message);
      onLeave();
    });
    room.onLeave(() => onLeave());

    return () => {
      void room.leave();
    };
  }, [room, onLeave, teleportRef]);

  useEffect(() => {
    const poll = setInterval(() => {
      const view = room.state as unknown as RoomStateView;
      setPhase((prev) => (prev === view.phase ? prev : view.phase));
      setPhaseEndsAt((prev) => (prev === view.phaseEndsAt ? prev : view.phaseEndsAt));
      setWinner((prev) => (prev === view.winner ? prev : view.winner));

      const next: MetaMap = {};
      for (const [id, player] of playersRef.current) {
        next[id] = {
          role: player.role,
          alive: player.alive,
          hp: player.hp,
          propType: player.propType,
        };
      }
      setMeta((prev) => (metaEqual(prev, next) ? prev : next));
    }, STATE_POLL_MS);
    return () => clearInterval(poll);
  }, [room]);

  const localMeta = meta[sessionId];
  const localRole: Role = localMeta?.role ?? "prop";
  const localAlive = localMeta?.alive ?? true;
  const localHp = localMeta?.hp ?? 0;
  const localProp = localMeta?.propType ?? "";

  const canTransform = localRole === "prop" && localAlive && (phase === "hiding" || phase === "hunting");
  const canShoot = localRole === "hunter" && localAlive && phase === "hunting";
  const showCrosshair = canTransform || canShoot;

  const hint = !localAlive
    ? "Eliminato — guardi da spettatore"
    : canShoot
      ? "Click per sparare · sbagliare costa vita"
      : canTransform
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
          teleportRef={teleportRef}
        />
      </Canvas>

      {showCrosshair && <div className="crosshair" />}

      {localRole === "hunter" && phase === "hiding" && (
        <div className="blindout">
          <div>I prop si stanno nascondendo…</div>
          <div className="blindout-timer">
            La caccia inizia
            <Countdown endsAt={phaseEndsAt} />
          </div>
        </div>
      )}

      {phase === "round_end" && winner !== "" && <div className="banner">{WINNER_LABEL[winner]}</div>}

      <div className="hud">
        <div>
          <b>{PHASE_LABEL[phase]}</b>
          <Countdown endsAt={phaseEndsAt} />
        </div>
        <div>
          Ruolo: <b>{ROLE_LABEL[localRole]}</b>
          {localProp ? ` (${localProp})` : ""}
        </div>
        {localRole === "hunter" && (
          <div>
            HP: <b>{localHp}</b>
          </div>
        )}
        <div>Giocatori: {ids.length}</div>
        <div style={{ marginTop: 6, opacity: 0.8 }}>{hint}</div>
      </div>
    </>
  );
}
