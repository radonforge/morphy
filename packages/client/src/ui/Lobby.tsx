import {
  AVATAR_CATALOG,
  type AvatarId,
  DEFAULT_AVATAR_ID,
  DEFAULT_PLAYER_NAME,
  isAvatarId,
  isPartyCode,
  MAX_NAME_LENGTH,
  type MapId,
  MIN_PLAYERS_TO_START,
  NIGHT_CHANCE,
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
import { FieldOfViewSlider } from "../game/FieldOfViewSlider";
import {
  GRAPHICS_LABEL,
  GRAPHICS_PREFERENCES,
  type GraphicsPreference,
} from "../game/graphicsTier";
import { LookSensitivitySlider } from "../game/LookSensitivitySlider";
import {
  graphicsPreference,
  isPerfHudEnabled,
  setGraphicsPreference,
  setPerfHudEnabled,
} from "../game/prefs";
import { storageGet, storageSet } from "../safeStorage";
import { MAP_GLASS } from "../theme";
import { CarouselRail } from "./CarouselRail";
import { AVATAR_COUNT, avatarIndex, stepAvatar } from "./carousel";
import { Dropdown } from "./Dropdown";
import { MapSlices } from "./MapSlices";
import { loadPrefs, savePrefs } from "./prefs";
import { StatsPane } from "./StatsPane";
import { STAGE_MAX_ACTORS, type StageActor } from "./stageActors";
import { useCarouselInput } from "./useCarouselInput";
import { useReducedMotion } from "./useReducedMotion";
import {
  settledMotion,
  sliceForKey,
  WORLD_IDS,
  type WorldsMotion,
  worldsLayout,
} from "./worldSlices";

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

type PaneId = "private" | "stats" | "options";

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
  { id: "private", label: "Party" },
  { id: "stats", label: "Stats" },
  { id: "options", label: "Options" },
];

const STUDIO_NAME = "Radon Forge";
const STUDIO_URL = "https://radonforge.com";

const CHANGELOG_PATH = "/changelog";
const FOOTER_LINKS = [
  { href: CHANGELOG_PATH, label: "Changelog" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;

/** The last client version this browser opened the changelog for, or saw the notice of. */
const SEEN_VERSION_KEY = "morphy:seen-version";

/**
 * Whether this client is newer than the last one this browser saw. A browser that has seen none
 * is a first visit, with nothing to catch up on, so it is recorded as seen without a notice; if
 * storage is blocked the record lives only for the page and the notice never shows.
 */
function hasUnseenVersion(): boolean {
  const seen = storageGet(SEEN_VERSION_KEY);
  if (seen === null) {
    storageSet(SEEN_VERSION_KEY, __MORPHY_VERSION__);
    return false;
  }
  return seen !== __MORPHY_VERSION__;
}

/** Whether the lobby is drawn by night, once per page load: coming back from a match keeps it. */
const LOBBY_NIGHT = Math.random() < NIGHT_CHANCE;

function mapIndex(map: MapId): number {
  return Math.max(0, WORLD_IDS.indexOf(map));
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function isActivatable(target: EventTarget | null): boolean {
  return target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement;
}

const PANE_TITLES: Record<PaneId, string> = {
  private: "Private room",
  stats: "Your stats",
  options: "Options",
};

const VOLUME_SLIDER_MAX = 100;
const GRAPHICS_OPTIONS = GRAPHICS_PREFERENCES.map((pref) => ({
  value: pref,
  label: GRAPHICS_LABEL[pref],
}));
const SHEEN_PERCENT = 100;

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
  const [graphics, setGraphicsState] = useState<GraphicsPreference>(() => graphicsPreference());
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);
  const [chipHost, setChipHost] = useState<HTMLDivElement | null>(null);
  const [unseenVersion, setUnseenVersion] = useState(hasUnseenVersion);
  const [hostPick, setHostPick] = useState<MapId | null>(null);
  const reduced = useReducedMotion();

  const inParty = party !== null;
  const isHost = party !== null && party.selfId === party.hostId;
  const activeMap = party ? (hostPick ?? party.mapId) : selectedMap;
  const openIndex = mapIndex(activeMap);
  const motion = useRef<WorldsMotion>(
    settledMotion(worldsLayout(WORLD_IDS.length, openIndex, false)),
  );

  useEffect(() => {
    savePrefs({ name, map: selectedMap, avatar: selectedAvatar });
  }, [name, selectedMap, selectedAvatar]);

  useEffect(() => {
    if (inParty) setPane(null);
  }, [inParty]);

  const serverMap = party?.mapId ?? null;
  useEffect(() => {
    if (!isHost || serverMap === hostPick) setHostPick(null);
  }, [isHost, serverMap, hostPick]);

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

  const profileRef = useRef({ party, name, avatar: selectedAvatar });
  profileRef.current = { party, name, avatar: selectedAvatar };

  const commitProfile = useCallback(() => {
    const { party: p, name: n, avatar } = profileRef.current;
    p?.onSetProfile(n, avatar);
  }, []);

  const closePane = useCallback(() => {
    playUiClose();
    setPane(null);
  }, []);

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
      playUiOpen();
      setPane(id);
    },
    [pane, closePane],
  );

  const openAvatarPicker = useCallback(() => {
    playUiOpen();
    setPane(null);
    setPicking(true);
  }, []);

  const closePicker = useCallback(() => {
    commitProfile();
    playUiClose();
    setPicking(false);
  }, [commitProfile]);

  const connecting = status.kind === "connecting";
  const canChoose = !inParty || isHost;
  const canStart = party !== null && isHost && party.members.length >= MIN_PLAYERS_TO_START;

  /**
   * Play always plays the open map, so choosing a world and starting are one gesture. In a party
   * only the host starts, and only once there are enough players to.
   */
  const play = useCallback(() => {
    if (party) {
      if (!canStart) return;
      playUiDeploy();
      party.onStart();
      return;
    }
    if (connecting) return;
    playUiDeploy();
    onConnect(name, activeMap, selectedAvatar);
  }, [party, canStart, connecting, onConnect, name, activeMap, selectedAvatar]);

  /**
   * Opens slice `index`. Solo, that is the saved pick. A party's map is the server's, so the
   * host's pick opens at once and is held until the server says the room's map is that one, which
   * lets a second press step on from it instead of from the map before; it never touches the solo
   * pick saved for the next public match.
   */
  const openSlice = useCallback(
    (index: number) => {
      const next = WORLD_IDS[index];
      if (next === undefined || next === activeMap || !canChoose) return;
      playMorph();
      if (party) {
        setHostPick(next);
        party.onSetMap(next);
      } else {
        setSelectedMap(next);
      }
    },
    [activeMap, canChoose, party],
  );

  const markVersionSeen = useCallback(() => {
    storageSet(SEEN_VERSION_KEY, __MORPHY_VERSION__);
    setUnseenVersion(false);
  }, []);

  useEffect(() => {
    if (picking || pane !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === "Enter") {
        if (isActivatable(e.target)) return;
        e.preventDefault();
        play();
        return;
      }
      const next = sliceForKey(e.key, openIndex, WORLD_IDS.length);
      if (next === null || !canChoose) return;
      e.preventDefault();
      openSlice(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, pane, play, openIndex, canChoose, openSlice]);

  const handleAvatarStep = useCallback(
    (delta: number) => {
      const next = stepAvatar(selectedAvatar, delta);
      playMorph();
      setSelectedAvatar(next);
      party?.onSetProfile(name, next);
    },
    [party, name, selectedAvatar],
  );

  const avatarInput = useCarouselInput(picking, handleAvatarStep, closePicker);

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

  const changeGraphics = useCallback((value: GraphicsPreference) => {
    setGraphicsPreference(value);
    setGraphicsState(value);
    playUiClick();
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

  const trimmedName = name.trim();
  const avatarInfo = AVATAR_CATALOG.find((info) => info.id === selectedAvatar);

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
      : [
          {
            id: "local",
            name: trimmedName || DEFAULT_PLAYER_NAME,
            avatar: selectedAvatar,
            isHost: false,
          },
        ];

  const chromeClass = `menu-chrome${picking ? " menu-chrome-out" : ""}`;

  return (
    <div
      className="menu"
      ref={menuRef}
      onPointerMove={handleSheenMove}
      style={{ "--glass-tint": MAP_GLASS[activeMap] } as React.CSSProperties}
    >
      <Suspense fallback={null}>
        <LobbyStage
          open={activeMap}
          motion={motion}
          night={LOBBY_NIGHT}
          actors={stageActors}
          inParty={inParty}
          picking={picking}
          chipHost={chipHost}
          onCustomize={openAvatarPicker}
        />
      </Suspense>
      <MapSlices
        open={openIndex}
        focus={picking}
        motion={motion}
        night={LOBBY_NIGHT}
        canChoose={canChoose}
        reduced={reduced}
        onOpen={openSlice}
      >
        <div className="world-play-row">
          {party && !isHost ? (
            <span className="world-play world-play-waiting">Waiting for host…</span>
          ) : (
            <button
              type="button"
              className="world-play"
              onClick={play}
              onPointerEnter={playUiHover}
              disabled={party ? !canStart : connecting}
            >
              <i aria-hidden="true" />
              {party ? "Start match" : connecting ? "Connecting…" : "Play"}
            </button>
          )}
          <span className="world-play-sub">
            {party
              ? isHost
                ? party.members.length < MIN_PLAYERS_TO_START
                  ? `Need at least ${MIN_PLAYERS_TO_START} players`
                  : `Party of ${party.members.length}`
                : "Only the host can start the match"
              : "Public match"}
          </span>
        </div>
        {status.kind === "error" && <span className="menu-error">{status.message}</span>}
      </MapSlices>
      <div className="stage-overlay" ref={setChipHost} />

      <header className={`menu-top ${chromeClass}`} inert={picking}>
        <div className="menu-brand">
          <span className="menu-wordmark">MORPHY</span>
          <span
            className="menu-version"
            title="Version of this client, in early alpha: expect bugs, rough edges and changes between visits. A trailing + means the build is past that release."
          >
            v{__MORPHY_VERSION__} · Early alpha
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
        <aside className={`menu-party panel ${chromeClass}`} inert={picking}>
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

      {picking && (
        <>
          <button
            type="button"
            className="morph-backdrop"
            aria-label="Close the avatar picker"
            onClick={closePicker}
            onWheel={avatarInput.onWheel}
          />
          <CarouselRail
            noun="avatar"
            name={avatarInfo?.name ?? selectedAvatar}
            position={avatarIndex(selectedAvatar) + 1}
            total={AVATAR_COUNT}
            onStep={handleAvatarStep}
          >
            <div className="morph-callsign panel">
              <label htmlFor="player-name" className="eyebrow">
                Callsign
              </label>
              <input
                id="player-name"
                value={name}
                maxLength={MAX_NAME_LENGTH}
                placeholder={DEFAULT_PLAYER_NAME}
                onChange={(e) => setName(e.target.value)}
                onBlur={commitProfile}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </div>
          </CarouselRail>
        </>
      )}

      <footer className={`menu-foot ${chromeClass}`} inert={picking}>
        {unseenVersion && (
          <a
            className="menu-new"
            href={CHANGELOG_PATH}
            target="_blank"
            rel="noopener"
            onClick={markVersionSeen}
          >
            What's new
          </a>
        )}
        {FOOTER_LINKS.map((link) => (
          <a
            key={link.href}
            className="menu-foot-link"
            href={link.href}
            target="_blank"
            rel="noopener"
            onClick={link.href === CHANGELOG_PATH ? markVersionSeen : undefined}
          >
            {link.label}
          </a>
        ))}
        <a className="menu-foot-studio" href={STUDIO_URL} target="_blank" rel="noreferrer">
          © {STUDIO_NAME}
        </a>
      </footer>

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
                  <b>Graphics quality</b>
                  <span>Auto reads your GPU and steps down after a slow round</span>
                </span>
                <Dropdown
                  value={graphics}
                  options={GRAPHICS_OPTIONS}
                  onChange={changeGraphics}
                  label="Graphics quality"
                />
              </div>
              <div className="menu-opt-row">
                <span className="l">
                  <b>Look sensitivity</b>
                  <span>Mouse and trackpad aim speed</span>
                </span>
                <LookSensitivitySlider />
              </div>
              <div className="menu-opt-row">
                <span className="l">
                  <b>Field of view</b>
                  <span>How wide the match camera sees</span>
                </span>
                <FieldOfViewSlider />
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
