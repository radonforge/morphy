import type { FindingSeverity } from "@morphy/level";
import type { Selection } from "./types";

/** One line of the checks list; clicking it selects `select` and centres the plan on `at`. */
export interface CheckItem {
  severity: FindingSeverity;
  code?: string;
  message: string;
  hint?: string;
  at?: { x: number; z: number };
  select?: Selection;
}

/** Which check overlays the plan draws. */
export interface OverlayToggles {
  unreachable: boolean;
  sightlines: boolean;
  unique: boolean;
}

const SEVERITIES: { severity: FindingSeverity; label: string }[] = [
  { severity: "error", label: "Errors" },
  { severity: "warning", label: "Warnings" },
  { severity: "info", label: "Info" },
];

const OVERLAYS: { key: keyof OverlayToggles; label: string }[] = [
  { key: "unreachable", label: "Unreachable floor" },
  { key: "sightlines", label: "Sightlines" },
  { key: "unique", label: "Unique types" },
];

/**
 * The document's problems as it stands: parse and compile errors, then every
 * `validateLevel` finding, grouped by severity with a live count per group.
 * Clicking a finding selects its entity and pans the plan to it; the toggles
 * draw the geometry behind the reachability, sightline and unique-type checks.
 */
export function ChecksPanel({
  items,
  onFocus,
  overlays,
  onOverlays,
}: {
  items: readonly CheckItem[];
  onFocus: (item: CheckItem) => void;
  overlays: OverlayToggles;
  onOverlays: (next: OverlayToggles) => void;
}) {
  const groups = SEVERITIES.map((group) => ({
    ...group,
    items: items.filter((item) => item.severity === group.severity),
  }));
  return (
    <div className="ed-panel ed-checks">
      <div className="ed-panel-head">
        <span className="eyebrow">Checks</span>
        <span className="ed-counts">
          {groups.map((group) => (
            <span
              key={group.severity}
              className={`ed-count is-${group.severity}`}
              title={group.label}
            >
              {group.items.length}
            </span>
          ))}
        </span>
      </div>
      <div className="ed-toggles">
        {OVERLAYS.map((overlay) => (
          <label key={overlay.key} className="ed-toggle">
            <input
              type="checkbox"
              checked={overlays[overlay.key]}
              onChange={(event) => onOverlays({ ...overlays, [overlay.key]: event.target.checked })}
            />
            {overlay.label}
          </label>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="ed-muted">No findings: the level parses, compiles and passes every check.</p>
      ) : (
        <div className="ed-list">
          {groups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <section key={group.severity} className="ed-group">
                <h3 className={`ed-group-head is-${group.severity}`}>
                  {group.label} <span>{group.items.length}</span>
                </h3>
                <ul className="ed-list">
                  {group.items.map((item, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: findings are recomputed as a whole on every edit
                    <li key={index}>
                      <button
                        type="button"
                        className={`ed-finding is-${item.severity}`}
                        onClick={() => onFocus(item)}
                        disabled={!item.at && !item.select}
                      >
                        {item.code && <span className="ed-code">{item.code}</span>}
                        <span>{item.message}</span>
                        {item.hint && <span className="ed-muted">{item.hint}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
