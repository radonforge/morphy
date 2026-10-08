import type { Phase, Role } from "@morphy/shared";
import { useEffect, useState } from "react";
import { Kbd } from "../ui/Kbd";
import { type PropTurnMode, turnModeLabel } from "./propTurn";

const COOLDOWN_TICK_MS = 250;
const MS_PER_SECOND = 1_000;

interface ControlSpec {
  keys: string[];
  label: string;
}

interface ControlGroup {
  title: string;
  items: ControlSpec[];
}

/** Every control in the game, as the ? dialog lists it. */
export const CONTROL_GROUPS: ControlGroup[] = [
  {
    title: "Movement",
    items: [
      { keys: ["WASD"], label: "Move" },
      { keys: ["Shift"], label: "Run" },
      { keys: ["Space"], label: "Jump" },
      { keys: ["Mouse"], label: "Look" },
    ],
  },
  {
    title: "Hunter",
    items: [
      { keys: ["LMB"], label: "Shoot" },
      { keys: ["1", "2", "3"], label: "Switch weapon" },
      { keys: ["F"], label: "Sonar (props nearby honk)" },
    ],
  },
  {
    title: "Prop",
    items: [
      { keys: ["R"], label: "Swap disguise (random)" },
      { keys: ["Q", "E"], label: "Turn disguise (hold)" },
      { keys: ["X"], label: "Turn mode: free / 90° / 45° / 15°" },
      { keys: ["C"], label: "Drop decoy" },
      { keys: ["V"], label: "First / third person view" },
      { keys: ["F"], label: "Taunt (+1, +3 near a hunter)" },
    ],
  },
  {
    title: "Social",
    items: [
      { keys: ["T"], label: "Chat" },
      { keys: ["Tab"], label: "Standings (hold)" },
    ],
  },
  {
    title: "System",
    items: [
      { keys: ["M"], label: "Mute" },
      { keys: ["?"], label: "Controls" },
      { keys: ["Esc"], label: "Match menu / close" },
    ],
  },
];

function ControlKeys({ keys }: { keys: string[] }) {
  return (
    <span className="control-keys">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  );
}

export interface BarState {
  role: Role;
  alive: boolean;
  canShoot: boolean;
  canTransform: boolean;
  phase: Phase;
  rerollsLeft: number;
  decoysLeft: number;
  /** `Date.now()` at which the local prop's taunt comes off cooldown; 0 when it is ready. */
  tauntReadyAt: number;
  /** `Date.now()` at which the local hunter's sonar comes off cooldown; 0 when it is ready. */
  sonarReadyAt: number;
  /** How Q/E turn the local prop's disguise. */
  turnMode: PropTurnMode;
}

function cooldownLabel(label: string, readyAt: number, now: number): string {
  if (readyAt <= now) return label;
  return `${label} (${Math.ceil((readyAt - now) / MS_PER_SECOND)}s)`;
}

/** The current time, re-rendered on a short tick until `until` has passed. */
function useNowUntil(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (until <= Date.now()) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= until) clearInterval(timer);
    }, COOLDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, [until]);
  return now;
}

/** What the bar shows for the local player's state: the role's own actions, or a note instead. */
export function mainControls(s: BarState, now: number): { note?: string; items: ControlSpec[] } {
  if (!s.alive) return { note: "Out of HP, back in the hunt in a moment", items: [] };
  if (s.canShoot) {
    return {
      items: [
        { keys: ["LMB"], label: "Shoot" },
        { keys: ["F"], label: cooldownLabel("Sonar", s.sonarReadyAt, now) },
      ],
    };
  }
  if (s.canTransform) {
    return {
      items: [
        { keys: ["R"], label: `Swap (${s.rerollsLeft})` },
        { keys: ["Q", "E"], label: `Turn ${turnModeLabel(s.turnMode)}` },
        { keys: ["C"], label: `Decoy (${s.decoysLeft})` },
        ...(s.phase === "hunting"
          ? [{ keys: ["F"], label: cooldownLabel("Taunt", s.tauntReadyAt, now) }]
          : []),
      ],
    };
  }
  if (s.role === "hunter" && s.phase === "hiding") {
    return { note: "You're blinded… wait for the hunt", items: [] };
  }
  return { items: [{ keys: ["WASD"], label: "Move" }] };
}

export function ControlsBar({ onOpen, ...state }: BarState & { onOpen: () => void }) {
  const now = useNowUntil(Math.max(state.tauntReadyAt, state.sonarReadyAt));
  const { note, items } = mainControls(state, now);
  return (
    <div className="controls-bar">
      {note ? (
        <span className="controls-note">{note}</span>
      ) : (
        items.map((c) => (
          <span className="control" key={c.label}>
            <ControlKeys keys={c.keys} />
            <span className="control-label">{c.label}</span>
          </span>
        ))
      )}
      <button type="button" className="controls-chip" onClick={onOpen} title="All controls (?)">
        <Kbd>?</Kbd>
        <span className="control-label">All controls</span>
      </button>
    </div>
  );
}

export function ControlsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="controls-dialog">
      <button
        type="button"
        className="controls-dialog-backdrop"
        aria-label="Close controls"
        onClick={onClose}
      />
      <div className="controls-dialog-card panel" role="dialog" aria-label="Controls">
        <div className="eyebrow controls-dialog-title">Controls</div>
        <div className="controls-groups">
          {CONTROL_GROUPS.map((g) => (
            <div className="controls-group" key={g.title}>
              <div className="controls-group-title">{g.title}</div>
              {g.items.map((c) => (
                <div className="controls-row" key={c.label}>
                  <ControlKeys keys={c.keys} />
                  <span className="control-label">{c.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="dismiss-hint">
          Click anywhere or <Kbd>Esc</Kbd> to close
        </p>
      </div>
    </div>
  );
}
