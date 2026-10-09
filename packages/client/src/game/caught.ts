import type { KillEvent } from "@morphy/shared";

/** What the local player's capture shows: who got them, and when it landed. */
export interface LocalCapture {
  byId: string;
  byName: string;
  at: number;
}

/** Copy of the card a caught prop sees while the camera pulls back to the hunter. */
export const CAUGHT_CARD_COPY = {
  title: "Caught",
  hunterNow: "You're a hunter now",
} as const;

/** Copy over the kill cam: what is playing, and the key that skips it. */
export const KILL_CAM_COPY = {
  title: "Kill cam",
  skip: "Space to skip",
} as const;

/** The key that skips the kill cam to the caught card. */
export const KILL_CAM_SKIP_CODE = "Space";

/** Whose eyes the kill cam replays the capture through. */
export function killCamViewLine(byName: string): string {
  return byName === "" ? "The hunter's view" : `${byName}'s view`;
}

/** The line under the title, naming the hunter who got the local player. */
export function caughtByLine(byName: string): string {
  return byName === "" ? "" : `by ${byName}`;
}

/**
 * The local player's capture in a kill event, or null when the event is anything else:
 * a self-kill, a shot, or a capture of someone other than the local player.
 */
export function localCaptureOf(
  event: KillEvent,
  sessionId: string,
  now: number,
): LocalCapture | null {
  if (event.reason !== "converted" || event.victimId !== sessionId) return null;
  return { byId: event.byId, byName: event.byName, at: now };
}

/**
 * Whether a capture leaves props in play, i.e. the hunt goes on. The kill cam plays only
 * then: a capture of the last prop ends the round, and the result card owns that moment.
 */
export function huntGoesOn(
  players: Iterable<readonly [string, { role: string; alive: boolean }]>,
  victimId: string,
): boolean {
  for (const [id, player] of players) {
    if (id !== victimId && player.role === "prop" && player.alive) return true;
  }
  return false;
}

/** Whether the "you hunt now" call follows the card: only when the capture ended mid-hunt. */
export function announcesHunt(phaseAtEnd: string): boolean {
  return phaseAtEnd === "hunting";
}
