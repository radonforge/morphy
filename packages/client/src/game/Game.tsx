import { Callbacks } from "@colyseus/sdk";
import { Canvas } from "@react-three/fiber";
import {
  HIDE_DURATION_MS,
  HUNTER_MAX_HP,
  type KillEvent,
  MAX_CHAT_LENGTH,
  type MapDefinition,
  MIN_PLAYERS_TO_START,
  MSG_CHAT,
  MSG_KILL,
  MSG_MAP,
  MSG_READY,
  MSG_SHOT_RESULT,
  MSG_TAUNT,
  MSG_TELEPORT,
  type Phase,
  parseMapDefinition,
  ROUND_DURATION_MS,
  ROUND_END_MS,
  type Role,
  START_COUNTDOWN_MS,
  type Winner,
} from "@webhunt/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Connection } from "../net/connection";
import {
  isMuted,
  playDeath,
  playHitConfirm,
  playKill,
  playMiss,
  playRoundEnd,
  playRoundStart,
  playTaunt,
  startAmbient,
  stopAmbient,
  toggleMuted,
} from "./audio";
import { Scene, TAUNT_PULSE_SECONDS } from "./Scene";
import type { MetaMap, PlayerMeta, RemotePlayerView, TauntPulseRef, TeleportRef } from "./types";

const STATE_POLL_MS = 200;
const COUNTDOWN_TICK_MS = 250;
const TAUNT_MAX_DISTANCE = 40;
const CHAT_HISTORY = 6;
const SHOT_FX_MS = 220;
const MUZZLE_MS = 60;
const KILL_FEED_MS = 5000;
const KILL_FEED_MAX = 5;
const LOW_TIME_MS = 10000;
const HP_LOW_THRESHOLD = 40;
const RING_RADIUS = 19;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const PHASE_DURATION_MS: Record<Phase, number> = {
  lobby: 0,
  starting: START_COUNTDOWN_MS,
  hiding: HIDE_DURATION_MS,
  hunting: ROUND_DURATION_MS,
  round_end: ROUND_END_MS,
};

interface GameProps {
  connection: Connection;
  onLeave: () => void;
}

interface RoomStateView {
  phase: Phase;
  phaseEndsAt: number;
  winner: Winner;
}

interface ChatLine {
  key: number;
  name: string;
  text: string;
}

interface KillLine {
  key: number;
  text: string;
}

function killText(event: KillEvent): string {
  switch (event.reason) {
    case "self":
      return `${event.victimName} si è auto-eliminato`;
    case "converted":
      return `${event.byName} ha catturato ${event.victimName}`;
    default:
      return `${event.byName} ha eliminato ${event.victimName}`;
  }
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
      ai.name === bi.name &&
      ai.role === bi.role &&
      ai.alive === bi.alive &&
      ai.hp === bi.hp &&
      ai.kills === bi.kills &&
      ai.propType === bi.propType &&
      ai.ready === bi.ready &&
      ai.avatar === bi.avatar
    );
  });
}

function sortStandings(ids: string[], meta: MetaMap): { id: string; player: PlayerMeta }[] {
  return ids
    .map((id) => ({ id, player: meta[id] }))
    .filter((row): row is { id: string; player: PlayerMeta } => row.player !== undefined)
    .sort((a, b) => {
      if (a.player.role !== b.player.role) return a.player.role === "hunter" ? -1 : 1;
      if (b.player.kills !== a.player.kills) return b.player.kills - a.player.kills;
      return a.player.name.localeCompare(b.player.name);
    });
}

function StandingsTable({ ids, meta, localId }: { ids: string[]; meta: MetaMap; localId: string }) {
  return (
    <>
      <div className="scoreboard-row scoreboard-head">
        <span>Giocatore</span>
        <span>Ruolo</span>
        <span>Stato</span>
        <span>Kill</span>
      </div>
      {sortStandings(ids, meta).map(({ id, player }) => (
        <div
          key={id}
          className={`scoreboard-row${id === localId ? " scoreboard-self" : ""}${
            player.alive ? "" : " scoreboard-dead"
          }`}
        >
          <span>{player.name}</span>
          <span className={`role-${player.role}`}>{ROLE_LABEL[player.role]}</span>
          <span>
            {player.alive
              ? player.role === "hunter"
                ? `Vivo · ${player.hp} HP`
                : "Vivo"
              : "Eliminato"}
          </span>
          <span>{player.role === "hunter" ? player.kills : "—"}</span>
        </div>
      ))}
    </>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h2.3L8.2 3.4v9.2L5.3 10H3z" fill="currentColor" stroke="none" />
      {muted ? (
        <path d="M10.6 6l3 4M13.6 6l-3 4" />
      ) : (
        <>
          <path d="M10.4 6.1a2.6 2.6 0 0 1 0 3.8" />
          <path d="M12.2 4.6a5 5 0 0 1 0 6.8" />
        </>
      )}
    </svg>
  );
}

function Scoreboard({ ids, meta, localId }: { ids: string[]; meta: MetaMap; localId: string }) {
  return (
    <div className="scoreboard">
      <div className="scoreboard-card panel">
        <div className="eyebrow standings-title">Classifica</div>
        <StandingsTable ids={ids} meta={meta} localId={localId} />
      </div>
    </div>
  );
}

function topHunter(ids: string[], meta: MetaMap): PlayerMeta | null {
  let best: PlayerMeta | null = null;
  for (const id of ids) {
    const player = meta[id];
    if (!player || player.role !== "hunter") continue;
    if (!best || player.kills > best.kills) best = player;
  }
  return best && best.kills > 0 ? best : null;
}

function ResultScreen({
  winner,
  endsAt,
  ids,
  meta,
  localId,
}: {
  winner: Winner;
  endsAt: number;
  ids: string[];
  meta: MetaMap;
  localId: string;
}) {
  const mvp = topHunter(ids, meta);
  const role = meta[localId]?.role ?? "prop";
  const won =
    (role === "hunter" && winner === "hunters") || (role === "prop" && winner === "props");
  return (
    <div className="result">
      <div className="result-card panel">
        <div className={`result-title ${won ? "result-win" : "result-lose"}`}>
          {WINNER_LABEL[winner]}
        </div>
        {mvp && (
          <div className="result-mvp">
            Miglior cacciatore: {mvp.name} · {mvp.kills} kill
          </div>
        )}
        <div className="result-standings">
          <StandingsTable ids={ids} meta={meta} localId={localId} />
        </div>
        <div className="result-next">
          Nuovo round
          <Countdown endsAt={endsAt} />
        </div>
      </div>
    </div>
  );
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

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function RingTimer({ endsAt, total }: { endsAt: number; total: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, endsAt - now);
  const fraction = total > 0 ? Math.min(1, remaining / total) : 0;
  const low = remaining > 0 && remaining <= LOW_TIME_MS;
  return (
    <div className={`ring${low ? " ring-low" : ""}`}>
      <svg viewBox="0 0 46 46" width="46" height="46">
        <circle className="ring-track" cx="23" cy="23" r={RING_RADIUS} />
        <circle
          className="ring-fill"
          cx="23"
          cy="23"
          r={RING_RADIUS}
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
        />
      </svg>
      <span className="ring-label">{formatClock(remaining)}</span>
    </div>
  );
}

export function Game({ connection, onLeave }: GameProps) {
  const { room, sessionId } = connection;
  const playersRef = useRef<Map<string, RemotePlayerView>>(new Map());
  const teleportRef = useRef<{ x: number; z: number } | null>(null) as TeleportRef;
  const tauntPulseRef = useRef<Map<string, number>>(new Map()) as TauntPulseRef;
  const msgSeq = useRef(0);
  const chatOpenRef = useRef(false);
  const fxSeq = useRef(0);
  const muzzleSeq = useRef(0);

  const [map, setMap] = useState<MapDefinition | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [meta, setMeta] = useState<MetaMap>({});
  const [phase, setPhase] = useState<Phase>("lobby");
  const [phaseEndsAt, setPhaseEndsAt] = useState(0);
  const [winner, setWinner] = useState<Winner>("");
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [killFeed, setKillFeed] = useState<KillLine[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [shotFx, setShotFx] = useState<{ kind: "hit" | "miss"; seq: number } | null>(null);
  const [muzzle, setMuzzle] = useState<number | null>(null);
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const [muted, setMuted] = useState(() => isMuted());
  const prevPhaseRef = useRef<Phase>("lobby");

  chatOpenRef.current = chatOpen;

  const onShoot = useCallback(() => setMuzzle(muzzleSeq.current++), []);

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

    room.onMessage(MSG_TAUNT, (message: unknown) => {
      if (typeof message !== "object" || message === null) return;
      const m = message as Record<string, unknown>;
      if (typeof m.playerId !== "string" || !isFiniteNumber(m.x) || !isFiniteNumber(m.z)) return;
      tauntPulseRef.current.set(m.playerId, TAUNT_PULSE_SECONDS);
      const local = playersRef.current.get(sessionId);
      const volume = local
        ? Math.max(0, 1 - Math.hypot(local.x - m.x, local.z - m.z) / TAUNT_MAX_DISTANCE)
        : 0.7;
      playTaunt(volume);
    });

    room.onMessage(MSG_CHAT, (message: unknown) => {
      if (typeof message !== "object" || message === null) return;
      const m = message as Record<string, unknown>;
      if (typeof m.name !== "string" || typeof m.text !== "string") return;
      const line: ChatLine = { key: msgSeq.current++, name: m.name, text: m.text };
      setMessages((prev) => [...prev, line].slice(-CHAT_HISTORY));
    });

    room.onMessage(MSG_SHOT_RESULT, (message: unknown) => {
      if (typeof message !== "object" || message === null) return;
      const hit = (message as Record<string, unknown>).hit === true;
      if (hit) {
        playHitConfirm();
      } else {
        playMiss();
      }
      setShotFx({ kind: hit ? "hit" : "miss", seq: fxSeq.current++ });
    });

    room.onMessage(MSG_KILL, (message: unknown) => {
      if (typeof message !== "object" || message === null) return;
      const event = message as KillEvent;
      if (typeof event.victimName !== "string" || typeof event.reason !== "string") return;
      const key = fxSeq.current++;
      setKillFeed((prev) => [...prev.slice(-(KILL_FEED_MAX - 1)), { key, text: killText(event) }]);
      setTimeout(
        () => setKillFeed((prev) => prev.filter((line) => line.key !== key)),
        KILL_FEED_MS,
      );
      if (event.victimId === sessionId) {
        if (event.reason === "converted") {
          playRoundStart();
        } else {
          playDeath();
        }
      } else if (event.byId !== sessionId) {
        playKill();
      }
    });

    room.onMessage(MSG_MAP, (raw: unknown) => setMap(parseMapDefinition(raw)));
    room.send(MSG_MAP);

    room.onError((code, errMessage) => {
      console.error("[webhunt] room error", code, errMessage);
      onLeave();
    });
    room.onLeave(() => onLeave());

    return () => {
      void room.leave();
    };
  }, [room, onLeave, teleportRef, tauntPulseRef, sessionId]);

  useEffect(() => {
    if (!shotFx) return;
    const timer = setTimeout(() => setShotFx(null), SHOT_FX_MS);
    return () => clearTimeout(timer);
  }, [shotFx]);

  useEffect(() => {
    if (muzzle === null) return;
    const timer = setTimeout(() => setMuzzle(null), MUZZLE_MS);
    return () => clearTimeout(timer);
  }, [muzzle]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (chatOpenRef.current) return;
      if (e.code === "KeyT") {
        e.preventDefault();
        if (document.pointerLockElement) {
          document.exitPointerLock();
        }
        setChatOpen(true);
      } else if (e.code === "KeyM") {
        setMuted(toggleMuted());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    startAmbient();
    return () => stopAmbient();
  }, []);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (phase === prev) return;
    if (phase === "hiding") {
      playRoundStart();
    } else if (phase === "round_end") {
      const role = meta[sessionId]?.role ?? "prop";
      const won =
        (role === "hunter" && winner === "hunters") || (role === "prop" && winner === "props");
      playRoundEnd(won);
    }
  }, [phase, winner, meta, sessionId]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Tab") return;
      e.preventDefault();
      if (!chatOpenRef.current) setScoreboardOpen(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "Tab") setScoreboardOpen(false);
    };
    const onBlur = () => setScoreboardOpen(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    const poll = setInterval(() => {
      const view = room.state as unknown as RoomStateView;
      setPhase((prev) => (prev === view.phase ? prev : view.phase));
      setPhaseEndsAt((prev) => (prev === view.phaseEndsAt ? prev : view.phaseEndsAt));
      setWinner((prev) => (prev === view.winner ? prev : view.winner));

      const next: MetaMap = {};
      for (const [id, player] of playersRef.current) {
        next[id] = {
          name: player.name,
          role: player.role,
          alive: player.alive,
          hp: player.hp,
          kills: player.kills,
          propType: player.propType,
          ready: player.ready,
          avatar: player.avatar,
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
  const localReady = localMeta?.ready ?? false;

  const toggleReady = useCallback(
    () => room.send(MSG_READY, { ready: !localReady }),
    [room, localReady],
  );

  const readyCount = ids.reduce((n, id) => (meta[id]?.ready ? n + 1 : n), 0);
  const aliveProps = ids.reduce((n, id) => {
    const player = meta[id];
    return player && player.role === "prop" && player.alive ? n + 1 : n;
  }, 0);

  const canTransform =
    localRole === "prop" && localAlive && (phase === "hiding" || phase === "hunting");
  const canShoot = localRole === "hunter" && localAlive && phase === "hunting";
  const showCrosshair = (canTransform || canShoot) && !chatOpen;

  const closeChat = () => {
    setChatOpen(false);
    setChatDraft("");
  };

  const onChatKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const text = chatDraft.trim();
      if (text) {
        room.send(MSG_CHAT, { text });
      }
      closeChat();
    } else if (e.key === "Escape") {
      closeChat();
    }
  };

  const hint = !localAlive
    ? "Eliminato — guardi da spettatore"
    : canShoot
      ? "Click spara · Shift corri · Spazio salta · sbagliare costa vita · T chat · Tab classifica · M audio"
      : canTransform
        ? "Guarda un oggetto e premi E · Shift corri · T chat · Tab classifica · M audio"
        : localRole === "hunter" && phase === "hiding"
          ? "Sei accecato… attendi la caccia"
          : "WASD muovi · Shift corri · click+mouse visuale · T chat · Tab classifica · M audio";

  if (!map) {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <h1>Caricamento mappa…</h1>
        </div>
      </div>
    );
  }

  return (
    <>
      <Canvas dpr={[1, 1.5]} shadows camera={{ position: [0, 12, 18], fov: 55 }}>
        <Scene
          room={room}
          map={map}
          localId={sessionId}
          ids={ids}
          playersRef={playersRef}
          meta={meta}
          phase={phase}
          teleportRef={teleportRef}
          tauntPulseRef={tauntPulseRef}
          chatOpen={chatOpen}
          onShoot={onShoot}
        />
      </Canvas>

      {phase === "lobby" && (
        <div className="lobby-overlay">
          <div className="lobby-overlay-card panel">
            <h2>In attesa di giocatori</h2>
            <ul className="ready-list">
              {ids.map((id) => (
                <li key={id} className={meta[id]?.ready ? "is-ready" : ""}>
                  <span>
                    {meta[id]?.name ?? "?"}
                    {id === sessionId ? " (tu)" : ""}
                  </span>
                  <span>{meta[id]?.ready ? "✔ Pronto" : "… in attesa"}</span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={toggleReady}>
              {localReady ? "Annulla" : "Pronto"}
            </button>
            <span className="lobby-overlay-meta">
              {ids.length < MIN_PLAYERS_TO_START
                ? `Servono almeno ${MIN_PLAYERS_TO_START} giocatori`
                : `Pronti: ${readyCount}/${ids.length} — si parte quando tutti sono pronti`}
            </span>
          </div>
        </div>
      )}

      {muzzle !== null && <div className="muzzle" />}

      {showCrosshair && (
        <div className={`reticle${shotFx ? ` ${shotFx.kind}` : ""}`}>
          <i className="tick tick-n" />
          <i className="tick tick-e" />
          <i className="tick tick-s" />
          <i className="tick tick-w" />
          <span className="reticle-dot" />
        </div>
      )}

      {shotFx?.kind === "miss" && <div className="vignette" />}

      {localRole === "hunter" && phase === "hiding" && (
        <div className="blindout">
          <div className="blindout-title">I prop si stanno nascondendo</div>
          <div className="blindout-timer">
            La caccia inizia
            <Countdown endsAt={phaseEndsAt} />
          </div>
        </div>
      )}

      {phase === "round_end" && winner !== "" && (
        <ResultScreen
          winner={winner}
          endsAt={phaseEndsAt}
          ids={ids}
          meta={meta}
          localId={sessionId}
        />
      )}

      {scoreboardOpen && <Scoreboard ids={ids} meta={meta} localId={sessionId} />}

      <div className="killfeed">
        {killFeed.map((line) => (
          <div key={line.key} className="killfeed-line">
            {line.text}
          </div>
        ))}
      </div>

      <div className="chat">
        {messages.map((m) => (
          <div key={m.key} className="chat-line">
            <b>{m.name}:</b> {m.text}
          </div>
        ))}
        {chatOpen && (
          <input
            className="chat-input"
            autoFocus
            maxLength={MAX_CHAT_LENGTH}
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            onKeyDown={onChatKeyDown}
            placeholder="Messaggio… (Invio invia, Esc chiudi)"
          />
        )}
      </div>

      {phase !== "lobby" && (
        <div className="topbar panel">
          <div className="topbar-phase">
            <span className="eyebrow">Round</span>
            <span className="topbar-phase-name">{PHASE_LABEL[phase]}</span>
          </div>
          {phaseEndsAt > 0 && <RingTimer endsAt={phaseEndsAt} total={PHASE_DURATION_MS[phase]} />}
          <div className="topbar-meta">
            <span className={`badge badge-${localRole}`}>{ROLE_LABEL[localRole]}</span>
            {(phase === "hiding" || phase === "hunting") && (
              <span className="targets" title="Prop ancora in gioco">
                <span className="targets-dot" />
                {aliveProps}
              </span>
            )}
          </div>
          <button
            type="button"
            className={`topbar-mute${muted ? " is-muted" : ""}`}
            onClick={() => setMuted(toggleMuted())}
            title={muted ? "Riattiva audio (M)" : "Disattiva audio (M)"}
            aria-label={muted ? "Riattiva audio" : "Disattiva audio"}
          >
            <SpeakerIcon muted={muted} />
          </button>
        </div>
      )}

      {localRole === "hunter" && localAlive && phase !== "lobby" && (
        <div className={`vitals panel${localHp <= HP_LOW_THRESHOLD ? " hp-low" : ""}`}>
          <span className="eyebrow">Integrità</span>
          <div className="vitals-row">
            <div className="hp">
              <div className="hp-fill" style={{ width: `${(localHp / HUNTER_MAX_HP) * 100}%` }} />
            </div>
            <span className="hp-val">{localHp}</span>
          </div>
        </div>
      )}

      {phase !== "lobby" && <div className="hint">{hint}</div>}
    </>
  );
}
