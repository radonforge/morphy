import type { CellRect, LevelDoor } from "@morphy/level";
import type { SpawnTeam } from "./edits";

/** What the author has selected: one object, one rect of a room, or one spawn point. */
export type Selection =
  | { kind: "object"; id: string }
  | { kind: "room"; roomId: string; index: number }
  | { kind: "spawn"; team: SpawnTeam; index: number }
  | null;

/** The active pointer tool. `place` stamps the palette prop picked last. */
export type Tool =
  | { kind: "select" }
  | { kind: "room" }
  | { kind: "door" }
  | { kind: "spawn"; team: SpawnTeam }
  | { kind: "place"; type: string };

export type EditorView = "plan" | "orbit";

/** Transient, not-yet-committed feedback the plan overlay draws under the pointer. */
export interface Preview {
  edge: { door: LevelDoor; valid: boolean } | null;
  rect: { rect: CellRect; valid: boolean } | null;
  ghost: { x: number; z: number; radius: number } | null;
}

export const EMPTY_PREVIEW: Preview = { edge: null, rect: null, ghost: null };
