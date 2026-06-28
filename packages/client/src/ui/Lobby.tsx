import { MAP_CATALOG, type MapId, MAX_NAME_LENGTH } from "@webhunt/shared";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { isMuted, setMuted } from "../game/audio";
import { loadPrefs, savePrefs } from "./prefs";

export type ConnectStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "error"; message: string };

interface LobbyProps {
  status: ConnectStatus;
  onConnect: (name: string, map: MapId) => void;
}

type PaneId = "play" | "avatar" | "private" | "stats" | "options";

interface NavItem {
  id: PaneId;
  label: string;
  icon: ReactNode;
  soon?: boolean;
}

const MAP_ACCENT: Record<MapId, string> = {
  station: "var(--cyan)",
  mars: "var(--rust)",
  urban: "var(--steel)",
};

const MAP_TAG: Record<MapId, string> = {
  station: "Interni",
  mars: "Aperto",
  urban: "Folla",
};

function MapArt({ id }: { id: MapId }): ReactNode {
  if (id === "station") {
    return (
      <div className="menu-art menu-art-station">
        <span className="menu-shape bands" />
        <span className="menu-shape win" />
      </div>
    );
  }
  if (id === "mars") {
    return (
      <div className="menu-art menu-art-mars">
        <span className="menu-shape planet" />
        <span className="menu-shape glowline" />
      </div>
    );
  }
  return (
    <div className="menu-art menu-art-urban">
      <span className="menu-shape sky2" />
      <span className="menu-shape b1" />
      <span className="menu-shape b2" />
      <span className="menu-shape b3" />
    </div>
  );
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "play",
    label: "Gioca",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5v14l11-7z" />
      </svg>
    ),
  },
  {
    id: "avatar",
    label: "Avatar",
    soon: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
      </svg>
    ),
  },
  {
    id: "private",
    label: "Privato",
    soon: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <rect x="5" y="11" width="14" height="9" rx="1.5" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    ),
  },
  {
    id: "stats",
    label: "Stats",
    soon: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M5 19V10m7 9V5m7 14v-7" />
      </svg>
    ),
  },
  {
    id: "options",
    label: "Opzioni",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1" />
      </svg>
    ),
  },
];

export function Lobby({ status, onConnect }: LobbyProps) {
  const [name, setName] = useState(() => loadPrefs().name);
  const [selectedMap, setSelectedMap] = useState<MapId>(() => loadPrefs().map);
  const [pane, setPane] = useState<PaneId>("play");
  const [muted, setMutedState] = useState(() => isMuted());

  useEffect(() => {
    savePrefs({ name, map: selectedMap });
  }, [name, selectedMap]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onConnect(name, selectedMap);
    },
    [name, selectedMap, onConnect],
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

  return (
    <div className="menu">
      <div className="menu-sky">
        <div className="menu-stars" />
      </div>
      <div className="menu-scanlines" />

      <header className="menu-top">
        <div className="menu-wordmark">
          <span className="tri">◢</span>
          <span>WEBHUNT</span>
          <span className="b">.LOL</span>
        </div>
        <div className="menu-playercard panel">
          <div className="menu-pc-av">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path
                d="M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
                opacity=".25"
              />
              <circle cx="9.5" cy="10" r="1.4" />
              <circle cx="14.5" cy="10" r="1.4" />
              <path
                d="M9 14.5c1.8 1.3 4.2 1.3 6 0"
                stroke="currentColor"
                strokeWidth="1.4"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="menu-pc-info">
            <span className="menu-pc-name">{trimmedName || "Ospite"}</span>
            <span className="menu-pc-sub">{trimmedName ? "Pronto" : "Imposta nome →"}</span>
          </div>
        </div>
      </header>

      <div className="menu-body">
        <nav className="menu-nav" aria-label="Menu">
          {NAV_ITEMS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`menu-nav-btn${pane === item.id ? " sel" : ""}`}
              onClick={() => setPane(item.id)}
              aria-pressed={pane === item.id}
            >
              <span className="menu-ic">{item.icon}</span>
              <span className="menu-lbl">{item.label}</span>
              {item.soon && <span className="menu-mini">Presto</span>}
            </button>
          ))}
        </nav>

        <div className="menu-stage">
          {pane === "play" && (
            <form className="menu-pane" onSubmit={handleSubmit}>
              <div className="menu-pane-head">
                <h2>Scegli il settore</h2>
                <span className="menu-pane-hint">3 mappe · 6 giocatori · ~8 min</span>
              </div>
              <div className="menu-maps">
                {MAP_CATALOG.map((info) => (
                  <button
                    type="button"
                    key={info.id}
                    className={`menu-map${selectedMap === info.id ? " sel" : ""}`}
                    style={{ "--accent": MAP_ACCENT[info.id] } as React.CSSProperties}
                    onClick={() => setSelectedMap(info.id)}
                    aria-pressed={selectedMap === info.id}
                  >
                    <MapArt id={info.id} />
                    <span className="menu-map-tag">{MAP_TAG[info.id]}</span>
                    <span className="menu-check">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <div className="menu-map-body">
                      <span className="menu-map-name">{info.name}</span>
                      <span className="menu-map-blurb">{info.blurb}</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="menu-deploybar">
                <div className="menu-name-field">
                  <label htmlFor="player-name">Nome giocatore</label>
                  <input
                    id="player-name"
                    value={name}
                    maxLength={MAX_NAME_LENGTH}
                    placeholder="Il tuo nome"
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                </div>
                <button type="submit" className="menu-deploy" disabled={connecting}>
                  <span className="big">▶ {connecting ? "Connessione…" : "Entra"}</span>
                  <span className="small">In partita pubblica</span>
                </button>
              </div>
              {status.kind === "error" && <span className="menu-error">{status.message}</span>}
            </form>
          )}

          {pane === "avatar" && (
            <section className="menu-pane">
              <div className="menu-pane-head">
                <h2>Avatar</h2>
              </div>
              <div className="panel menu-empty">
                <span className="menu-empty-ring">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
                  </svg>
                </span>
                <span className="menu-empty-tag">In arrivo</span>
                <b>Scegli il tuo personaggio</b>
                <p>
                  24 cube-pet e 12 personaggi umanoidi sono già pronti. Presto potrai sceglierne uno
                  invece di riceverlo a caso a inizio partita.
                </p>
              </div>
            </section>
          )}

          {pane === "private" && (
            <section className="menu-pane">
              <div className="menu-pane-head">
                <h2>Stanza privata</h2>
              </div>
              <div className="panel menu-empty">
                <span className="menu-empty-ring">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="9" rx="1.5" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                  </svg>
                </span>
                <span className="menu-empty-tag">In arrivo</span>
                <b>Gioca solo con chi inviti</b>
                <p>
                  Crea una stanza protetta da codice e condividila con i tuoi amici, oppure entra con
                  un codice ricevuto.
                </p>
              </div>
            </section>
          )}

          {pane === "stats" && (
            <section className="menu-pane">
              <div className="menu-pane-head">
                <h2>Statistiche</h2>
              </div>
              <div className="panel menu-empty">
                <span className="menu-empty-ring">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                    <path d="M5 19V10m7 9V5m7 14v-7" />
                  </svg>
                </span>
                <span className="menu-empty-tag">In arrivo</span>
                <b>Le tue partite, in numeri</b>
                <p>
                  Partite giocate, prede stanate, round vinti e tempo sopravvissuto. Arriva insieme
                  all'accesso con account.
                </p>
              </div>
            </section>
          )}

          {pane === "options" && (
            <section className="menu-pane">
              <div className="menu-pane-head">
                <h2>Opzioni</h2>
              </div>
              <div className="panel menu-card">
                <div className="menu-opt-row">
                  <span className="l">
                    <b>Audio</b>
                    <span>Effetti e ambiente sintetizzati a runtime</span>
                  </span>
                  <button
                    type="button"
                    className={`menu-toggle${muted ? "" : " on"}`}
                    onClick={toggleAudio}
                    aria-pressed={!muted}
                    aria-label={muted ? "Attiva audio" : "Disattiva audio"}
                  />
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
