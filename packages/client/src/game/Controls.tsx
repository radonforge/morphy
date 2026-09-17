import type { Phase, Role } from "@morphy/shared";
import { Kbd } from "../ui/Kbd";

interface ControlSpec {
  keys: string[];
  label: string;
}

interface ControlGroup {
  title: string;
  items: ControlSpec[];
}

const CONTROL_GROUPS: ControlGroup[] = [
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
    ],
  },
  {
    title: "Prop",
    items: [
      { keys: ["R"], label: "Swap disguise (random)" },
      { keys: ["Q", "E"], label: "Rotate disguise" },
      { keys: ["C"], label: "Drop decoy" },
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

interface BarState {
  role: Role;
  alive: boolean;
  canShoot: boolean;
  canTransform: boolean;
  phase: Phase;
  rerollsLeft: number;
  decoysLeft: number;
}

function mainControls(s: BarState): { note?: string; items: ControlSpec[] } {
  if (!s.alive) return { note: "Eliminated — spectating", items: [] };
  if (s.canShoot) {
    return {
      items: [
        { keys: ["LMB"], label: "Shoot" },
        { keys: ["1", "2", "3"], label: "Weapon" },
        { keys: ["Shift"], label: "Run" },
        { keys: ["Space"], label: "Jump" },
      ],
    };
  }
  if (s.canTransform) {
    return {
      items: [
        { keys: ["R"], label: `Swap (${s.rerollsLeft})` },
        { keys: ["Q", "E"], label: "Rotate" },
        { keys: ["C"], label: `Decoy (${s.decoysLeft})` },
        { keys: ["Shift"], label: "Run" },
        { keys: ["Space"], label: "Jump" },
      ],
    };
  }
  if (s.role === "hunter" && s.phase === "hiding") {
    return { note: "You're blinded… wait for the hunt", items: [] };
  }
  return {
    items: [
      { keys: ["WASD"], label: "Move" },
      { keys: ["Shift"], label: "Run" },
      { keys: ["Space"], label: "Jump" },
    ],
  };
}

export function ControlsBar({ onOpen, ...state }: BarState & { onOpen: () => void }) {
  const { note, items } = mainControls(state);
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
        <span className="control-label">Controls</span>
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
