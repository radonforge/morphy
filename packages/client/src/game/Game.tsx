import { Callbacks } from "@colyseus/sdk";
import {
  DEFAULT_WEAPON,
  HIDE_DURATION_MS,
  HUNTER_MAX_HP,
  isWeaponId,
  type KillEvent,
  MAP_CATALOG,
  MAX_CHAT_LENGTH,
  type MapDefinition,
  MIN_PLAYERS_TO_START,
  MSG_CHAT,
  MSG_DECOY_BREAK,
  MSG_DECOY_PLACED,
  MSG_KILL,
  MSG_MAP,
  MSG_READY,
  MSG_SET_WEAPON,
  MSG_SHOT_FIRED,
  MSG_SHOT_RESULT,
  MSG_SONAR,
  MSG_SONAR_PING,
  MSG_START,
  MSG_TAUNT,
  MSG_TAUNT_REQUEST,
  MSG_TELEPORT,
  type Phase,
  parseMapDefinition,
  ROUND_DURATION_MS,
  ROUND_END_MS,
  type Role,
  SONAR_COOLDOWN_MS,
  SONAR_HEARING_RADIUS,
  START_COUNTDOWN_MS,
  TAUNT_COOLDOWN_MS,
  TAUNT_DARING_POINTS,
  TAUNT_HEARING_RADIUS,
  WEAPON_IDS,
  WEAPONS,
  type WeaponId,
  type Winner,
} from "@morphy/shared";
import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Vector3, type WebGLRenderer } from "three";
import type { Connection } from "../net/connection";
import {
  isMuted,
  playCatch,
  playDeath,
  playDecoyBreak,
  playHitConfirm,
  playKill,
  playMiss,
  playMorph,
  playRoundEnd,
  playRoundStart,
  playSonar,
  playTaunt,
  playWeaponShot,
  playYouHuntNow,
  preloadSamples,
  toggleMuted,
} from "./audio";
import { ControlsBar, ControlsDialog } from "./Controls";
import { CopyDiagnostics } from "./CopyDiagnostics";
import { deviceHints } from "./deviceProbe";
import {
  createFrameRing,
  type DiagnosticsReport,
  type FrameRing,
  formatDiagnostics,
  frameStats,
  gpuInfo,
  recordFrame,
} from "./diagnostics";
import {
  type GraphicsTier,
  MAX_RENDER_FPS,
  nextRoundTier,
  type PostSettings,
  postSettings,
  type RoundFrames,
  resolveTier,
  TIER_SETTINGS,
} from "./graphicsTier";
import { useGuardedFrame } from "./guardedFrame";
import { LookSensitivitySlider } from "./LookSensitivitySlider";
import { PropFootsteps } from "./PropFootsteps";
import { lockPointer } from "./pointerLock";
import { usePostFx } from "./postFx";
import { graphicsPreference, isPerfHudEnabled } from "./prefs";
import {
  type CaptureRecord,
  nextStartingRoles,
  phaseLabel,
  propsLeftLabel,
  resultStatus,
  type StartingRoles,
  storyLine,
  wonRound,
} from "./roundStory";
import { CAUGHT_CAM_MS, DEFAULT_PITCH, GAME_FOV, Scene, themeLook } from "./Scene";
import { falloff, type ListenerPose, type ListenerRef, stereoPan } from "./spatialAudio";
import type {
  BreaksRef,
  CatchMomentRef,
  CaughtCam,
  DecoyView,
  LookRef,
  MetaMap,
  PlayerMeta,
  PlayersRef,
  RemotePlayerView,
  SceneMetaMap,
  ShotsRef,
  TauntPulseRef,
  TeleportRef,
} from "./types";
import { PLAYER_META_FIELDS, SCENE_META_FIELDS } from "./types";

const COUNTDOWN_TICK_MS = 250;
const SHOT_SOUND_MAX_DISTANCE = 60;
const REMOTE_SHOT_VOLUME = 0.7;
const CHAT_HISTORY = 6;
const SHOT_FX_MS = 220;
const MUZZLE_MS = 60;
const KILL_FEED_MS = 5000;
const KILL_FEED_MAX = 5;
const LOW_TIME_MS = 10000;
const HP_LOW_THRESHOLD = 40;
const RING_RADIUS = 19;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const PERF_SAMPLE_WINDOW_S = 0.5;
const RENDER_GATE_PRIORITY = 1;
const RENDER_INTERVAL_S = 1 / MAX_RENDER_FPS;
const RENDER_INTERVAL_SLACK_S = 0.002;
const GFX_LOW_CLASS = "gfx-low";
const ROLE_CARD_MS = 2_500;
const PHASE_BANNER_MS = 1_600;
const CATCH_BANNER_MS = 1_400;
const HIT_MARKER_MS = 320;
const CATCH_SOUND_MAX_DISTANCE = 40;
const MS_PER_S = 1000;
const BYTES_PER_MB = 1024 * 1024;
/**
 * Named rather than left to the Canvas default, which asks for PCFSoft. three 0.184 downgrades
 * that to PCF on the next shadow render, and the Canvas re-applies its config on every React
 * render, sees the type change back, and forces a full shadow redraw: once per ping, per shot.
 */
const GAME_SHADOW_TYPE = "percentage" as const;

const PHASE_DURATION_MS: Record<Phase, number> = {
  lobby: 0,
  starting: START_COUNTDOWN_MS,
  hiding: HIDE_DURATION_MS,
  hunting: ROUND_DURATION_MS,
  round_end: ROUND_END_MS,
};

/**
 * The match menu belongs to a round that is actually being played. The lobby
 * overlay and the result screen carry their own way out, and letting the menu
 * outlive the round would paint it over those.
 */
function isRoundInPlay(phase: Phase): boolean {
  return phase === "starting" || phase === "hiding" || phase === "hunting";
}

interface GameProps {
  connection: Connection;
  onBackToParty: () => void;
  onLeaveMatch: () => void;
  onRestartView: () => void;
}

interface RoomStateView {
  phase: Phase;
  phaseEndsAt: number;
  winner: Winner;
  hostId: string;
  isPrivate: boolean;
  fillAt: number;
}

interface LobbyStatus {
  label: string;
  endsAt: number;
}

/**
 * What a public lobby is waiting on, in the order the server resolves it: an
 * armed auto-start outranks a pending bot fill, which outranks having nobody
 * to play against yet. `present` counts connected seats the way the server's
 * start threshold does, while the ready tally spans every seat, because a
 * held seat that never readied still blocks an all-ready start.
 */
function publicLobbyStatus(
  present: number,
  ready: number,
  seats: number,
  phaseEndsAt: number,
  fillAt: number,
): LobbyStatus {
  if (phaseEndsAt > 0) {
    return { label: `Ready ${ready}/${seats} · auto-start`, endsAt: phaseEndsAt };
  }
  if (fillAt > 0) {
    return { label: "Searching for players · bots join", endsAt: fillAt };
  }
  if (present < MIN_PLAYERS_TO_START) {
    return { label: `Need at least ${MIN_PLAYERS_TO_START} players`, endsAt: 0 };
  }
  return { label: `Ready ${ready}/${seats} · everyone ready starts it now`, endsAt: 0 };
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
      return `${event.victimName} self-eliminated`;
    case "converted":
      return `${event.byName} captured ${event.victimName}`;
    default:
      return `${event.byName} eliminated ${event.victimName}`;
  }
}

const ROLE_LABEL: Record<Role, string> = {
  hunter: "Hunter",
  prop: "Prop",
};

const WINNER_LABEL: Record<Winner, string> = {
  hunters: "Hunters win!",
  props: "Props win!",
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
      PLAYER_META_FIELDS.every((field) => ai[field] === bi[field])
    );
  });
}

function sceneMetaOf(meta: MetaMap, prev: SceneMetaMap): SceneMetaMap {
  const ids = Object.keys(meta);
  const unchanged =
    ids.length === Object.keys(prev).length &&
    ids.every((id) => {
      const before = prev[id];
      const now = meta[id];
      return (
        before !== undefined &&
        now !== undefined &&
        SCENE_META_FIELDS.every((field) => before[field] === now[field])
      );
    });
  if (unchanged) return prev;
  const next: SceneMetaMap = {};
  for (const [id, player] of Object.entries(meta)) {
    next[id] = {
      role: player.role,
      alive: player.alive,
      propType: player.propType,
      avatar: player.avatar,
    };
  }
  return next;
}

interface StandingRow {
  id: string;
  player: PlayerMeta;
  role: Role;
}

/** What a player is ranked on within their side: captures for a hunter, taunt points for a prop. */
function standing(row: StandingRow): number {
  return row.role === "hunter" ? row.player.kills : row.player.score;
}

function sortStandings(
  ids: string[],
  meta: MetaMap,
  roleOf: (id: string, player: PlayerMeta) => Role,
): StandingRow[] {
  return ids
    .flatMap((id) => {
      const player = meta[id];
      return player ? [{ id, player, role: roleOf(id, player) }] : [];
    })
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "hunter" ? -1 : 1;
      if (standing(b) !== standing(a)) return standing(b) - standing(a);
      return a.player.name.localeCompare(b.player.name);
    });
}

/**
 * What the round-end card needs to tell each player's round rather than its last frame:
 * the role they started with and, for a prop, when it was caught.
 */
interface RoundStory {
  startingRoles: StartingRoles;
  captures: Readonly<Record<string, CaptureRecord>>;
}

function liveStatus(player: PlayerMeta): string {
  if (!player.connected) return "Reconnecting…";
  if (!player.alive) return "Eliminated";
  return player.role === "hunter" ? `Alive · ${player.hp} HP` : "Alive";
}

/**
 * The standings, live by default: current role, status and ping. Given a `story`, it is the
 * round-end version instead, which ranks and labels everyone by the role they started with,
 * says how each prop's round ended, and leaves out ping, which says nothing about a round.
 */
function StandingsTable({
  ids,
  meta,
  localId,
  story,
}: {
  ids: string[];
  meta: MetaMap;
  localId: string;
  story?: RoundStory;
}) {
  const roleOf = (id: string, player: PlayerMeta): Role => story?.startingRoles[id] ?? player.role;
  const rowClass = story ? "scoreboard-row scoreboard-row-result" : "scoreboard-row";
  return (
    <>
      <div className={`${rowClass} scoreboard-head`}>
        <span>Player</span>
        <span>{story ? "Started as" : "Role"}</span>
        <span>{story ? "Result" : "Status"}</span>
        <span>Kills</span>
        <span>Points</span>
        {!story && <span>Ping</span>}
      </div>
      {sortStandings(ids, meta, roleOf).map(({ id, player, role }) => (
        <div
          key={id}
          className={`${rowClass}${id === localId ? " scoreboard-self" : ""}${
            player.alive ? "" : " scoreboard-dead"
          }`}
        >
          <span>{player.name}</span>
          <span className={`role-${role}`}>{ROLE_LABEL[role]}</span>
          <span>
            {story ? resultStatus(role, story.captures[id], player.alive) : liveStatus(player)}
          </span>
          <span>{player.role === "hunter" ? player.kills : "-"}</span>
          <span>{player.role === "prop" || player.score > 0 ? player.score : "-"}</span>
          {!story && <span>{player.ping} ms</span>}
        </div>
      ))}
    </>
  );
}

/**
 * Samples the r3f frame loop and writes "N fps · M ms" straight into the
 * readout's DOM node; the text never passes through React state, same
 * discipline as the position interpolation.
 */
function PerfProbe({
  playersRef,
  localId,
  nodeRef,
  ring,
  round,
  inRound,
}: {
  playersRef: PlayersRef;
  localId: string;
  nodeRef: React.RefObject<HTMLDivElement | null>;
  ring: FrameRing;
  round: RoundFrames;
  inRound: boolean;
}) {
  const frames = useRef(0);
  const windowStart = useRef(0);
  useGuardedFrame(({ clock }, delta) => {
    recordFrame(ring, delta * MS_PER_S);
    if (inRound) {
      round.frames += 1;
      round.totalMs += delta * MS_PER_S;
    }
    frames.current++;
    const elapsed = clock.elapsedTime - windowStart.current;
    if (elapsed < PERF_SAMPLE_WINDOW_S) return;
    const fps = Math.round(frames.current / elapsed);
    frames.current = 0;
    windowStart.current = clock.elapsedTime;
    const ping = playersRef.current.get(localId)?.ping ?? 0;
    if (nodeRef.current) nodeRef.current.textContent = `${fps} fps · ${ping} ms`;
  });
  return null;
}

/**
 * Owns the frame's render call so it can skip it: a hunter spends the hiding phase
 * behind an opaque blindout, and drawing the whole map under it for 20 s is pure
 * waste on a weak GPU. Taking the render over, rather than pausing the frame loop,
 * keeps every `useFrame` running, so interpolation, audio and the input pipeline
 * carry on unchanged underneath. It also caps drawing at {@link MAX_RENDER_FPS},
 * keeping the phase of the cap so a 144 Hz display lands near 60 rather than 48.
 */
function RenderGate({
  skip,
  post,
  antialias,
}: {
  skip: boolean;
  post: PostSettings | null;
  antialias: boolean;
}) {
  const lastRender = useRef(Number.NEGATIVE_INFINITY);
  const composer = usePostFx(post, antialias);
  useGuardedFrame(({ gl, scene, camera, clock }) => {
    if (skip) return;
    const now = clock.elapsedTime;
    const since = now - lastRender.current;
    if (since < RENDER_INTERVAL_S - RENDER_INTERVAL_SLACK_S) return;
    lastRender.current = Number.isFinite(since) ? now - (since % RENDER_INTERVAL_S) : now;
    if (composer) composer.render();
    else gl.render(scene, camera);
  }, RENDER_GATE_PRIORITY);
  return null;
}

/**
 * Keeps the listener on the local player, facing where the camera looks, so a
 * positional sound pans the way the view is turned. It writes a ref every
 * frame and never touches React state.
 */
function ListenerProbe({
  playersRef,
  localId,
  listenerRef,
}: {
  playersRef: PlayersRef;
  localId: string;
  listenerRef: ListenerRef;
}) {
  const forward = useMemo(() => new Vector3(), []);
  useGuardedFrame(({ camera }) => {
    camera.getWorldDirection(forward);
    const pose = listenerRef.current;
    const self = playersRef.current.get(localId);
    pose.x = self?.x ?? camera.position.x;
    pose.z = self?.z ?? camera.position.z;
    pose.forwardX = forward.x;
    pose.forwardZ = forward.z;
  });
  return null;
}

interface LongTaskTally {
  count: number;
  longestMs: number;
}

interface BrowserExtras {
  deviceMemory?: number;
  memory?: { usedJSHeapSize?: number };
}

function readDiagnostics(
  gl: WebGLRenderer,
  ring: FrameRing,
  longTasks: LongTaskTally,
  contextLosses: number,
  mapName: string,
  phase: Phase,
  players: number,
  graphics: string,
): DiagnosticsReport {
  const context = gl.getContext();
  const debug = context.getExtension("WEBGL_debug_renderer_info");
  const unmasked = debug ? String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : null;
  const deviceMemory = (navigator as Navigator & BrowserExtras).deviceMemory;
  const heap = (performance as Performance & BrowserExtras).memory?.usedJSHeapSize;
  return {
    version: __MORPHY_VERSION__,
    build: __MORPHY_BUILD__,
    userAgent: navigator.userAgent,
    gpu: gpuInfo(unmasked, String(context.getParameter(context.RENDERER))),
    antialias: context.getContextAttributes()?.antialias ?? false,
    pixelRatio: gl.getPixelRatio(),
    bufferWidth: context.drawingBufferWidth,
    bufferHeight: context.drawingBufferHeight,
    cores: navigator.hardwareConcurrency || null,
    memoryGb: deviceMemory ?? null,
    frames: frameStats(ring),
    drawCalls: gl.info.render.calls,
    triangles: gl.info.render.triangles,
    geometries: gl.info.memory.geometries,
    textures: gl.info.memory.textures,
    programs: gl.info.programs?.length ?? 0,
    heapMb: heap === undefined ? null : heap / BYTES_PER_MB,
    longTasks: longTasks.count,
    longestTaskMs: longTasks.longestMs,
    contextLosses,
    map: mapName,
    phase,
    players,
    graphics,
  };
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
        <div className="eyebrow standings-title">Standings</div>
        <StandingsTable ids={ids} meta={meta} localId={localId} />
      </div>
    </div>
  );
}

function topHunter(ids: string[], meta: MetaMap): PlayerMeta | null {
  let best: PlayerMeta | null = null;
  for (const id of ids) {
    const player = meta[id];
    if (player?.role !== "hunter") continue;
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
  story,
  onLeave,
}: {
  winner: Winner;
  endsAt: number;
  ids: string[];
  meta: MetaMap;
  localId: string;
  story: RoundStory;
  onLeave: () => void;
}) {
  const mvp = topHunter(ids, meta);
  const local = meta[localId];
  const startingRole = story.startingRoles[localId] ?? local?.role ?? "prop";
  const won = wonRound(startingRole, winner);
  return (
    <div className="result">
      <div className="result-card panel">
        <div className="result-winner">{WINNER_LABEL[winner]}</div>
        <div className={`result-title ${won ? "result-win" : "result-lose"}`}>
          {won ? "You win" : "You lose"}
        </div>
        <div className="result-story">
          {storyLine(startingRole, story.captures[localId], local?.kills ?? 0)}
        </div>
        {mvp && (
          <div className="result-mvp">
            Top hunter: {mvp.name} · {mvp.kills} kills
          </div>
        )}
        <div className="result-standings">
          <StandingsTable ids={ids} meta={meta} localId={localId} story={story} />
        </div>
        <div className="result-next">
          New round
          <Countdown endsAt={endsAt} />
        </div>
        <div className="result-actions">
          <button type="button" className="btn-ghost" onClick={onLeave}>
            Leave match
          </button>
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

/**
 * A value that shows for `durationMs` and then clears itself. Showing it again restarts
 * the clock, so two moments in quick succession each get their full time on screen.
 */
function useTransient<T>(durationMs: number): [T | null, (value: T) => void] {
  const [entry, setEntry] = useState<{ value: T } | null>(null);
  useEffect(() => {
    if (!entry) return;
    const timer = setTimeout(() => setEntry(null), durationMs);
    return () => clearTimeout(timer);
  }, [entry, durationMs]);
  const show = useCallback((value: T) => setEntry({ value }), []);
  return [entry?.value ?? null, show];
}

function LiveClock({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return <span className="live-clock">{formatClock(endsAt - now)}</span>;
}

const ROLE_CARD_COPY: Record<Role, { title: string; goal: string; release: string }> = {
  prop: {
    title: "You're a prop",
    goal: "Look like you belong here, then freeze.",
    release: "Hunters get out in",
  },
  hunter: {
    title: "You're a hunter",
    goal: "Find the fakes. Missing a shot costs you HP.",
    release: "You get out in",
  },
};

/**
 * The round's opening card: which side you are on and what that side is for. `inline`
 * places it in the flow of the hunter's blindout, where it stands in for the blindout's
 * own title and countdown instead of stacking over them.
 */
function RoleCard({
  role,
  endsAt,
  inline = false,
}: {
  role: Role;
  endsAt: number;
  inline?: boolean;
}) {
  const copy = ROLE_CARD_COPY[role];
  return (
    <div
      className={`role-card role-card-${role}${inline ? " role-card-inline" : ""}`}
      role="status"
    >
      <div className="role-card-band">
        <div className="role-card-title">{copy.title}</div>
        <div className="role-card-goal">{copy.goal}</div>
        <div className="role-card-release">
          {copy.release} <LiveClock endsAt={endsAt} />
        </div>
      </div>
    </div>
  );
}

interface BannerCopy {
  title: string;
  hint: string;
}

const RELEASE_COPY: Record<Role, BannerCopy> = {
  prop: { title: "Hunters released", hint: "Hold still. They can hear you move." },
  hunter: { title: "Go", hint: "Find the props." },
};

const HUNT_NOW_COPY: BannerCopy = { title: "You hunt now", hint: "Find the rest of the props." };

/** A big centre call for a turn in the round, tinted by the side it speaks to. */
function PhaseBanner({ side, copy }: { side: Role; copy: BannerCopy }) {
  return (
    <div className={`phase-banner phase-banner-${side}`} role="status">
      <div className="phase-banner-title">{copy.title}</div>
      <div className="phase-banner-hint">{copy.hint}</div>
    </div>
  );
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

export function Game({ connection, onBackToParty, onLeaveMatch, onRestartView }: GameProps) {
  const { room, sessionId } = connection;
  const playersRef = useRef<Map<string, RemotePlayerView>>(new Map());
  const teleportRef = useRef<{ x: number; z: number } | null>(null) as TeleportRef;
  const lookRef: LookRef = useRef({ yaw: 0, pitch: DEFAULT_PITCH });
  const tauntPulseRef = useRef<Map<string, number>>(new Map()) as TauntPulseRef;
  const shotsRef = useRef([]) as ShotsRef;
  const breaksRef = useRef([]) as BreaksRef;
  const msgSeq = useRef(0);
  const chatOpenRef = useRef(false);
  const fxSeq = useRef(0);
  const muzzleSeq = useRef(0);
  const killTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatUnlockRef = useRef(false);
  const listenerRef = useRef<ListenerPose>({ x: 0, z: 0, forwardX: 0, forwardZ: -1 });
  const prevScoreRef = useRef(0);

  const [map, setMap] = useState<MapDefinition | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [meta, setMeta] = useState<MetaMap>({});
  const [sceneMeta, setSceneMeta] = useState<SceneMetaMap>({});
  const [phase, setPhase] = useState<Phase>("lobby");
  const [phaseEndsAt, setPhaseEndsAt] = useState(0);
  const [fillAt, setFillAt] = useState(0);
  const [winner, setWinner] = useState<Winner>("");
  const [hostId, setHostId] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [killFeed, setKillFeed] = useState<KillLine[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [shotFx, setShotFx] = useState<{ kind: "hit" | "miss"; seq: number } | null>(null);
  const [muzzle, setMuzzle] = useState<number | null>(null);
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [decoys, setDecoys] = useState<DecoyView[]>([]);
  const [tauntReadyAt, setTauntReadyAt] = useState(0);
  const [sonarReadyAt, setSonarReadyAt] = useState(0);
  const [muted, setMuted] = useState(() => isMuted());
  const [perfHud] = useState(() => isPerfHudEnabled());
  const perfNodeRef = useRef<HTMLDivElement | null>(null);
  const [frameRing] = useState(() => createFrameRing());
  const [gfxPreference] = useState(() => graphicsPreference());
  const [tier, setTier] = useState<GraphicsTier>(() => resolveTier(gfxPreference, deviceHints()));
  const [roundFrames] = useState<RoundFrames>(() => ({ frames: 0, totalMs: 0 }));
  const tierSettings = TIER_SETTINGS[tier];
  const glConfig = useMemo(() => ({ antialias: tierSettings.antialias }), [tierSettings]);
  const mapId = map?.id ?? null;
  const post = useMemo(
    () => (mapId === null ? null : postSettings(tierSettings, themeLook(mapId))),
    [tierSettings, mapId],
  );
  const glRef = useRef<WebGLRenderer | null>(null);
  const longTasksRef = useRef<LongTaskTally>({ count: 0, longestMs: 0 });
  const contextLossesRef = useRef(0);
  const prevPhaseRef = useRef<Phase>("lobby");
  const [roleCard, showRoleCard] = useTransient<true>(ROLE_CARD_MS);
  const [releaseBanner, showReleaseBanner] = useTransient<true>(PHASE_BANNER_MS);
  const [huntNowBanner, showHuntNowBanner] = useTransient<true>(PHASE_BANNER_MS);
  const [catchBanner, showCatchBanner] = useTransient<string>(CATCH_BANNER_MS);
  const [hitMarker, showHitMarker] = useTransient<number>(HIT_MARKER_MS);
  const [caught, setCaught] = useState<(CaughtCam & { byName: string }) | null>(null);
  const catchRef: CatchMomentRef = useRef(null);
  const [startingRoles, setStartingRoles] = useState<StartingRoles>({});
  const [captures, setCaptures] = useState<Readonly<Record<string, CaptureRecord>>>({});
  const huntStartRef = useRef(0);

  chatOpenRef.current = chatOpen;

  const onShoot = useCallback(() => setMuzzle(muzzleSeq.current++), []);
  const resume = useCallback(() => {
    setPaused(false);
    lockPointer(canvasRef.current);
  }, []);
  const weapon = meta[sessionId]?.weapon ?? DEFAULT_WEAPON;

  const pushFeed = useCallback((text: string) => {
    const key = fxSeq.current++;
    setKillFeed((prev) => [...prev.slice(-(KILL_FEED_MAX - 1)), { key, text }]);
    const timer = setTimeout(() => {
      killTimersRef.current.delete(timer);
      setKillFeed((prev) => prev.filter((line) => line.key !== key));
    }, KILL_FEED_MS);
    killTimersRef.current.add(timer);
  }, []);

  const pickWeapon = useCallback(
    (id: WeaponId) => {
      room.send(MSG_SET_WEAPON, { weapon: id });
    },
    [room],
  );

  useEffect(() => {
    const callbacks = Callbacks.get(room);
    const unsubscribers: Array<() => void> = [];
    const playerMetaUnsubscribers = new Map<string, Array<() => void>>();

    const syncRoomMeta = () => {
      const view = room.state as unknown as RoomStateView;
      setPhase((prev) => (prev === view.phase ? prev : view.phase));
      setPhaseEndsAt((prev) => (prev === view.phaseEndsAt ? prev : view.phaseEndsAt));
      setWinner((prev) => (prev === view.winner ? prev : view.winner));
      setHostId((prev) => (prev === view.hostId ? prev : view.hostId));
      setIsPrivate((prev) => (prev === view.isPrivate ? prev : view.isPrivate));
      setFillAt((prev) => (prev === view.fillAt ? prev : view.fillAt));
    };

    const syncPlayerMeta = () => {
      const next: MetaMap = {};
      for (const [id, player] of playersRef.current) {
        next[id] = {
          name: player.name,
          role: player.role,
          alive: player.alive,
          hp: player.hp,
          kills: player.kills,
          score: player.score,
          propType: player.propType,
          rerollsLeft: player.rerollsLeft,
          decoysLeft: player.decoysLeft,
          ready: player.ready,
          avatar: player.avatar,
          weapon: player.weapon,
          ping: player.ping,
          connected: player.connected,
        };
      }
      setMeta((prev) => (metaEqual(prev, next) ? prev : next));
      setSceneMeta((prev) => sceneMetaOf(next, prev));
    };

    unsubscribers.push(
      callbacks.onAdd("players", (player: unknown, key: unknown) => {
        const id = String(key);
        const remote = player as RemotePlayerView;
        playersRef.current.set(id, remote);
        playerMetaUnsubscribers.set(
          id,
          PLAYER_META_FIELDS.map((field) => callbacks.listen(remote, field, syncPlayerMeta)),
        );
        setIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        syncPlayerMeta();
      }),
    );

    unsubscribers.push(
      callbacks.onRemove("players", (_player: unknown, key: unknown) => {
        const id = String(key);
        for (const unsubscribe of playerMetaUnsubscribers.get(id) ?? []) unsubscribe();
        playerMetaUnsubscribers.delete(id);
        playersRef.current.delete(id);
        tauntPulseRef.current.delete(id);
        setIds((prev) => prev.filter((existing) => existing !== id));
        syncPlayerMeta();
      }),
    );

    for (const field of [
      "phase",
      "phaseEndsAt",
      "winner",
      "hostId",
      "isPrivate",
      "fillAt",
    ] as const) {
      unsubscribers.push(callbacks.listen(field, syncRoomMeta));
    }
    syncRoomMeta();

    unsubscribers.push(
      callbacks.onAdd("decoys", (decoy: unknown, key: unknown) => {
        const d = decoy as Partial<DecoyView>;
        if (
          !isFiniteNumber(d.x) ||
          !isFiniteNumber(d.y) ||
          !isFiniteNumber(d.z) ||
          !isFiniteNumber(d.rot) ||
          typeof d.propType !== "string"
        ) {
          return;
        }
        const view: DecoyView = {
          id: String(key),
          x: d.x,
          y: d.y,
          z: d.z,
          rot: d.rot,
          propType: d.propType,
        };
        setDecoys((prev) => [...prev, view]);
      }),
    );

    unsubscribers.push(room.onMessage(MSG_DECOY_PLACED, () => playMorph(1)));

    unsubscribers.push(
      callbacks.onRemove("decoys", (_decoy: unknown, key: unknown) => {
        const id = String(key);
        setDecoys((prev) => prev.filter((existing) => existing.id !== id));
      }),
    );

    unsubscribers.push(
      room.onMessage(MSG_TELEPORT, (message: unknown) => {
        if (typeof message !== "object" || message === null) return;
        const m = message as Record<string, unknown>;
        if (isFiniteNumber(m.x) && isFiniteNumber(m.z)) {
          teleportRef.current = { x: m.x, z: m.z };
        }
      }),
    );

    unsubscribers.push(
      room.onMessage(MSG_TAUNT, (message: unknown) => {
        if (typeof message !== "object" || message === null) return;
        const m = message as Record<string, unknown>;
        if (typeof m.playerId !== "string" || !isFiniteNumber(m.x) || !isFiniteNumber(m.z)) return;
        tauntPulseRef.current.set(m.playerId, performance.now());
        if (m.playerId === sessionId && m.forced !== true) {
          setTauntReadyAt(Date.now() + TAUNT_COOLDOWN_MS);
        }
        const listener = listenerRef.current;
        playTaunt(falloff(listener, m.x, m.z, TAUNT_HEARING_RADIUS), stereoPan(listener, m.x, m.z));
      }),
    );

    unsubscribers.push(
      room.onMessage(MSG_SONAR_PING, (message: unknown) => {
        if (typeof message !== "object" || message === null) return;
        const m = message as Record<string, unknown>;
        if (typeof m.playerId !== "string" || !isFiniteNumber(m.x) || !isFiniteNumber(m.z)) return;
        if (m.playerId === sessionId) setSonarReadyAt(Date.now() + SONAR_COOLDOWN_MS);
        const listener = listenerRef.current;
        playSonar(falloff(listener, m.x, m.z, SONAR_HEARING_RADIUS), stereoPan(listener, m.x, m.z));
      }),
    );

    unsubscribers.push(
      room.onMessage(MSG_DECOY_BREAK, (message: unknown) => {
        if (typeof message !== "object" || message === null) return;
        const m = message as Record<string, unknown>;
        if (
          !isFiniteNumber(m.x) ||
          !isFiniteNumber(m.y) ||
          !isFiniteNumber(m.z) ||
          typeof m.propType !== "string"
        ) {
          return;
        }
        breaksRef.current.push({ x: m.x, y: m.y, z: m.z, propType: m.propType });
        const local = playersRef.current.get(sessionId);
        const volume = local
          ? Math.max(0, 1 - Math.hypot(local.x - m.x, local.z - m.z) / SHOT_SOUND_MAX_DISTANCE)
          : 0.7;
        playDecoyBreak(volume);
      }),
    );

    unsubscribers.push(
      room.onMessage(MSG_SHOT_FIRED, (message: unknown) => {
        if (typeof message !== "object" || message === null) return;
        const m = message as Record<string, unknown>;
        const origin = m.origin as Record<string, unknown> | undefined;
        if (
          !origin ||
          !isWeaponId(m.weapon) ||
          !isFiniteNumber(origin.x) ||
          !isFiniteNumber(origin.y) ||
          !isFiniteNumber(origin.z) ||
          !Array.isArray(m.ends)
        ) {
          return;
        }
        const ends: { x: number; y: number; z: number }[] = [];
        for (const raw of m.ends) {
          const end = raw as Record<string, unknown>;
          if (!isFiniteNumber(end.x) || !isFiniteNumber(end.y) || !isFiniteNumber(end.z)) return;
          ends.push({ x: end.x, y: end.y, z: end.z });
        }
        shotsRef.current.push({
          weapon: m.weapon,
          origin: { x: origin.x, y: origin.y, z: origin.z },
          ends,
        });
        if (m.shooterId === sessionId) return;
        const local = playersRef.current.get(sessionId);
        const volume = local
          ? Math.max(
              0,
              1 - Math.hypot(local.x - origin.x, local.z - origin.z) / SHOT_SOUND_MAX_DISTANCE,
            )
          : 1;
        playWeaponShot(m.weapon, volume * REMOTE_SHOT_VOLUME);
      }),
    );

    unsubscribers.push(
      room.onMessage(MSG_CHAT, (message: unknown) => {
        if (typeof message !== "object" || message === null) return;
        const m = message as Record<string, unknown>;
        if (typeof m.name !== "string" || typeof m.text !== "string") return;
        const line: ChatLine = { key: msgSeq.current++, name: m.name, text: m.text };
        setMessages((prev) => [...prev, line].slice(-CHAT_HISTORY));
      }),
    );

    unsubscribers.push(
      room.onMessage(MSG_SHOT_RESULT, (message: unknown) => {
        if (typeof message !== "object" || message === null) return;
        const hit = (message as Record<string, unknown>).hit === true;
        if (hit) {
          playHitConfirm();
        } else {
          playMiss();
        }
        setShotFx({ kind: hit ? "hit" : "miss", seq: fxSeq.current++ });
      }),
    );

    unsubscribers.push(
      room.onMessage(MSG_KILL, (message: unknown) => {
        if (typeof message !== "object" || message === null) return;
        const event = message as KillEvent;
        if (typeof event.victimName !== "string" || typeof event.reason !== "string") return;
        pushFeed(killText(event));
        if (event.reason === "converted") {
          const capture = { byName: event.byName, atMs: Date.now() - huntStartRef.current };
          setCaptures((prev) => ({ ...prev, [event.victimId]: capture }));
          const now = performance.now();
          if (event.victimId === sessionId) {
            setCaught({ byId: event.byId, byName: event.byName, at: now });
          } else if (event.byId === sessionId) {
            catchRef.current = { victimId: event.victimId, at: now };
            showCatchBanner(event.victimName);
            showHitMarker(fxSeq.current++);
          }
          const victim = playersRef.current.get(event.victimId);
          if (victim) {
            const listener = listenerRef.current;
            playCatch(
              falloff(listener, victim.x, victim.z, CATCH_SOUND_MAX_DISTANCE),
              stereoPan(listener, victim.x, victim.z),
            );
          }
        } else if (event.victimId === sessionId) {
          playDeath();
        } else if (event.byId !== sessionId) {
          playKill();
        }
      }),
    );

    unsubscribers.push(room.onMessage(MSG_MAP, (raw: unknown) => setMap(parseMapDefinition(raw))));
    room.send(MSG_MAP);

    return () => {
      for (const nested of playerMetaUnsubscribers.values()) {
        for (const unsubscribe of nested) unsubscribe();
      }
      for (const unsubscribe of unsubscribers) unsubscribe();
      for (const timer of killTimersRef.current) clearTimeout(timer);
      killTimersRef.current.clear();
      playerMetaUnsubscribers.clear();
      playersRef.current.clear();
    };
  }, [room, sessionId, pushFeed, showCatchBanner, showHitMarker]);

  const localScore = meta[sessionId]?.score ?? 0;
  useEffect(() => {
    const gained = localScore - prevScoreRef.current;
    prevScoreRef.current = localScore;
    if (gained <= 0) return;
    pushFeed(gained >= TAUNT_DARING_POINTS ? `Daring taunt +${gained}` : `Taunt +${gained}`);
  }, [localScore, pushFeed]);

  useEffect(() => {
    if (!caught) return;
    const timer = setTimeout(() => {
      setCaught(null);
      if (prevPhaseRef.current !== "hunting") return;
      showHuntNowBanner(true);
      playYouHuntNow();
    }, CAUGHT_CAM_MS);
    return () => clearTimeout(timer);
  }, [caught, showHuntNowBanner]);

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
      if (chatOpenRef.current || paused) return;
      if (e.code === "KeyT") {
        e.preventDefault();
        if (document.pointerLockElement) {
          chatUnlockRef.current = true;
          document.exitPointerLock();
        }
        setChatOpen(true);
      } else if (e.code === "KeyM") {
        setMuted(toggleMuted());
      } else {
        const slot = ["Digit1", "Digit2", "Digit3"].indexOf(e.code);
        const id = slot >= 0 ? WEAPON_IDS[slot] : undefined;
        if (id) pickWeapon(id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickWeapon, paused]);

  useEffect(() => {
    preloadSamples();
  }, []);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (phase === prev) return;
    if (phase === "hiding") {
      playRoundStart();
      setTauntReadyAt(0);
      setSonarReadyAt(0);
      setCaptures({});
      showRoleCard(true);
    } else if (phase === "hunting") {
      showReleaseBanner(true);
    } else if (phase === "round_end") {
      const role = startingRoles[sessionId] ?? meta[sessionId]?.role ?? "prop";
      playRoundEnd(wonRound(role, winner));
    }
  }, [phase, winner, meta, sessionId, startingRoles, showRoleCard, showReleaseBanner]);

  useEffect(() => {
    if (phase === "hunting") huntStartRef.current = phaseEndsAt - ROUND_DURATION_MS;
  }, [phase, phaseEndsAt]);

  useEffect(() => {
    const roles: Record<string, Role> = {};
    for (const [id, player] of Object.entries(meta)) roles[id] = player.role;
    setStartingRoles((prev) => nextStartingRoles(prev, phase, roles));
  }, [phase, meta]);

  const story = useMemo<RoundStory>(() => ({ startingRoles, captures }), [startingRoles, captures]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (chatOpenRef.current) return;
      if (e.key === "?") {
        e.preventDefault();
        setControlsOpen((open) => !open);
        return;
      }
      if (e.key === "Escape") {
        if (controlsOpen) {
          setControlsOpen(false);
        } else if (isRoundInPlay(phase)) {
          setPaused((open) => !open);
        }
        return;
      }
      if (e.code !== "Tab") return;
      e.preventDefault();
      setScoreboardOpen(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "Tab") setScoreboardOpen(false);
    };
    const onBlur = () => {
      setScoreboardOpen(false);
      setControlsOpen(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [controlsOpen, phase]);

  useEffect(() => {
    if (!isRoundInPlay(phase)) {
      setPaused(false);
      return;
    }
    const onLockChange = () => {
      if (document.pointerLockElement) {
        setPaused(false);
        return;
      }
      if (chatUnlockRef.current) {
        chatUnlockRef.current = false;
        return;
      }
      if (chatOpenRef.current || controlsOpen) return;
      setPaused(true);
    };
    document.addEventListener("pointerlockchange", onLockChange);
    return () => document.removeEventListener("pointerlockchange", onLockChange);
  }, [phase, controlsOpen]);

  const localMeta = meta[sessionId];
  const localRole: Role = localMeta?.role ?? "prop";
  const localAlive = localMeta?.alive ?? true;
  const localHp = localMeta?.hp ?? 0;
  const localReady = localMeta?.ready ?? false;

  const toggleReady = useCallback(
    () => room.send(MSG_READY, { ready: !localReady }),
    [room, localReady],
  );
  const startMatch = useCallback(() => room.send(MSG_START), [room]);
  const isHost = sessionId === hostId;

  const readyCount = ids.reduce((n, id) => (meta[id]?.ready ? n + 1 : n), 0);
  const presentCount = ids.reduce((n, id) => (meta[id]?.connected === false ? n : n + 1), 0);
  const lobbyStatus = publicLobbyStatus(presentCount, readyCount, ids.length, phaseEndsAt, fillAt);
  const aliveProps = ids.reduce((n, id) => {
    const player = meta[id];
    return player && player.role === "prop" && player.alive ? n + 1 : n;
  }, 0);

  const inputBlocked = chatOpen || paused;
  const callRole = localAlive && phase === "hunting" && !inputBlocked ? localRole : null;

  useEffect(() => {
    if (!callRole) return;
    const message = callRole === "prop" ? MSG_TAUNT_REQUEST : MSG_SONAR;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyF" || e.repeat) return;
      room.send(message);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [room, callRole]);
  const canTransform =
    localRole === "prop" && localAlive && (phase === "hiding" || phase === "hunting");
  const canShoot = localRole === "hunter" && localAlive && phase === "hunting";
  const showCrosshair = (canTransform || canShoot) && !inputBlocked && !caught;
  const blinded = localRole === "hunter" && phase === "hiding";

  const closeChat = () => {
    setChatOpen(false);
    setChatDraft("");
  };

  const onChatKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
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

  useEffect(() => {
    if (!PerformanceObserver.supportedEntryTypes?.includes("longtask")) return;
    const tally = longTasksRef.current;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        tally.count += 1;
        tally.longestMs = Math.max(tally.longestMs, entry.duration);
      }
    });
    observer.observe({ type: "longtask" });
    return () => observer.disconnect();
  }, []);

  const collectDiagnostics = useCallback((): string => {
    const gl = glRef.current;
    if (!gl) return "The 3D view has not started yet.";
    const mapName = MAP_CATALOG.find((m) => m.id === map?.id)?.name ?? map?.id ?? "?";
    return formatDiagnostics(
      readDiagnostics(
        gl,
        frameRing,
        longTasksRef.current,
        contextLossesRef.current,
        mapName,
        phase,
        ids.length,
        `${gfxPreference} (${tier})`,
      ),
    );
  }, [frameRing, map, phase, ids.length, gfxPreference, tier]);

  useEffect(() => {
    if (phase === "hunting") {
      roundFrames.frames = 0;
      roundFrames.totalMs = 0;
    } else if (phase === "round_end" && gfxPreference === "auto") {
      setTier((current) => nextRoundTier(current, roundFrames));
    }
  }, [phase, gfxPreference, roundFrames]);

  useEffect(() => {
    document.body.classList.toggle(GFX_LOW_CLASS, !tierSettings.glass);
    return () => document.body.classList.remove(GFX_LOW_CLASS);
  }, [tierSettings]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tier is a trigger, not read in the body; a tier change remounts the Canvas, so the listeners must move to the new element.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!map || !canvas) return;
    const onLost = () => {
      contextLossesRef.current += 1;
      setContextLost(true);
    };
    const onRestored = () => setContextLost(false);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [map, tier]);

  if (!map) {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <h1>Loading map…</h1>
        </div>
      </div>
    );
  }

  return (
    <>
      <Canvas
        key={tier}
        ref={canvasRef}
        dpr={tierSettings.dpr}
        gl={glConfig}
        shadows={tierSettings.shadows ? GAME_SHADOW_TYPE : false}
        camera={{ position: [0, 12, 18], fov: GAME_FOV }}
        onCreated={({ gl }) => {
          glRef.current = gl;
        }}
      >
        <Scene
          key={map.id}
          room={room}
          map={map}
          localId={sessionId}
          ids={ids}
          playersRef={playersRef}
          meta={sceneMeta}
          phase={phase}
          decoys={decoys}
          teleportRef={teleportRef}
          lookRef={lookRef}
          tauntPulseRef={tauntPulseRef}
          shotsRef={shotsRef}
          breaksRef={breaksRef}
          weapon={weapon}
          inputBlocked={inputBlocked}
          onShoot={onShoot}
          shadows={tierSettings.shadows}
          catchRef={catchRef}
          caughtCam={caught}
        />
        <RenderGate skip={blinded} post={post} antialias={tierSettings.antialias} />
        <ListenerProbe playersRef={playersRef} localId={sessionId} listenerRef={listenerRef} />
        <PropFootsteps playersRef={playersRef} localId={sessionId} listenerRef={listenerRef} />
        <PerfProbe
          playersRef={playersRef}
          localId={sessionId}
          nodeRef={perfNodeRef}
          ring={frameRing}
          round={roundFrames}
          inRound={phase === "hunting"}
        />
      </Canvas>

      {perfHud && <div className="perf" ref={perfNodeRef} />}

      {phase === "lobby" && (
        <div className="lobby-overlay">
          <div className="lobby-overlay-card panel">
            {isPrivate ? (
              <>
                <h2>Party lobby</h2>
                <ul className="ready-list">
                  {ids.map((id) => (
                    <li key={id} className={id === hostId ? "is-host" : ""}>
                      <span>
                        {meta[id]?.name ?? "?"}
                        {id === sessionId ? " (you)" : ""}
                      </span>
                      {id === hostId && <span className="party-host">★ Host</span>}
                    </li>
                  ))}
                </ul>
                {isHost ? (
                  <button
                    type="button"
                    onClick={startMatch}
                    disabled={ids.length < MIN_PLAYERS_TO_START}
                  >
                    Start match
                  </button>
                ) : (
                  <span className="lobby-overlay-meta">Waiting for the host to start</span>
                )}
                <button type="button" className="btn-ghost" onClick={onBackToParty}>
                  Back to party
                </button>
                {isHost && ids.length < MIN_PLAYERS_TO_START && (
                  <span className="lobby-overlay-meta">
                    Need at least {MIN_PLAYERS_TO_START} players
                  </span>
                )}
              </>
            ) : (
              <>
                <h2>Waiting for players</h2>
                <ul className="ready-list">
                  {ids.map((id) => (
                    <li key={id} className={meta[id]?.ready ? "is-ready" : ""}>
                      <span>
                        {meta[id]?.name ?? "?"}
                        {id === sessionId ? " (you)" : ""}
                      </span>
                      <span>{meta[id]?.ready ? "✔ Ready" : "… waiting"}</span>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={toggleReady}>
                  {localReady ? "Cancel" : "Ready"}
                </button>
                <button type="button" className="btn-ghost" onClick={onLeaveMatch}>
                  Leave
                </button>
                <span className="lobby-overlay-meta">
                  {lobbyStatus.label}
                  <Countdown endsAt={lobbyStatus.endsAt} />
                </span>
              </>
            )}
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

      {hitMarker !== null && (
        <div key={hitMarker} className="hitmarker">
          <i />
          <i />
          <i />
          <i />
        </div>
      )}

      {catchBanner !== null && (
        <div className="catch-banner" role="status">
          <span className="catch-banner-label">Caught</span>
          <span className="catch-banner-name">{catchBanner}</span>
        </div>
      )}

      {caught && phase === "hunting" && (
        <div className="caught-card" role="status">
          <div className="caught-title">Caught</div>
          <div className="caught-by">by {caught.byName}</div>
        </div>
      )}

      {shotFx?.kind === "miss" && <div className="vignette" />}

      {blinded && (
        <div className="blindout">
          {roleCard ? (
            <RoleCard role={localRole} endsAt={phaseEndsAt} inline />
          ) : (
            <>
              <div className="blindout-title">The props are hiding</div>
              <div className="blindout-timer">
                The hunt begins
                <Countdown endsAt={phaseEndsAt} />
              </div>
            </>
          )}
          <div className="weapon-picker">
            {WEAPON_IDS.map((id, index) => {
              const spec = WEAPONS[id];
              return (
                <button
                  key={id}
                  type="button"
                  className={`weapon-card${id === weapon ? " is-active" : ""}`}
                  onClick={() => pickWeapon(id)}
                >
                  <span className="weapon-slot">{index + 1}</span>
                  <span className="weapon-name">{spec.label}</span>
                  <span className="weapon-blurb">{spec.blurb}</span>
                </button>
              );
            })}
          </div>
          <div className="weapon-picker-hint">Press 1 / 2 / 3 to pick your weapon</div>
        </div>
      )}

      {roleCard && phase === "hiding" && !blinded && (
        <RoleCard role={localRole} endsAt={phaseEndsAt} />
      )}
      {releaseBanner && phase === "hunting" && (
        <PhaseBanner side={localRole} copy={RELEASE_COPY[localRole]} />
      )}
      {huntNowBanner && phase === "hunting" && <PhaseBanner side="hunter" copy={HUNT_NOW_COPY} />}

      {phase === "round_end" && winner !== "" && (
        <ResultScreen
          winner={winner}
          endsAt={phaseEndsAt}
          ids={ids}
          meta={meta}
          localId={sessionId}
          story={story}
          onLeave={onLeaveMatch}
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
            placeholder="Message… (Enter to send, Esc to close)"
          />
        )}
      </div>

      {phase !== "lobby" && (
        <div className="topbar hud-surface">
          <div className="topbar-phase">
            <span className="eyebrow">Round</span>
            <span className="topbar-phase-name">{phaseLabel(phase, localRole)}</span>
          </div>
          {phaseEndsAt > 0 && <RingTimer endsAt={phaseEndsAt} total={PHASE_DURATION_MS[phase]} />}
          <div className="topbar-meta">
            <span className={`badge badge-${localRole}`}>{ROLE_LABEL[localRole]}</span>
            {(phase === "hiding" || phase === "hunting") && (
              <span className="targets">
                <span className="targets-dot" />
                {propsLeftLabel(aliveProps)}
              </span>
            )}
          </div>
          <button
            type="button"
            className={`topbar-mute${muted ? " is-muted" : ""}`}
            onClick={() => setMuted(toggleMuted())}
            title={muted ? "Unmute audio (M)" : "Mute audio (M)"}
            aria-label={muted ? "Unmute audio" : "Mute audio"}
          >
            <SpeakerIcon muted={muted} />
          </button>
        </div>
      )}

      {phase !== "lobby" && !caught && (
        <div className="hud-bottom">
          {localRole === "hunter" && localAlive && (
            <div className={`vitals hud-surface${localHp <= HP_LOW_THRESHOLD ? " hp-low" : ""}`}>
              <span className="eyebrow">Integrity</span>
              <div className="vitals-row">
                <div className="hp">
                  <div
                    className="hp-fill"
                    style={{ width: `${(localHp / HUNTER_MAX_HP) * 100}%` }}
                  />
                </div>
                <span className="hp-val">{localHp}</span>
              </div>
            </div>
          )}
          <ControlsBar
            role={localRole}
            alive={localAlive}
            canShoot={canShoot}
            canTransform={canTransform}
            phase={phase}
            rerollsLeft={localMeta?.rerollsLeft ?? 0}
            decoysLeft={localMeta?.decoysLeft ?? 0}
            tauntReadyAt={tauntReadyAt}
            sonarReadyAt={sonarReadyAt}
            onOpen={() => setControlsOpen(true)}
          />
        </div>
      )}
      {controlsOpen && <ControlsDialog onClose={() => setControlsOpen(false)} />}

      {contextLost && (
        <div className="pause">
          <div className="pause-card panel">
            <span className="eyebrow">Graphics reset</span>
            <h2>Restoring the view…</h2>
            <span className="pause-hint">
              The browser reset the graphics driver. The match keeps running.
            </span>
            <button type="button" onClick={onRestartView}>
              Restart the view
            </button>
            <button type="button" className="btn-ghost" onClick={onLeaveMatch}>
              Leave match
            </button>
          </div>
        </div>
      )}

      {paused && isRoundInPlay(phase) && (
        <div className="pause">
          <div className="pause-card panel">
            <span className="eyebrow">Round in progress</span>
            <h2>Match menu</h2>
            <button type="button" onClick={resume}>
              Resume
            </button>
            <div className="pause-setting">
              <span>Look sensitivity</span>
              <LookSensitivitySlider />
            </div>
            <button type="button" className="btn-ghost" onClick={onLeaveMatch}>
              Leave match
            </button>
            <CopyDiagnostics collect={collectDiagnostics} />
            <span className="pause-hint">The round keeps running. Click the game to resume</span>
          </div>
        </div>
      )}
    </>
  );
}
