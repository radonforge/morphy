import type { Intent, Observation } from "@morphy/shared";

/**
 * A pluggable brain. `decide` is async and low-frequency: it returns a
 * declarative {@link Intent} for the bot's synchronous reflex to execute. The
 * `signal` aborts a decision the scheduler has given up waiting on. Fase 1 ships
 * {@link ScriptedPolicy}; Fase 2/3 add Claude- and local-LLM-backed policies
 * behind this same seam.
 */
export interface Policy {
  readonly name: string;
  decide(obs: Observation, signal: AbortSignal): Promise<Intent>;
}
