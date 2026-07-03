import {
  AVATAR_CATALOG,
  type AvatarId,
  DEFAULT_AVATAR_ID,
  isAvatarId,
  isPartyCode,
  MAP_CATALOG,
  MAX_NAME_LENGTH,
  MIN_PLAYERS_TO_START,
  type MapId,
  normalizePartyCode,
  PARTY_CODE_LENGTH,
} from "@webhunt/shared";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { isMuted, setMuted } from "../game/audio";
import { LobbyStage, STAGE_MAX_ACTORS, type StageActor } from "./LobbyStage";
import { loadPrefs, savePrefs } from "./prefs";

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

type PaneId = "play" | "avatar" | "private" | "stats" | "options";

interface NavItem {
  id: PaneId;
  label: string;
  soon?: boolean;
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
  { id: "play", label: "Play" },
  { id: "avatar", label: "Avatar" },
  { id: "private", label: "Private" },
  { id: "stats", label: "Stats", soon: true },
  { id: "options", label: "Options" },
];

function ComingSoon({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="menu-empty">
      <span className="menu-empty-ring">{icon}</span>
      <span className="menu-empty-tag">Coming soon</span>
      <b>{title}</b>
      <p>{body}</p>
    </div>
  );
}

export function Lobby({ status, party, onConnect, onCreateParty, onJoinParty }: LobbyProps) {
  const [name, setName] = useState(() => loadPrefs().name);
  const [selectedMap, setSelectedMap] = useState<MapId>(() => loadPrefs().map);
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarId>(() => loadPrefs().avatar);
  const [pane, setPane] = useState<PaneId>("play");
  const [muted, setMutedState] = useState(() => isMuted());
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState(false);

  const inParty = party !== null;
  const isHost = party !== null && party.selfId === party.hostId;
  const activeMap = party ? party.mapId : selectedMap;

  useEffect(() => {
    savePrefs({ name, map: selectedMap, avatar: selectedAvatar });
  }, [name, selectedMap, selectedAvatar]);

  useEffect(() => {
    if (inParty) setPane("play");
  }, [inParty]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPY_FLASH_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (pane === "play") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPane("play");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pane]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (party) {
        party.onSetProfile(name, selectedAvatar);
        return;
      }
      onConnect(name, selectedMap, selectedAvatar);
    },
    [party, name, selectedMap, selectedAvatar, onConnect],
  );

  const handleMapPick = useCallback(
    (map: MapId) => {
      if (party) {
        if (party.selfId !== party.hostId) return;
        party.onSetMap(map);
      }
      setSelectedMap(map);
    },
    [party],
  );

  const handleAvatarPick = useCallback(
    (avatar: AvatarId) => {
      setSelectedAvatar(avatar);
      party?.onSetProfile(name, avatar);
    },
    [party, name],
  );

  const handleNameCommit = useCallback(() => {
    party?.onSetProfile(name, selectedAvatar);
  }, [party, name, selectedAvatar]);

  const canCopy = typeof navigator !== "undefined" && navigator.clipboard !== undefined;
  const copyCode = useCallback(() => {
    if (!party || !navigator.clipboard) return;
    navigator.clipboard.writeText(party.code).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }, [party]);

  const handleJoinSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!isPartyCode(joinCode)) return;
      onJoinParty(joinCode, name, selectedAvatar);
    },
    [joinCode, name, selectedAvatar, onJoinParty],
  );

  const toggleAudio = useCallback(() => {
    setMutedState((prev) => {
      const next = !prev;
      setMuted(next);
      return next;
    });
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
      <LobbyStage map={activeMap} actors={stageActors} inParty={inParty} />
      <div className="menu-vignette" />

      <header className="menu-top">
        <div className="menu-wordmark">
          <span className="tri">◢</span>
          <span>WEBHUNT</span>
          <span className="b">.LOL</span>
        </div>
        <nav className="menu-tabs" aria-label="Menu">
          {NAV_ITEMS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`menu-tab${pane === item.id ? " sel" : ""}`}
              onClick={() => setPane((current) => (current === item.id ? "play" : item.id))}
              aria-pressed={pane === item.id}
            >
              {item.label}
              {item.soon && <span className="menu-mini">Soon</span>}
            </button>
          ))}
        </nav>
        <div className="menu-playercard panel">
          <div className="menu-pc-av">
            <span className="menu-pc-emoji" aria-hidden="true">
              {AVATAR_EMOJI[selectedAvatar]}
            </span>
          </div>
          <div className="menu-pc-info">
            <span className="menu-pc-name">{trimmedName || "Guest"}</span>
            <span className="menu-pc-sub">
              {inParty ? "In party" : trimmedName ? "Ready" : "Set name →"}
            </span>
          </div>
        </div>
      </header>

      {party && (
        <aside className="menu-party panel">
          <span className="eyebrow">Party code</span>
          <div className="menu-party-code">
            <b>{party.code}</b>
            {canCopy && (
              <button type="button" onClick={copyCode}>
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
          <button type="button" className="menu-party-leave" onClick={party.onLeaveParty}>
            Leave party
          </button>
        </aside>
      )}

      {stageActors.length === 1 && pane === "play" && (
        <aside className="menu-maptitle" key={activeMap}>
          <span className="menu-maptitle-tag" style={{ color: MAP_ACCENT[activeMap] }}>
            {MAP_TAG[activeMap]} sector
          </span>
          <h2>{mapInfo.name}</h2>
          <p>{mapInfo.blurb}</p>
        </aside>
      )}

      <form className="menu-bottom" onSubmit={handleSubmit}>
        <div className="menu-mapstrip" role="radiogroup" aria-label="Map">
          {MAP_CATALOG.map((info) => (
            <button
              type="button"
              key={info.id}
              className={`menu-mapcard${activeMap === info.id ? " sel" : ""}`}
              style={{ "--accent": MAP_ACCENT[info.id] } as React.CSSProperties}
              onClick={() => handleMapPick(info.id)}
              disabled={inParty && !isHost}
              aria-pressed={activeMap === info.id}
            >
              <span className="menu-mapcard-tag">{MAP_TAG[info.id]}</span>
              <span className="menu-mapcard-name">{info.name}</span>
            </button>
          ))}
        </div>
        <div className="menu-dock">
          <div className="menu-name-field">
            <label htmlFor="player-name">Player name</label>
            <input
              id="player-name"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              placeholder="Your name"
              onChange={(e) => setName(e.target.value)}
              onBlur={handleNameCommit}
              autoFocus
            />
          </div>
          {party ? (
            isHost ? (
              <button
                type="button"
                className="menu-deploy"
                onClick={party.onStart}
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
            <button type="submit" className="menu-deploy" disabled={connecting}>
              <span className="big">▶ {connecting ? "Connecting…" : "Play"}</span>
              <span className="small">Public match</span>
            </button>
          )}
        </div>
        {status.kind === "error" && <span className="menu-error">{status.message}</span>}
      </form>

      {pane !== "play" && (
        <section className="menu-panel panel">
          <header className="menu-sheet-head">
            <h2>
              {pane === "avatar" && "Choose your avatar"}
              {pane === "private" && "Private room"}
              {pane === "stats" && "Statistics"}
              {pane === "options" && "Options"}
            </h2>
            <button
              type="button"
              className="menu-sheet-close"
              onClick={() => setPane("play")}
              aria-label="Close"
            >
              ✕
            </button>
          </header>

          {pane === "avatar" && (
            <div className="menu-avatars">
              {AVATAR_CATALOG.map((info) => (
                <button
                  type="button"
                  key={info.id}
                  className={`menu-avatar${selectedAvatar === info.id ? " sel" : ""}`}
                  onClick={() => handleAvatarPick(info.id)}
                  aria-pressed={selectedAvatar === info.id}
                >
                  <span className="menu-avatar-emoji" aria-hidden="true">
                    {AVATAR_EMOJI[info.id]}
                  </span>
                  <span className="menu-avatar-name">{info.name}</span>
                </button>
              ))}
            </div>
          )}

          {pane === "private" && party && (
            <div className="menu-card menu-party-sheet">
              <span className="eyebrow">Party code</span>
              <b className="menu-party-bigcode">{party.code}</b>
              <p>Share this code with your friends so they can join you.</p>
              {canCopy && (
                <button type="button" className="menu-party-btn" onClick={copyCode}>
                  {copied ? "Copied ✓" : "Copy code"}
                </button>
              )}
              <button type="button" className="menu-party-leave" onClick={party.onLeaveParty}>
                Leave party
              </button>
            </div>
          )}

          {pane === "private" && !party && (
            <div className="menu-party-setup">
              <div className="menu-card">
                <b>Create a room</b>
                <p>
                  Get a code to share with your friends. You pick the map and start the match.
                </p>
                <button
                  type="button"
                  className="menu-party-btn"
                  onClick={() => onCreateParty(name, selectedMap, selectedAvatar)}
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
                    disabled={!isPartyCode(joinCode) || connecting}
                  >
                    {connecting ? "…" : "Join"}
                  </button>
                </form>
                {status.kind === "error" && <span className="menu-error">{status.message}</span>}
              </div>
            </div>
          )}

          {pane === "stats" && (
            <ComingSoon
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <path d="M5 19V10m7 9V5m7 14v-7" />
                </svg>
              }
              title="Your matches, in numbers"
              body="Matches played, props flushed out, rounds won and time survived. Comes with account login."
            />
          )}

          {pane === "options" && (
            <div className="menu-card">
              <div className="menu-opt-row">
                <span className="l">
                  <b>Audio</b>
                  <span>Effects and ambience synthesized at runtime</span>
                </span>
                <button
                  type="button"
                  className={`menu-toggle${muted ? "" : " on"}`}
                  onClick={toggleAudio}
                  aria-pressed={!muted}
                  aria-label={muted ? "Unmute audio" : "Mute audio"}
                />
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
