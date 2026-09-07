import { BOT_NAMES } from "@morphy/bot/brain";
import { BOT_FILL_TARGET } from "@morphy/shared";

const BOT_ID_PREFIX = "bot:";
const FALLBACK_BOT_NAME = "Drone";

/** Server-driven bots take a session id no Colyseus client can mint. */
export function botSessionId(seq: number): string {
  return `${BOT_ID_PREFIX}${seq}`;
}

export function isBotSessionId(sessionId: string): boolean {
  return sessionId.startsWith(BOT_ID_PREFIX);
}

export function botName(seq: number): string {
  const pool = BOT_NAMES[(seq - 1) % BOT_NAMES.length] ?? FALLBACK_BOT_NAME;
  return `${pool}·bot`;
}

/**
 * How many bots a public lobby should hold. Bots pad a quiet room up to
 * {@link BOT_FILL_TARGET} presences and give their seat back as humans arrive,
 * so they never take a slot a player wants nor make the room look fuller than
 * it is to the matchmaker. An empty room gets none: bots exist to give a
 * present player someone to hunt, not to keep a deserted room busy.
 */
export function desiredBotCount(humans: number): number {
  if (humans === 0) return 0;
  return Math.max(0, BOT_FILL_TARGET - humans);
}
