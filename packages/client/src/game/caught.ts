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

/** Whether the "you hunt now" call follows the card: only when the capture ended mid-hunt. */
export function announcesHunt(phaseAtEnd: string): boolean {
  return phaseAtEnd === "hunting";
}
