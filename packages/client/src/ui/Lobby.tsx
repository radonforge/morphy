import {
  AVATAR_CATALOG,
  type AvatarId,
  DEFAULT_AVATAR_ID,
  isAvatarId,
  isPartyCode,
  MAP_CATALOG,
  MAX_NAME_LENGTH,
  type MapId,
  MIN_PLAYERS_TO_START,
  normalizePartyCode,
  PARTY_CODE_LENGTH,
} from "@morphy/shared";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  areUiSoundsEnabled,
  getMusicVolume,
  getVolume,
  isMusicEnabled,
  isMuted,
  playMorph,
  playUiClick,
  playUiClose,
  playUiDeploy,
  playUiHover,
  playUiOpen,
  setMusicEnabled,
  setMusicVolume,
  setMuted,
  setUiSoundsEnabled,
  setVolume,
  startLobbyMusic,
  stopLobbyMusic,
  unlockAudio,
} from "../game/audio";
import { isPerfHudEnabled, setPerfHudEnabled } from "../game/prefs";
import { MAP_CHROME, MAP_GLASS } from "../theme";
import { stepAvatar } from "./avatarCarousel";
import { MorphRail } from "./MorphRail";
import { loadPrefs, savePrefs } from "./prefs";
import { StatsPane } from "./StatsPane";
import { STAGE_MAX_ACTORS, type StageActor } from "./stageActors";

const LobbyStage = lazy(() =>
  import("./LobbyStage").then((module) => ({ default: module.LobbyStage })),
);

export type ConnectStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "error"; message: string };

export interface PartyMemberView {
  id: string;
  name: string;
  avatar: string;
}

export interface PartyViewProps {
  code: string;
  selfId: string;
  hostId: string;
  mapId: MapId;
  members: PartyMemberView[];
  onStart: () => void;
  onSetMap: (map: MapId) => void;
  onSetProfile: (name: string, avatar: AvatarId) => void;
  onLeaveParty: () => void;
}

interface LobbyProps {
  status: ConnectStatus;
  party: PartyViewProps | null;
  onConnect: (name: string, map: MapId, avatar: AvatarId) => void;
  onCreateParty: (name: string, map: MapId, avatar: AvatarId) => void;
  onJoinParty: (code: string, name: string, avatar: AvatarId) => void;
}

type PaneId = "identity" | "private" | "stats" | "options";

interface NavItem {
  id: PaneId;
  label: string;
}

const COPY_FLASH_MS = 1600;

const AVATAR_EMOJI: Record<AvatarId, string> = {
  fox: "🦊",
  cat: "🐱",
  dog: "🐶",
  panda: "🐼",
  tiger: "🐯",
  lion: "🦁",
  bunny: "🐰",
  deer: "🦌",
  koala: "🐨",
  penguin: "🐧",
  parrot: "🦜",
  monkey: "🐵",
  elephant: "🐘",
  giraffe: "🦒",
  cow: "🐮",
  pig: "🐷",
  hog: "🐗",
  polar: "🐻‍❄️",
  beaver: "🦫",
  chick: "🐤",
  crab: "🦀",
};

function avatarEmoji(avatar: string): string {
  return isAvatarId(avatar) ? AVATAR_EMOJI[avatar] : "❔";
}

function resolveAvatar(avatar: string): AvatarId {
  return isAvatarId(avatar) ? avatar : DEFAULT_AVATAR_ID;
}

const NAV_ITEMS: NavItem[] = [
  { id: "identity", label: "Identity" },
  { id: "private", label: "Private" },
  { id: "stats", label: "Stats" },
  { id: "options", label: "Options" },
];

const PANE_TITLES: Record<PaneId, string> = {
  identity: "Identity",
  private: "Private room",
  stats: "Your stats",
  options: "Options",
};

const VOLUME_SLIDER_MAX = 100;
const SHEEN_PERCENT = 100;
const STEP_BACK = -1;
const STEP_FORWARD = 1;
const MORPH_STEP_COOLDOWN_MS = 180;
const WHEEL_STEP_DELTA = 90;
const WHEEL_GESTURE_GAP_MS = 40;
const WHEEL_RISE_FACTOR = 3;
const WHEEL_LINE_PX = 40;
const WHEEL_PAGE_PX = 400;

type WheelAxis = "x" | "y";

interface WheelDelta {
  x: number;
  y: number;
}

/**
 * Wheel travel in pixels on both axes, whatever unit the device reports it in. A mouse notch
 * lands around 100 px while a trackpad reports single digits per event, so reading the sign of
 * one event alone makes a notch and a twitch of a finger mean the same thing.
 */
function wheelDeltaPx(e: React.WheelEvent<HTMLElement>): WheelDelta {
  const scale =
    e.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? WHEEL_LINE_PX
      : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? WHEEL_PAGE_PX
        : 1;
  return { x: e.deltaX * scale, y: e.deltaY * scale };
}

export function Lobby({ status, party, onConnect, onCreateParty, onJoinParty }: LobbyProps) {
  const [name, setName] = useState(() => loadPrefs().name);
  const [selectedMap, setSelectedMap] = useState<MapId>(() => loadPrefs().map);
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarId>(() => loadPrefs().avatar);
  const [pane, setPane] = useState<PaneId | null>(null);
  const [muted, setMutedState] = useState(() => isMuted());
  const [volume, setVolumeState] = useState(() => getVolume());
  const [uiSounds, setUiSoundsState] = useState(() => areUiSoundsEnabled());
  const [musicOn, setMusicOnState] = useState(() => isMusicEnabled());
  const [musicVol, setMusicVolState] = useState(() => getMusicVolume());
  const [perfHud, setPerfHudState] = useState(() => isPerfHudEnabled());
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [morphMode, setMorphMode] = useState(false);

  const inParty = party !== null;
  const isHost = party !== null && party.selfId === party.hostId;
  const activeMap = party ? party.mapId : selectedMap;

  useEffect(() => {
    savePrefs({ name, map: selectedMap, avatar: selectedAvatar });
  }, [name, selectedMap, selectedAvatar]);

  useEffect(() => {
    if (inParty) setPane(null);
  }, [inParty]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPY_FLASH_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    startLobbyMusic();
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      stopLobbyMusic();
    };
  }, []);

  const menuRef = useRef<HTMLDivElement>(null);
  const sheenFrame = useRef(0);
  const sheenPoint = useRef({ x: 0, y: 0 });

  const handleSheenMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    sheenPoint.current.x = (e.clientX / window.innerWidth) * SHEEN_PERCENT;
    sheenPoint.current.y = (e.clientY / window.innerHeight) * SHEEN_PERCENT;
    if (sheenFrame.current !== 0) return;
    sheenFrame.current = requestAnimationFrame(() => {
      sheenFrame.current = 0;
      const node = menuRef.current;
      if (node === null) return;
      node.style.setProperty("--mx", `${sheenPoint.current.x}%`);
      node.style.setProperty("--my", `${sheenPoint.current.y}%`);
    });
  }, []);

  useEffect(
    () => () => {
      if (sheenFrame.current !== 0) cancelAnimationFrame(sheenFrame.current);
    },
    [],
  );

  const profileRef = useRef({ party, name, avatar: selectedAvatar, pane });
  profileRef.current = { party, name, avatar: selectedAvatar, pane };

  const commitProfile = useCallback(() => {
    const { party: p, name: n, avatar } = profileRef.current;
    p?.onSetProfile(n, avatar);
  }, []);

  const closePane = useCallback(() => {
    const current = profileRef.current.pane;
    if (current === null) return;
    if (current === "identity") commitProfile();
    playUiClose();
    setPane(null);
  }, [commitProfile]);

  useEffect(() => {
    if (pane === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePane();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pane, closePane]);

  const handleTabClick = useCallback(
    (id: PaneId) => {
      if (pane === id) {
        closePane();
        return;
      }
      if (pane === "identity") commitProfile();
      playUiOpen();
      setPane(id);
    },
    [pane, closePane, commitProfile],
  );

  const wheelTravel = useRef(0);
  const wheelArmed = useRef(true);
  const wheelAxis = useRef<WheelAxis | null>(null);
  const wheelFloor = useRef(Number.POSITIVE_INFINITY);
  const lastWheelAt = useRef(0);

  const enterMorph = useCallback(() => {
    if (profileRef.current.pane === "identity") commitProfile();
    playUiOpen();
    wheelTravel.current = 0;
    wheelArmed.current = true;
    wheelAxis.current = null;
    wheelFloor.current = Number.POSITIVE_INFINITY;
    setPane(null);
    setMorphMode(true);
  }, [commitProfile]);

  const exitMorph = useCallback(() => {
    playUiClose();
    setMorphMode(false);
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (party) return;
      playUiDeploy();
      onConnect(name, selectedMap, selectedAvatar);
    },
    [party, name, selectedMap, selectedAvatar, onConnect],
  );

  const handleStart = useCallback(() => {
    playUiDeploy();
    party?.onStart();
  }, [party]);

  const handleMapPick = useCallback(
    (map: MapId) => {
      if (party) {
        if (party.selfId !== party.hostId) return;
        party.onSetMap(map);
      }
      if (map !== activeMap) playUiClick();
      setSelectedMap(map);
    },
    [party, activeMap],
  );

  const handleMorphStep = useCallback(
    (delta: number) => {
      const next = stepAvatar(selectedAvatar, delta);
      playMorph();
      setSelectedAvatar(next);
      party?.onSetProfile(name, next);
    },
    [party, name, selectedAvatar],
  );

  const stepLock = useRef(0);
  const takeStepSlot = useCallback(() => {
    const now = performance.now();
    if (now - stepLock.current < MORPH_STEP_COOLDOWN_MS) return false;
    stepLock.current = now;
    return true;
  }, []);

  /**
   * At most one step per gesture. A step disarms the wheel and only a fresh push re-arms it, off
   * the one thing inertia cannot fake: it decays. macOS keeps emitting wheel events for about a
   * second after the fingers leave the trackpad, each smaller than the last, so a magnitude that
   * climbs back above the running floor is the user pressing again. The floor is tracked only
   * while disarmed — letting the gesture's own ramp-up set it is what made an earlier attempt
   * fire several times per swipe and need a cooldown to hide it.
   *
   * The axis is whichever one each gesture opens on, and is held for the rest of it — re-picked
   * whenever a gesture opens, not only after a step, or a swipe too small to move the carousel
   * would leave the axis pinned and swallow everything arriving on the other one. The rail's
   * arrows, the ghosts flanking the stage and the arrow keys all read left-to-right, so a
   * sideways swipe is the gesture that matches what is on screen; a plain mouse wheel has no
   * horizontal axis at all, so both are taken. Choosing per event instead would let a crooked
   * swipe flip axis halfway and cancel itself out.
   *
   * Silence re-arms too, at a threshold that separates the devices rather than guessing at one:
   * inertia arrives every frame, while wheel notches are tens of milliseconds apart even when
   * rolled hard. Waiting for silence *alone* was the first mistake — browsing quickly lays the
   * next swipe over the previous one's inertia, the gap never comes and the picker goes dead.
   *
   * Travel below `WHEEL_STEP_DELTA` survives a pause on the same axis, so nudges too small to
   * move the carousel add up across gestures instead of being thrown away. Clearing it on every
   * pause reads as the tidier rule but measures far worse: a run of gentle swipes then never
   * reaches the threshold at all and the picker answers none of them.
   */
  const handleMorphWheel = useCallback(
    (e: React.WheelEvent<HTMLElement>) => {
      const { x, y } = wheelDeltaPx(e);
      if (x === 0 && y === 0) return;

      const dominant: WheelAxis = Math.abs(x) > Math.abs(y) ? "x" : "y";
      const sample = Math.abs(dominant === "x" ? x : y);

      const now = performance.now();
      const quiet = now - lastWheelAt.current >= WHEEL_GESTURE_GAP_MS;
      lastWheelAt.current = now;

      const opens =
        quiet || (!wheelArmed.current && sample > wheelFloor.current * WHEEL_RISE_FACTOR);
      if (opens) {
        wheelArmed.current = true;
        if (wheelAxis.current !== dominant) {
          wheelAxis.current = dominant;
          wheelTravel.current = 0;
        }
      }
      if (!wheelArmed.current) {
        wheelFloor.current = Math.min(wheelFloor.current, sample);
        return;
      }

      const axis = wheelAxis.current ?? dominant;
      wheelAxis.current = axis;

      const delta = axis === "x" ? x : y;
      if (delta === 0) return;

      if (delta > 0 !== wheelTravel.current > 0) wheelTravel.current = 0;
      wheelTravel.current += delta;
      if (Math.abs(wheelTravel.current) < WHEEL_STEP_DELTA) return;

      const direction = wheelTravel.current > 0 ? STEP_FORWARD : STEP_BACK;
      wheelTravel.current = 0;
      wheelArmed.current = false;
      wheelAxis.current = null;
      wheelFloor.current = Math.abs(delta);
      handleMorphStep(direction);
    },
    [handleMorphStep],
  );

  useEffect(() => {
    if (!morphMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        exitMorph();
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      if (e.repeat && !takeStepSlot()) return;
      handleMorphStep(e.key === "ArrowLeft" ? STEP_BACK : STEP_FORWARD);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [morphMode, exitMorph, handleMorphStep, takeStepSlot]);

  const canCopy = typeof navigator !== "undefined" && navigator.clipboard !== undefined;
  const copyCode = useCallback(() => {
    if (!party || !navigator.clipboard) return;
    playUiClick();
    navigator.clipboard.writeText(party.code).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }, [party]);

  const handleJoinSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!isPartyCode(joinCode)) return;
      playUiClick();
      onJoinParty(joinCode, name, selectedAvatar);
    },
    [joinCode, name, selectedAvatar, onJoinParty],
  );

  const toggleAudio = useCallback(() => {
    playUiClick();
    setMutedState((prev) => {
      const next = !prev;
      setMuted(next);
      return next;
    });
  }, []);

  const toggleUiSounds = useCallback(() => {
    const next = !areUiSoundsEnabled();
    setUiSoundsEnabled(next);
    setUiSoundsState(next);
    if (next) playUiClick();
  }, []);

  const togglePerfHud = useCallback(() => {
    const next = !isPerfHudEnabled();
    setPerfHudEnabled(next);
    setPerfHudState(next);
    playUiClick();
  }, []);

  const toggleMusic = useCallback(() => {
    const next = !isMusicEnabled();
    setMusicEnabled(next);
    setMusicOnState(next);
    if (next) {
      startLobbyMusic();
    } else {
      stopLobbyMusic();
    }
    playUiClick();
  }, []);

  const handleVolumeChange = useCallback((value: number) => {
    const next = value / VOLUME_SLIDER_MAX;
    setVolume(next);
    setVolumeState(next);
  }, []);

  const handleMusicVolumeChange = useCallback((value: number) => {
    const next = value / VOLUME_SLIDER_MAX;
    setMusicVolume(next);
    setMusicVolState(next);
  }, []);

  const connecting = status.kind === "connecting";
  const trimmedName = name.trim();
  const mapInfo = MAP_CATALOG.find((info) => info.id === activeMap) ?? MAP_CATALOG[0];

  const stageActors: StageActor[] =
    party && party.members.length > 0
      ? [
          ...party.members.filter((member) => member.id === party.selfId),
          ...party.members.filter((member) => member.id !== party.selfId),
        ]
          .slice(0, STAGE_MAX_ACTORS)
          .map((member) => ({
            id: member.id,
            name: member.name,
            avatar: member.id === party.selfId ? selectedAvatar : resolveAvatar(member.avatar),
            isHost: member.id === party.hostId,
          }))
      : [{ id: "local", name: trimmedName || "Guest", avatar: selectedAvatar, isHost: false }];

  const chromeClass = `menu-chrome${morphMode ? " menu-chrome-out" : ""}`;

  return (
    <div
      className="menu"
      ref={menuRef}
      onPointerMove={handleSheenMove}
      style={{ "--glass-tint": MAP_GLASS[activeMap] } as React.CSSProperties}
    >
      <Suspense fallback={null}>
        <LobbyStage
          map={activeMap}
          actors={stageActors}
          inParty={inParty}
          morphMode={morphMode}
          onCustomize={enterMorph}
        />
      </Suspense>
      <div className="menu-vignette" />

      <header className={`menu-top ${chromeClass}`} inert={morphMode}>
        <div className="menu-brand">
          <div className="menu-wordmark">
            <img className="tri" src="/icon-192.png" alt="" aria-hidden="true" />
            <span>MORPHY</span>
          </div>
          <span
            className="menu-build"
            title="Version and build of this client. A trailing + means the build is past that release."
          >
            {__MORPHY_VERSION__} · {__MORPHY_BUILD__}
          </span>
        </div>
        <nav className="menu-tabs" aria-label="Menu">
          {NAV_ITEMS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`menu-tab${pane === item.id ? " sel" : ""}`}
              onClick={() => handleTabClick(item.id)}
              onPointerEnter={playUiHover}
              aria-pressed={pane === item.id}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {party && (
        <aside className={`menu-party panel ${chromeClass}`} inert={morphMode}>
          <span className="eyebrow">Party code</span>
          <div className="menu-party-code">
            <b>{party.code}</b>
            {canCopy && (
              <button type="button" onClick={copyCode} onPointerEnter={playUiHover}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
            )}
          </div>
          <ul className="menu-party-members">
            {party.members.map((member) => (
              <li key={member.id}>
                <span className="menu-party-emoji" aria-hidden="true">
                  {avatarEmoji(member.avatar)}
                </span>
                <span className="menu-party-name">
                  {member.id === party.hostId && <span className="menu-party-star">★ </span>}
                  {member.name}
                  {member.id === party.selfId ? " (you)" : ""}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="menu-party-leave"
            onClick={() => {
              playUiClick();
              party.onLeaveParty();
            }}
            onPointerEnter={playUiHover}
          >
            Leave party
          </button>
        </aside>
      )}

      {stageActors.length === 1 && pane === null && (
        <aside className={`menu-maptitle ${chromeClass}`} key={activeMap} inert={morphMode}>
          <span className="menu-maptitle-tag" style={{ color: MAP_CHROME[activeMap].accent }}>
            {mapInfo.tag} sector
          </span>
          <h2>{mapInfo.name}</h2>
          <p>{mapInfo.blurb}</p>
        </aside>
      )}

      {morphMode && (
        <>
          <button
            type="button"
            className="morph-backdrop"
            aria-label="Close the avatar picker"
            onClick={exitMorph}
            onWheel={handleMorphWheel}
          />
          <MorphRail avatar={selectedAvatar} onStep={handleMorphStep} />
        </>
      )}

      <form className={`menu-bottom ${chromeClass}`} onSubmit={handleSubmit} inert={morphMode}>
        <div className="menu-strip">
          <span className="menu-strip-label">Map</span>
          <div className="menu-mapstrip" role="radiogroup" aria-label="Map">
            {MAP_CATALOG.map((info) => (
              <button
                type="button"
                key={info.id}
                className={`menu-mapcard panel${activeMap === info.id ? " sel" : ""}`}
                style={{ "--accent": MAP_CHROME[info.id].accent } as React.CSSProperties}
                onClick={() => handleMapPick(info.id)}
                onPointerEnter={playUiHover}
                disabled={inParty && !isHost}
                aria-pressed={activeMap === info.id}
              >
                <span className="menu-mapcard-glyph" aria-hidden="true">
                  {MAP_CHROME[info.id].glyph}
                </span>
                <span className="menu-mapcard-text">
                  <span className="menu-mapcard-tag">{info.tag}</span>
                  <span className="menu-mapcard-name">{info.name}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="menu-dock">
          {party ? (
            isHost ? (
              <button
                type="button"
                className="menu-deploy"
                onClick={handleStart}
                onPointerEnter={playUiHover}
                disabled={party.members.length < MIN_PLAYERS_TO_START}
              >
                <span className="big">Start match</span>
                <span className="small">
                  {party.members.length < MIN_PLAYERS_TO_START
                    ? `Need at least ${MIN_PLAYERS_TO_START} players`
                    : `Party of ${party.members.length}`}
                </span>
              </button>
            ) : (
              <div className="menu-deploy menu-waiting">
                <span className="big">Waiting for host…</span>
                <span className="small">Only the host can start the match</span>
              </div>
            )
          ) : (
            <button
              type="submit"
              className="menu-deploy"
              onPointerEnter={playUiHover}
              disabled={connecting}
            >
              <span className="big">{connecting ? "Connecting…" : "Play"}</span>
              <span className="small">Public match</span>
            </button>
          )}
        </div>
        {status.kind === "error" && <span className="menu-error">{status.message}</span>}
      </form>

      {pane !== null && (
        <section className="menu-panel panel">
          <header className="menu-sheet-head">
            <h2>{PANE_TITLES[pane]}</h2>
            <button
              type="button"
              className="menu-sheet-close"
              onClick={closePane}
              onPointerEnter={playUiHover}
              aria-label="Close"
            >
              ✕
            </button>
          </header>

          {pane === "identity" && (
            <>
              <div className="menu-card menu-callsign">
                <label htmlFor="player-name" className="eyebrow">
                  Callsign
                </label>
                <input
                  id="player-name"
                  value={name}
                  maxLength={MAX_NAME_LENGTH}
                  placeholder="Your name"
                  onChange={(e) => setName(e.target.value)}
                  onBlur={commitProfile}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  autoFocus
                />
              </div>
              <div className="menu-card menu-avatar-entry">
                <span className="eyebrow">Avatar</span>
                <b className="menu-avatar-entry-name">
                  {AVATAR_CATALOG.find((info) => info.id === selectedAvatar)?.name}
                </b>
                <p>Step through every shape on the stage and morph into the one you want.</p>
                <button
                  type="button"
                  className="menu-party-btn"
                  onClick={enterMorph}
                  onPointerEnter={playUiHover}
                >
                  Change avatar
                </button>
              </div>
            </>
          )}

          {pane === "private" && party && (
            <div className="menu-card menu-party-sheet">
              <span className="eyebrow">Party code</span>
              <b className="menu-party-bigcode">{party.code}</b>
              <p>Share this code with your friends so they can join you.</p>
              {canCopy && (
                <button
                  type="button"
                  className="menu-party-btn"
                  onClick={copyCode}
                  onPointerEnter={playUiHover}
                >
                  {copied ? "Copied ✓" : "Copy code"}
                </button>
              )}
              <button
                type="button"
                className="menu-party-leave"
                onClick={() => {
                  playUiClick();
                  party.onLeaveParty();
                }}
                onPointerEnter={playUiHover}
              >
                Leave party
              </button>
            </div>
          )}

          {pane === "private" && !party && (
            <div className="menu-party-setup">
              <div className="menu-card">
                <b>Create a room</b>
                <p>Get a code to share with your friends. You pick the map and start the match.</p>
                <button
                  type="button"
                  className="menu-party-btn"
                  onClick={() => {
                    playUiClick();
                    onCreateParty(name, selectedMap, selectedAvatar);
                  }}
                  onPointerEnter={playUiHover}
                  disabled={connecting}
                >
                  {connecting ? "Connecting…" : "Create room"}
                </button>
              </div>
              <div className="menu-card">
                <b>Join with a code</b>
                <p>Enter the code you received to join your friends' room.</p>
                <form className="menu-party-joinrow" onSubmit={handleJoinSubmit}>
                  <input
                    value={joinCode}
                    maxLength={PARTY_CODE_LENGTH}
                    placeholder="CODE"
                    aria-label="Room code"
                    onChange={(e) => setJoinCode(normalizePartyCode(e.target.value))}
                  />
                  <button
                    type="submit"
                    className="menu-party-btn"
                    onPointerEnter={playUiHover}
                    disabled={!isPartyCode(joinCode) || connecting}
                  >
                    {connecting ? "…" : "Join"}
                  </button>
                </form>
                {status.kind === "error" && <span className="menu-error">{status.message}</span>}
              </div>
            </div>
          )}

          {pane === "options" && (
            <div className="menu-card">
              <div className="menu-opt-row">
                <span className="l">
                  <b>Audio</b>
                  <span>Master switch for every sound</span>
                </span>
                <button
                  type="button"
                  className={`menu-toggle${muted ? "" : " on"}`}
                  onClick={toggleAudio}
                  onPointerEnter={playUiHover}
                  aria-pressed={!muted}
                  aria-label={muted ? "Unmute audio" : "Mute audio"}
                />
              </div>
              <div className="menu-opt-row">
                <span className="l">
                  <b>Volume</b>
                  <span>Master level for effects and interface</span>
                </span>
                <input
                  type="range"
                  className="menu-slider"
                  min={0}
                  max={VOLUME_SLIDER_MAX}
                  value={Math.round(volume * VOLUME_SLIDER_MAX)}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  onPointerUp={playUiClick}
                  aria-label="Master volume"
                />
              </div>
              <div className="menu-opt-row">
                <span className="l">
                  <b>Music</b>
                  <span>Lobby theme by alkakrab</span>
                </span>
                <button
                  type="button"
                  className={`menu-toggle${musicOn ? " on" : ""}`}
                  onClick={toggleMusic}
                  onPointerEnter={playUiHover}
                  aria-pressed={musicOn}
                  aria-label={musicOn ? "Disable music" : "Enable music"}
                />
              </div>
              <div className="menu-opt-row">
                <span className="l">
                  <b>Music volume</b>
                  <span>Level of the lobby theme</span>
                </span>
                <input
                  type="range"
                  className="menu-slider"
                  min={0}
                  max={VOLUME_SLIDER_MAX}
                  value={Math.round(musicVol * VOLUME_SLIDER_MAX)}
                  onChange={(e) => handleMusicVolumeChange(Number(e.target.value))}
                  aria-label="Music volume"
                />
              </div>
              <div className="menu-opt-row">
                <span className="l">
                  <b>Interface sounds</b>
                  <span>Menu ticks and clicks</span>
                </span>
                <button
                  type="button"
                  className={`menu-toggle${uiSounds ? " on" : ""}`}
                  onClick={toggleUiSounds}
                  onPointerEnter={playUiHover}
                  aria-pressed={uiSounds}
                  aria-label={uiSounds ? "Disable interface sounds" : "Enable interface sounds"}
                />
              </div>
              <div className="menu-opt-row">
                <span className="l">
                  <b>Performance readout</b>
                  <span>FPS and ping in the corner of the match HUD</span>
                </span>
                <button
                  type="button"
                  className={`menu-toggle${perfHud ? " on" : ""}`}
                  onClick={togglePerfHud}
                  onPointerEnter={playUiHover}
                  aria-pressed={perfHud}
                  aria-label={
                    perfHud ? "Disable performance readout" : "Enable performance readout"
                  }
                />
              </div>
            </div>
          )}

          {pane === "stats" && <StatsPane />}
        </section>
      )}
    </div>
  );
}
