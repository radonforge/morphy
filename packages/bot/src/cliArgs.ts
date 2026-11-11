import {
  DEFAULT_MAP_ID,
  isMapId,
  isPartyCode,
  MAP_CATALOG,
  type MapId,
  normalizePartyCode,
  PARTY_CODE_LENGTH,
  type Visibility,
} from "@morphy/shared";
import {
  clampDifficulty,
  DEFAULT_BOT_COUNT,
  DEFAULT_DIFFICULTY,
  defaultServerUrl,
  isLoopbackServerUrl,
} from "./config";

export type PolicyKind = "scripted";

export interface CliArgs {
  count: number;
  url: string;
  map: MapId;
  code: string | null;
  difficulty: number;
  namePrefix: string | null;
  readyAtPlayers: number | null;
  policy: PolicyKind;
  visibility: Visibility;
  trace: string | null;
}

function parsePolicy(value: string): PolicyKind {
  if (value === "scripted") return value;
  throw new Error(`unknown --policy '${value}' (supported: scripted)`);
}

function parseMap(value: string): MapId {
  if (isMapId(value)) return value;
  throw new Error(
    `unknown --map '${value}' (supported: ${MAP_CATALOG.map((m) => m.id).join(", ")})`,
  );
}

function parseCode(value: string): string {
  const code = normalizePartyCode(value);
  if (isPartyCode(code)) return code;
  throw new Error(`invalid --code '${value}' (expected ${PARTY_CODE_LENGTH} characters)`);
}

function parseVisibility(value: string): Visibility {
  if (value === "full" || value === "limited") return value;
  throw new Error(`unknown --visibility '${value}' (supported: full, limited)`);
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    count: DEFAULT_BOT_COUNT,
    url: defaultServerUrl(),
    map: DEFAULT_MAP_ID,
    code: null,
    difficulty: DEFAULT_DIFFICULTY,
    namePrefix: null,
    readyAtPlayers: null,
    policy: "scripted",
    visibility: "limited",
    trace: null,
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
      case "--map":
      case "-m":
        if (value) {
          args.map = parseMap(value);
          i++;
        }
        break;
      case "--code":
        if (value) {
          args.code = parseCode(value);
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
      case "--policy":
        if (value) {
          args.policy = parsePolicy(value);
          i++;
        }
        break;
      case "--visibility":
        if (value) {
          args.visibility = parseVisibility(value);
          i++;
        }
        break;
      case "--trace":
        if (value) {
          args.trace = value;
          i++;
        }
        break;
      default:
        break;
    }
  }
  if (args.visibility === "full" && !isLoopbackServerUrl(args.url)) {
    throw new Error(
      `--visibility full reads ground truth and only runs against a local server; refused for ${args.url}`,
    );
  }
  return args;
}
