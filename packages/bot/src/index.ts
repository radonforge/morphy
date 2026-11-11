import { mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";
import { MAX_NAME_LENGTH } from "@morphy/shared";
import { Bot } from "./bot";
import { type CliArgs, type PolicyKind, parseArgs } from "./cliArgs";
import { BOT_NAMES } from "./config";
import { ScriptedPolicy } from "./policy/scripted";
import type { Policy } from "./policy/types";
import { Trace } from "./trace";

function botName(prefix: string | null, index: number): string {
  if (prefix) return `${prefix}${index + 1}`.slice(0, MAX_NAME_LENGTH);
  const base = BOT_NAMES[index % BOT_NAMES.length] ?? `Bot${index + 1}`;
  const wrap = Math.floor(index / BOT_NAMES.length);
  const name = wrap > 0 ? `${base}${wrap + 1}` : base;
  return name.slice(0, MAX_NAME_LENGTH);
}

function createPolicy(kind: PolicyKind, difficulty: number): Policy {
  switch (kind) {
    case "scripted":
      return new ScriptedPolicy(difficulty);
  }
}

/** Per-bot trace file derived from the `--trace` base path, so streams never interleave. */
function traceFileFor(base: string, name: string): string {
  const ext = extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  return `${stem}.${name}${ext || ".jsonl"}`;
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[bot] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const readyAtPlayers = args.readyAtPlayers ?? args.count + 1;
  if (args.trace) mkdirSync(dirname(traceFileFor(args.trace, "x")), { recursive: true });
  console.log(
    `[bot] spawning ${args.count} bot(s) → ${args.url} · ` +
      (args.code ? `party ${args.code}` : `map ${args.map}`) +
      ` · policy ${args.policy} · ` +
      `visibility ${args.visibility} · difficulty ${args.difficulty} · ready when ${readyAtPlayers} player(s) present` +
      (args.trace ? ` · tracing to ${args.trace}` : ""),
  );

  const bots: Bot[] = [];
  for (let i = 0; i < args.count; i++) {
    const name = botName(args.namePrefix, i);
    const bot = new Bot({
      serverUrl: args.url,
      name,
      map: args.map,
      code: args.code,
      difficulty: args.difficulty,
      readyAtPlayers,
      policy: createPolicy(args.policy, args.difficulty),
      visibility: args.visibility,
      trace: args.trace ? new Trace(traceFileFor(args.trace, name), name) : null,
    });
    try {
      await bot.connect();
      bots.push(bot);
      console.log(`[bot] ${name} connected`);
    } catch (error) {
      console.error(
        `[bot] ${name} failed to connect: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (bots.length === 0) {
    console.error("[bot] no bots connected. Is the server running?");
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n[bot] shutting down…");
    void Promise.allSettled(bots.map((bot) => bot.stop())).then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
