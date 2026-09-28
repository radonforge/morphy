import type { PropDefinition } from "@morphy/shared";
import { useEffect, useState } from "react";
import { renderThumbnails } from "./thumbnails";

/** `DataTransfer` type a palette tile carries when dragged onto the scene. */
export const PALETTE_MIME = "application/x-morphy-prop";

/**
 * The catalog props, each a tile with its rendered picture and name. Drag a
 * tile onto the scene to place it, or click it and then click in the plan.
 */
export function Palette({
  catalog,
  armed,
  onArm,
}: {
  catalog: readonly PropDefinition[];
  armed: string | null;
  onArm: (type: string | null) => void;
}) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void renderThumbnails(
      catalog,
      (id, url) => setThumbs((prev) => ({ ...prev, [id]: url })),
      controller.signal,
    );
    return () => controller.abort();
  }, [catalog]);

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? catalog.filter((def) => `${def.name} ${def.id}`.toLowerCase().includes(needle))
    : catalog;

  return (
    <div className="ed-panel ed-palette">
      <div className="ed-panel-head">
        <span className="eyebrow">Props</span>
        <span className="ed-muted">{catalog.length}</span>
      </div>
      <input
        className="ed-field"
        type="search"
        placeholder="Filter"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <div className="ed-palette-grid">
        {shown.map((def) => (
          <button
            key={def.id}
            type="button"
            className={`ed-tile${armed === def.id ? " is-armed" : ""}`}
            draggable
            title={`${def.name} (${def.id})`}
            onDragStart={(event) => {
              event.dataTransfer.setData(PALETTE_MIME, def.id);
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => onArm(armed === def.id ? null : def.id)}
          >
            {thumbs[def.id] ? (
              <img src={thumbs[def.id]} alt="" draggable={false} />
            ) : (
              <span className="ed-tile-swatch" style={{ background: def.parts[0]?.color }} />
            )}
            <span className="ed-tile-name">{def.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
