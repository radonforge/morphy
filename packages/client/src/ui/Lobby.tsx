import {
  AVATAR_CATALOG,
  type AvatarId,
  MAP_CATALOG,
  MAX_NAME_LENGTH,
  type MapId,
} from "@webhunt/shared";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { isMuted, setMuted } from "../game/audio";
import { LobbyStage } from "./LobbyStage";
import { loadPrefs, savePrefs } from "./prefs";

export type ConnectStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "error"; message: string };

interface LobbyProps {
  status: ConnectStatus;
  onConnect: (name: string, map: MapId, avatar: AvatarId) => void;
}

type PaneId = "play" | "avatar" | "private" | "stats" | "options";

interface NavItem {
  id: PaneId;
  label: string;
  soon?: boolean;
}

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

const NAV_ITEMS: NavItem[] = [
  { id: "play", label: "Play" },
  { id: "avatar", label: "Avatar" },
  { id: "private", label: "Private", soon: true },
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

export function Lobby({ status, onConnect }: LobbyProps) {
  const [name, setName] = useState(() => loadPrefs().name);
  const [selectedMap, setSelectedMap] = useState<MapId>(() => loadPrefs().map);
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarId>(() => loadPrefs().avatar);
  const [pane, setPane] = useState<PaneId>("play");
  const [muted, setMutedState] = useState(() => isMuted());

  useEffect(() => {
    savePrefs({ name, map: selectedMap, avatar: selectedAvatar });
  }, [name, selectedMap, selectedAvatar]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onConnect(name, selectedMap, selectedAvatar);
    },
    [name, selectedMap, selectedAvatar, onConnect],
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
  const mapInfo = MAP_CATALOG.find((info) => info.id === selectedMap) ?? MAP_CATALOG[0];

  return (
    <div className="menu">
      <LobbyStage map={selectedMap} avatar={selectedAvatar} />
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
              onClick={() => setPane(item.id)}
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
            <span className="menu-pc-sub">{trimmedName ? "Ready" : "Set name →"}</span>
          </div>
        </div>
      </header>

      <aside className="menu-maptitle" key={selectedMap}>
        <span className="menu-maptitle-tag" style={{ color: MAP_ACCENT[selectedMap] }}>
          {MAP_TAG[selectedMap]} sector
        </span>
        <h2>{mapInfo.name}</h2>
        <p>{mapInfo.blurb}</p>
      </aside>

      <form className="menu-bottom" onSubmit={handleSubmit}>
        <div className="menu-mapstrip" role="radiogroup" aria-label="Map">
          {MAP_CATALOG.map((info) => (
            <button
              type="button"
              key={info.id}
              className={`menu-mapcard${selectedMap === info.id ? " sel" : ""}`}
              style={{ "--accent": MAP_ACCENT[info.id] } as React.CSSProperties}
              onClick={() => setSelectedMap(info.id)}
              aria-pressed={selectedMap === info.id}
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
              autoFocus
            />
          </div>
          <button type="submit" className="menu-deploy" disabled={connecting}>
            <span className="big">▶ {connecting ? "Connecting…" : "Play"}</span>
            <span className="small">Public match</span>
          </button>
        </div>
        {status.kind === "error" && <span className="menu-error">{status.message}</span>}
      </form>

      {pane !== "play" && (
        <div className="menu-overlay">
          <section className="menu-sheet panel">
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
                    onClick={() => setSelectedAvatar(info.id)}
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

            {pane === "private" && (
              <ComingSoon
                icon={
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    aria-hidden="true"
                  >
                    <rect x="5" y="11" width="14" height="9" rx="1.5" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                  </svg>
                }
                title="Play only with people you invite"
                body="Create a code-protected room and share it with your friends, or join with a code you received."
              />
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
        </div>
      )}
    </div>
  );
}
