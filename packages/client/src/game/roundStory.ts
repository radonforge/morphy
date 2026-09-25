import type { Phase, Role } from "@morphy/shared";

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
