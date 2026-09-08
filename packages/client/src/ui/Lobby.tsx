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
import { useCallback, useEffect, useRef, useState } from "react";
import {
  areUiSoundsEnabled,
  getMusicVolume,
  getVolume,
  isMusicEnabled,
  isMuted,
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
import { LobbyStage, STAGE_MAX_ACTORS, type StageActor } from "./LobbyStage";
import { loadPrefs, savePrefs } from "./prefs";
import { StatsPane } from "./StatsPane";

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

const MAP_ACCENT: Record<MapId, string> = {
  station: "var(--cyan)",
  mars: "var(--rust)",
  urban: "var(--steel)",
};

const MAP_TAG: Record<MapId, string> = {
  station: "Indoor",
  mars: "Open",
  urban: "Crowd",
};

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

const NAV_ITEMS: NavItem[] = [
  { id: "identity", label: "Identity" },
  { id: "private", label: "Private" },
  { id: "stats", label: "Stats" },
  { id: "options", label: "Options" },
];

const MAP_GLYPH: Record<MapId, string> = {
  station: "▣",
  mars: "◭",
  urban: "▦",
};

const PANE_TITLES: Record<PaneId, string> = {
  identity: "Identity",
  private: "Private room",
  stats: "Your stats",
  options: "Options",
};

const VOLUME_SLIDER_MAX = 100;

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

  const handleCustomize = useCallback(() => {
    if (profileRef.current.pane === "identity") return;
    playUiOpen();
    setPane("identity");
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

  const handleAvatarPick = useCallback(
    (avatar: AvatarId) => {
      if (avatar !== selectedAvatar) playUiClick();
      setSelectedAvatar(avatar);
      party?.onSetProfile(name, avatar);
    },
    [party, name, selectedAvatar],
  );

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
            avatar: isAvatarId(member.avatar) ? member.avatar : DEFAULT_AVATAR_ID,
            isHost: member.id === party.hostId,
          }))
      : [{ id: "local", name: trimmedName || "Guest", avatar: selectedAvatar, isHost: false }];

  return (
    <div className="menu">
      <LobbyStage
        map={activeMap}
        actors={stageActors}
        inParty={inParty}
        onCustomize={handleCustomize}
      />
      <div className="menu-vignette" />

      <header className="menu-top">
        <div className="menu-brand">
          <div className="menu-wordmark">
            <img className="tri" src="/icon-192.png" alt="" aria-hidden="true" />
            <span>MORPHY</span>
          </div>
          <span className="menu-build" title="Version and build of this client">
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
        <aside className="menu-party panel">
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
        <aside className="menu-maptitle" key={activeMap}>
          <span className="menu-maptitle-tag" style={{ color: MAP_ACCENT[activeMap] }}>
            {MAP_TAG[activeMap]} sector
          </span>
          <h2>{mapInfo.name}</h2>
          <p>{mapInfo.blurb}</p>
        </aside>
      )}

      <form className="menu-bottom" onSubmit={handleSubmit}>
        <div className="menu-strip">
          <span className="menu-strip-label">{inParty ? "Map" : "Preferred map"}</span>
          <div className="menu-mapstrip" role="radiogroup" aria-label="Map">
            {MAP_CATALOG.map((info) => (
              <button
                type="button"
                key={info.id}
                className={`menu-mapcard panel${activeMap === info.id ? " sel" : ""}`}
                style={{ "--accent": MAP_ACCENT[info.id] } as React.CSSProperties}
                onClick={() => handleMapPick(info.id)}
                onPointerEnter={playUiHover}
                disabled={inParty && !isHost}
                aria-pressed={activeMap === info.id}
              >
                <span className="menu-mapcard-glyph" aria-hidden="true">
                  {MAP_GLYPH[info.id]}
                </span>
                <span className="menu-mapcard-text">
                  <span className="menu-mapcard-tag">{MAP_TAG[info.id]}</span>
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
                <span className="big">▶ Start match</span>
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
              <span className="big">▶ {connecting ? "Connecting…" : "Play"}</span>
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
              <div className="menu-avatars">
                {AVATAR_CATALOG.map((info) => (
                  <button
                    type="button"
                    key={info.id}
                    className={`menu-avatar${selectedAvatar === info.id ? " sel" : ""}`}
                    onClick={() => handleAvatarPick(info.id)}
                    onPointerEnter={playUiHover}
                    aria-pressed={selectedAvatar === info.id}
                  >
                    <span className="menu-avatar-emoji" aria-hidden="true">
                      {AVATAR_EMOJI[info.id]}
                    </span>
                    <span className="menu-avatar-name">{info.name}</span>
                  </button>
                ))}
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
