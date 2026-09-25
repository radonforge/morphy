import {
  AVATAR_CATALOG,
  type AvatarId,
  DEFAULT_AVATAR_ID,
  DEFAULT_PLAYER_NAME,
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
import {
  GRAPHICS_LABEL,
  GRAPHICS_PREFERENCES,
  type GraphicsPreference,
  isGraphicsPreference,
} from "../game/graphicsTier";
import {
  graphicsPreference,
  isPerfHudEnabled,
  setGraphicsPreference,
  setPerfHudEnabled,
} from "../game/prefs";
import { MAP_CHROME, MAP_GLASS } from "../theme";
import { CarouselRail } from "./CarouselRail";
import { AVATAR_COUNT, avatarIndex, MAP_COUNT, mapIndex, stepAvatar, stepMap } from "./carousel";
import { loadPrefs, savePrefs } from "./prefs";
import { StatsPane } from "./StatsPane";
import { type PickerId, STAGE_MAX_ACTORS, type StageActor } from "./stageActors";
import { useCarouselInput } from "./useCarouselInput";

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
  { id: "private", label: "Private" },
  { id: "stats", label: "Stats" },
  { id: "options", label: "Options" },
];

const STUDIO_NAME = "Radon Forge";
const STUDIO_URL = "https://radonforge.com";

const PANE_TITLES: Record<PaneId, string> = {
  private: "Private room",
  stats: "Your stats",
  options: "Options",
};

const VOLUME_SLIDER_MAX = 100;
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
  const [picker, setPicker] = useState<PickerId | null>(null);
  const [chipHost, setChipHost] = useState<HTMLDivElement | null>(null);

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

  const openPicker = useCallback((id: PickerId) => {
    playUiOpen();
    setPane(null);
    setPicker(id);
  }, []);

  const openAvatarPicker = useCallback(() => openPicker("avatar"), [openPicker]);
  const openWorldPicker = useCallback(() => {
    setSelectedMap(activeMap);
    openPicker("world");
  }, [openPicker, activeMap]);

  const closePicker = useCallback(() => {
    if (picker === "avatar") commitProfile();
    playUiClose();
    setPicker(null);
  }, [picker, commitProfile]);

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

  /**
   * The world carousel steps from `selectedMap`, not from `activeMap`: in a party the map on
   * screen is the server's, so two quick presses would both compute from the same pre-round-trip
   * value and advance one map instead of two. `openPicker` aligns the two before the first step.
   */
  const handleWorldStep = useCallback(
    (delta: number) => {
      if (party !== null && party.selfId !== party.hostId) return;
      const next = stepMap(selectedMap, delta);
      playMorph();
      setSelectedMap(next);
      party?.onSetMap(next);
    },
    [party, selectedMap],
  );

  const handleAvatarStep = useCallback(
    (delta: number) => {
      const next = stepAvatar(selectedAvatar, delta);
      playMorph();
      setSelectedAvatar(next);
      party?.onSetProfile(name, next);
    },
    [party, name, selectedAvatar],
  );

  const avatarInput = useCarouselInput(picker === "avatar", handleAvatarStep, closePicker);
  const worldInput = useCarouselInput(picker === "world", handleWorldStep, closePicker);

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

  const changeGraphics = useCallback((value: string) => {
    if (!isGraphicsPreference(value)) return;
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

  const connecting = status.kind === "connecting";
  const trimmedName = name.trim();
  const mapInfo = MAP_CATALOG.find((info) => info.id === activeMap) ?? MAP_CATALOG[0];
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

  const chromeClass = `menu-chrome${picker !== null ? " menu-chrome-out" : ""}`;

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
          picker={picker}
          chipHost={chipHost}
          onCustomize={openAvatarPicker}
        />
      </Suspense>
      <div className="stage-overlay" ref={setChipHost} />
      <div className="menu-vignette" />

      <header className={`menu-top ${chromeClass}`} inert={picker !== null}>
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
          <a className="menu-legal" href={STUDIO_URL} target="_blank" rel="noreferrer">
            © {STUDIO_NAME}
          </a>
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
        <aside className={`menu-party panel ${chromeClass}`} inert={picker !== null}>
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
        <aside className={`menu-maptitle ${chromeClass}`} key={activeMap} inert={picker !== null}>
          <span className="menu-maptitle-tag" style={{ color: MAP_CHROME[activeMap].accent }}>
            {mapInfo.tag} sector
          </span>
          <h2>{mapInfo.name}</h2>
          <p>{mapInfo.blurb}</p>
        </aside>
      )}

      {picker !== null && (
        <>
          <button
            type="button"
            className="morph-backdrop"
            aria-label={`Close the ${picker === "avatar" ? "avatar" : "map"} picker`}
            onClick={closePicker}
            onWheel={picker === "avatar" ? avatarInput.onWheel : worldInput.onWheel}
          />
          {picker === "avatar" ? (
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
          ) : (
            <CarouselRail
              noun="map"
              name={mapInfo.name}
              position={mapIndex(activeMap) + 1}
              total={MAP_COUNT}
              onStep={handleWorldStep}
            />
          )}
        </>
      )}

      <form
        className={`menu-bottom ${chromeClass}`}
        onSubmit={handleSubmit}
        inert={picker !== null}
      >
        <div className="menu-strip">
          <span className="menu-strip-label">Map</span>
          <button
            type="button"
            className="menu-mapcard panel sel"
            style={{ "--accent": MAP_CHROME[activeMap].accent } as React.CSSProperties}
            onClick={openWorldPicker}
            onPointerEnter={playUiHover}
            disabled={inParty && !isHost}
          >
            <span className="menu-mapcard-glyph" aria-hidden="true">
              {MAP_CHROME[activeMap].glyph}
            </span>
            <span className="menu-mapcard-text">
              <span className="menu-mapcard-tag">{mapInfo.tag}</span>
              <span className="menu-mapcard-name">{mapInfo.name}</span>
            </span>
            <span className="menu-mapcard-swap" aria-hidden="true">
              {inParty && !isHost ? "" : "\u21c4"}
            </span>
          </button>
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
                <select
                  className="menu-select"
                  value={graphics}
                  onChange={(e) => changeGraphics(e.target.value)}
                  aria-label="Graphics quality"
                >
                  {GRAPHICS_PREFERENCES.map((pref) => (
                    <option key={pref} value={pref}>
                      {GRAPHICS_LABEL[pref]}
                    </option>
                  ))}
                </select>
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
