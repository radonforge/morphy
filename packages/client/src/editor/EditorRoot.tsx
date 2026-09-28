import type { LevelDocument } from "@morphy/level";
import { isMapId, type MapId, type PropDefinition } from "@morphy/shared";
import { useEffect, useState } from "react";
import { App } from "../ui/App";
import { fetchCatalog, fetchLevel } from "./bridge";
import { Editor } from "./Editor";
import "./editor.css";

const DEFAULT_EDITOR_MAP: MapId = "station";

type Loaded =
  | { kind: "loading" }
  | { kind: "ready"; doc: LevelDocument; catalog: PropDefinition[] }
  | { kind: "failed"; message: string };

function mapFromHash(hash: string): MapId {
  const id = hash.split("/")[1];
  return isMapId(id) ? id : DEFAULT_EDITOR_MAP;
}

/**
 * Dev-only entry of the map editor (`#editor`, or `#editor/<mapId>`): loads
 * the document and its catalog through the dev server's level bridge, and on
 * "Try it" hands over to the game, opened straight into a private room on the
 * saved map.
 */
export default function EditorRoot() {
  const [id] = useState(() => mapFromHash(window.location.hash));
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [trying, setTrying] = useState(false);

  useEffect(() => {
    Promise.all([fetchLevel(id), fetchCatalog(id)])
      .then(([doc, catalog]) => setLoaded({ kind: "ready", doc, catalog }))
      .catch((error: unknown) =>
        setLoaded({
          kind: "failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
  }, [id]);

  if (trying) return <App tryMap={id} />;
  if (loaded.kind === "loading") return <div className="game-loading">Loading level…</div>;
  if (loaded.kind === "failed") {
    return (
      <div className="editor ed-failed">
        <div className="ed-panel">
          <span className="eyebrow">Map editor</span>
          <p>
            Could not open the level document of "{id}": {loaded.message}
          </p>
        </div>
      </div>
    );
  }
  return (
    <Editor id={id} initial={loaded.doc} catalog={loaded.catalog} onTry={() => setTrying(true)} />
  );
}
