import type { Selection } from "./types";

/** One line of the checks list; clicking it selects `select` and centres the plan on `at`. */
export interface CheckItem {
  severity: "error" | "warning" | "info";
  message: string;
  hint?: string;
  at?: { x: number; z: number };
  select?: Selection;
}

/** The problems with the document as it stands, newest edit included. */
export function ChecksPanel({
  items,
  onFocus,
}: {
  items: readonly CheckItem[];
  onFocus: (item: CheckItem) => void;
}) {
  return (
    <div className="ed-panel ed-checks">
      <div className="ed-panel-head">
        <span className="eyebrow">Checks</span>
        <span className={items.length > 0 ? "ed-count is-bad" : "ed-count"}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="ed-muted">The document parses and compiles.</p>
      ) : (
        <ul className="ed-list">
          {items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: findings are recomputed as a whole on every edit
            <li key={index}>
              <button
                type="button"
                className={`ed-finding is-${item.severity}`}
                onClick={() => onFocus(item)}
                disabled={!item.at && !item.select}
              >
                <span>{item.message}</span>
                {item.hint && <span className="ed-muted">{item.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
