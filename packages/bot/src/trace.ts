import { createWriteStream, type WriteStream } from "node:fs";
import type { Intent, Observation } from "@webhunt/shared";

interface KillFields {
  byId: string;
  victimId: string;
  reason: string;
}

/**
 * Opt-in JSONL recorder, one file per bot (no interleaving). Writes one line per
 * *applied* decision — `{t,botName,policy,seq,phase,visibility,obs,intent}` —
 * plus terminal `kill`/`round_end` events. Together they form the
 * `(observation, intent, return)` episodes the future training pipeline needs;
 * Fase 1 only captures the data. The stream is append-mode and closed on
 * {@link Bot.stop} / SIGINT.
 */
export class Trace {
  private readonly stream: WriteStream;
  private closed = false;

  constructor(
    path: string,
    private readonly botName: string,
  ) {
    this.stream = createWriteStream(path, { flags: "a", encoding: "utf8" });
    this.stream.on("error", (error) => {
      this.closed = true;
      console.error(`[trace ${this.botName}] write error, tracing stopped — ${error.message}`);
    });
  }

  recordDecision(policy: string, obs: Observation, intent: Intent, now: number): void {
    this.write({
      t: now,
      botName: this.botName,
      policy,
      seq: intent.seq,
      phase: obs.phase,
      visibility: obs.visibility,
      obs,
      intent,
    });
  }

  recordKill(kill: KillFields, now: number): void {
    this.write({ t: now, botName: this.botName, event: "kill", ...kill });
  }

  recordRoundEnd(winner: string, now: number): void {
    this.write({ t: now, botName: this.botName, event: "round_end", winner });
  }

  private write(line: unknown): void {
    if (this.closed) return;
    this.stream.write(`${JSON.stringify(line)}\n`);
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.closed) {
        resolve();
        return;
      }
      this.closed = true;
      this.stream.end(resolve);
    });
  }
}
