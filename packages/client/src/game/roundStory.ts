import type { Phase, Role, Winner } from "@morphy/shared";

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;

/** The role each player was dealt when the round began, keyed by session id. */
export type StartingRoles = Readonly<Record<string, Role>>;

/** A prop's capture, as the client saw it: who scored it and how far into the hunt. */
export interface CaptureRecord {
  byName: string;
  atMs: number;
}

const PHASE_LABEL: Record<Phase, Record<Role, string>> = {
  lobby: { prop: "Waiting for players", hunter: "Waiting for players" },
  starting: { prop: "Starting…", hunter: "Starting…" },
  hiding: { prop: "Hide", hunter: "Get ready" },
  hunting: { prop: "Survive", hunter: "Hunt!" },
  round_end: { prop: "Round over", hunter: "Round over" },
};

/** The top bar's phase name, worded for the side reading it: a prop is never told to hunt. */
export function phaseLabel(phase: Phase, role: Role): string {
  return PHASE_LABEL[phase][role];
}

/** The props counter, with its unit, so a bare number is never left to be guessed at. */
export function propsLeftLabel(count: number): string {
  return `${count} ${count === 1 ? "prop" : "props"} left`;
}

function sameRoles(a: StartingRoles, b: StartingRoles): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((id) => a[id] === b[id]);
}

/**
 * Carry the starting-role record from one render to the next. Roles are dealt as hiding
 * begins and nobody can be caught until the hunt, so every role read during hiding is a
 * starting role; once the hunt is on, the record is frozen and a capture no longer rewrites
 * it. A player the record never saw, as after a remount mid-round, is entered with the role
 * they hold now, which is the best the client knows. Returns `prev` itself when nothing
 * changed, so it can feed a React state setter without re-rendering.
 */
export function nextStartingRoles(
  prev: StartingRoles,
  phase: Phase,
  roles: Readonly<Record<string, Role>>,
): StartingRoles {
  if (phase === "lobby" || phase === "starting") {
    return Object.keys(prev).length === 0 ? prev : {};
  }
  const next: Record<string, Role> = phase === "hiding" ? {} : { ...prev };
  for (const [id, role] of Object.entries(roles)) {
    if (phase === "hiding" || next[id] === undefined) next[id] = role;
  }
  return sameRoles(prev, next) ? prev : next;
}

/** Whether a player who started the round as `startingRole` is on the winning side. */
export function wonRound(startingRole: Role, winner: Winner): boolean {
  return (
    (startingRole === "hunter" && winner === "hunters") ||
    (startingRole === "prop" && winner === "props")
  );
}

/** `m:ss`, rounded down, for a span of the hunt. */
export function formatSpan(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MS_PER_SECOND));
  const minutes = Math.floor(total / SECONDS_PER_MINUTE);
  const seconds = total % SECONDS_PER_MINUTE;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function propsPhrase(count: number): string {
  return `${count} ${count === 1 ? "prop" : "props"}`;
}

/**
 * The one line the round-end card tells the local player about their own round: how long
 * they hid and who found them, or that they made it, or what they caught as a hunter.
 */
export function storyLine(
  startingRole: Role,
  capture: CaptureRecord | undefined,
  kills: number,
): string {
  if (startingRole === "hunter") {
    return kills > 0 ? `You caught ${propsPhrase(kills)}` : "You caught nobody this round";
  }
  if (!capture) return "You survived the hunt";
  const caught = `Caught by ${capture.byName} after ${formatSpan(capture.atMs)}`;
  return kills > 0 ? `${caught}, then caught ${propsPhrase(kills)}` : caught;
}

/** A standings row's result on the round-end card, told by the role the player started with. */
export function resultStatus(
  startingRole: Role,
  capture: CaptureRecord | undefined,
  alive: boolean,
): string {
  if (startingRole === "hunter") return alive ? "-" : "Out of HP";
  return capture ? `Caught ${formatSpan(capture.atMs)}` : "Survived";
}
