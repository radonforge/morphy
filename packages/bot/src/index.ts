import { MAX_NAME_LENGTH } from "@webhunt/shared";
import { Bot } from "./bot";
import {
  BOT_NAMES,
  DEFAULT_BOT_COUNT,
  DEFAULT_DIFFICULTY,
  clampDifficulty,
  defaultServerUrl,
} from "./config";

interface CliArgs {
  count: number;
  url: string;
  difficulty: number;
  namePrefix: string | null;
  readyAtPlayers: number | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    count: DEFAULT_BOT_COUNT,
    url: defaultServerUrl(),
    difficulty: DEFAULT_DIFFICULTY,
    namePrefix: null,
    readyAtPlayers: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--count":
      case "-n":
        if (value) {
          args.count = Math.max(1, Math.floor(Number(value)));
          i++;
        }
        break;
      case "--url":
        if (value) {
          args.url = value;
          i++;
        }
        break;
      case "--difficulty":
      case "-d":
        if (value) {
          args.difficulty = clampDifficulty(Number(value));
          i++;
        }
        break;
      case "--name":
        if (value) {
          args.namePrefix = value;
          i++;
        }
        break;
      case "--ready-at":
        if (value) {
          args.readyAtPlayers = Math.max(1, Math.floor(Number(value)));
          i++;
        }
        break;
      default:
        break;
    }
  }
  return args;
}

function botName(prefix: string | null, index: number): string {
  if (prefix) return `${prefix}${index + 1}`.slice(0, MAX_NAME_LENGTH);
  const base = BOT_NAMES[index % BOT_NAMES.length] ?? `Bot${index + 1}`;
  const wrap = Math.floor(index / BOT_NAMES.length);
  const name = wrap > 0 ? `${base}${wrap + 1}` : base;
  return name.slice(0, MAX_NAME_LENGTH);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const readyAtPlayers = args.readyAtPlayers ?? args.count + 1;
  console.log(
    `[bot] spawning ${args.count} bot(s) → ${args.url} · difficulty ${args.difficulty} · ` +
      `ready when ${readyAtPlayers} player(s) present`,
  );

  const bots: Bot[] = [];
  for (let i = 0; i < args.count; i++) {
    const name = botName(args.namePrefix, i);
    const bot = new Bot({ serverUrl: args.url, name, difficulty: args.difficulty, readyAtPlayers });
    try {
      await bot.connect();
      bots.push(bot);
      console.log(`[bot] ${name} connected`);
    } catch (error) {
      console.error(`[bot] ${name} failed to connect: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (bots.length === 0) {
    console.error("[bot] no bots connected — is the server running?");
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
