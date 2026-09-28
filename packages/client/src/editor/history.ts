import type { LevelDocument } from "@morphy/level";

/** Undo depth kept; older steps fall off the bottom. */
export const HISTORY_LIMIT = 200;

/** Who made a change: the author in this page, or a tool writing the file (an agent, the CLI). */
export type ChangeSource = "local" | "external";

/** One state of the document and the step that led to it. */
export interface HistoryEntry {
  doc: LevelDocument;
  label: string;
  source: ChangeSource;
  /** Entity keys the step touched, see `changedEntities`; highlighted while the step is current. */
  changed: readonly string[];
  /** Unique among the steps of one history, so a list of them can key on it. */
  seq: number;
}

/** An undo stack in which local edits and external file changes are ordinary, undoable steps. */
export interface History {
  past: readonly HistoryEntry[];
  present: HistoryEntry;
  future: readonly HistoryEntry[];
}

export function createHistory(doc: LevelDocument): History {
  return {
    past: [],
    present: { doc, label: "Opened", source: "local", changed: [], seq: 0 },
    future: [],
  };
}

/** Make `doc` the present state; a no-op when it already is. Clears the redo branch. */
export function commit(
  history: History,
  doc: LevelDocument,
  label: string,
  source: ChangeSource,
  changed: readonly string[] = [],
): History {
  if (doc === history.present.doc) return history;
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
  return {
    past,
    present: { doc, label, source, changed, seq: history.present.seq + 1 },
    future: [],
  };
}

/**
 * Like {@link commit}, but fold into the present step when it is a local step
 * with the same label: a held key's repeats (turning an object round) then cost
 * one undo step instead of filling the history.
 */
export function commitMerged(history: History, doc: LevelDocument, label: string): History {
  const { present } = history;
  if (history.past.length === 0 || present.source !== "local" || present.label !== label) {
    return commit(history, doc, label, "local");
  }
  return { ...history, present: { ...present, doc }, future: [] };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/** Step back one change, whoever made it. */
export function undo(history: History): History {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: History): History {
  const [next, ...rest] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}
