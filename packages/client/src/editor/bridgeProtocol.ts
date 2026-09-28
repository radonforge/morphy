import type { LevelDocument } from "@morphy/level";
import type { MapId } from "@morphy/shared";

/**
 * Dev-server routes of the level bridge (`viteLevelBridge.ts`), shared by the
 * Node side and the editor page. `GET` and `PUT` on `<path>/<mapId>` read and
 * write the document; `GET <path>/<mapId>/catalog` returns its prop catalog.
 */
export const LEVEL_BRIDGE_PATH = "/__morphy/levels";
export const LEVEL_CATALOG_SEGMENT = "catalog";

/** HMR custom event the dev server sends when a document file changes on disk from outside the page. */
export const LEVEL_CHANGED_EVENT = "morphy:level-changed";

/** Payload of {@link LEVEL_CHANGED_EVENT}: the new document, or why the file on disk no longer parses. */
export type LevelChangedPayload =
  | { id: MapId; document: LevelDocument }
  | { id: MapId; error: string };

/** Body of a failed bridge request. */
export interface BridgeError {
  error: string;
}
