import type { Intent, Observation } from "@morphy/shared";

/**
 * A pluggable brain. `decide` is async and low-frequency: it returns a
 * declarative {@link Intent} for the bot's synchronous reflex to execute. The
 * `signal` aborts a decision the scheduler has given up waiting on.
 *
 * `ScriptedPolicy` is the only implementation, and by decision it is the only
 * one planned: the game is multiplayer-first and bots exist to fill a thin
 * room, not to be played with. The seam stays because the reflex needs
 * something to ask — see the scope note in `AGENTS.md` before adding another.
 */
export interface Policy {
  readonly name: string;
  decide(obs: Observation, signal: AbortSignal): Promise<Intent>;
}
