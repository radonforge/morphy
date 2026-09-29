import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  addLight,
  addRoom,
  type CellRect,
  duplicateObject,
  formatFinding,
  formatLevelDocument,
  formatReport,
  formatReportDelta,
  type LevelContext,
  type LevelDocument,
  LevelValidationError,
  listLights,
  listObjects,
  moveLight,
  moveObject,
  type OpResult,
  type Placement,
  parseLevelDocument,
  placeObject,
  planRoom,
  proposeLights,
  removeLight,
  removeObject,
  removeRoom,
  reportForRoom,
  resizeRoom,
  rotateObject,
  SIDES,
  type Side,
  summarizeLevel,
  toggleDoor,
  validateLevel,
} from "../../packages/level/src/index";
import { SPACE_CATALOG } from "../../packages/server/src/spaceCatalog";
import {
  ASSET_CARDS,
  ASSET_TAGS,
  isMapId,
  type MapId,
  type PropDefinition,
} from "../../packages/shared/src/index";

const DEFAULT_FILE = fileURLToPath(
  new URL("../../packages/server/src/maps/station.level.json", import.meta.url),
);
const CATALOGS: Partial<Record<MapId, readonly PropDefinition[]>> = { station: SPACE_CATALOG };
const EXIT_INVALID = 1;
const EXIT_USAGE = 2;

const USAGE = `usage: pnpm level <command> [--file <level.json>] [--help]
  view [room]                     summary, or an ASCII plan of one room
  list [room]                     one line per object
  check [room]                    findings and metrics; exits 1 when any finding is an error
  place <type> --at x,z | --center room | --wall room:N|S|E|W | --next-to id:N|S|E|W
               | --row room:x|z:count:gap   [--id id] [--yaw degrees] [--free]
  move <id> --to x,z | --by dx,dz [--free]
  rotate <id> [--turns n | --degrees d]
  remove <id>
  duplicate <id> [--side N|S|E|W] [--id new-id] [--free]
  light list
  light add --at x,z [--kind room|corridor] [--id id] [--free]
  light move <id> --to x,z | --by dx,dz [--free]
  light remove <id>
  light propose [--rooms n]       replace the lights with the pickDeckLights proposal
  room add <id> i0,i1,j0,j1
  room resize <id> i0,i1,j0,j1 [--rect n]
  room remove <id>
  door toggle v|h:line:cell
negative values need the = form: --by=-0.5,0
exit codes: 0 done, 1 refused edit, error finding or unusable document, 2 bad command line`;

/** The flags each command takes, besides \`--file\` and \`--help\`. */
const COMMAND_FLAGS: Readonly<Record<string, readonly string[]>> = {
  view: [],
  list: [],
  check: [],
  place: ["at", "center", "wall", "next-to", "row", "id", "yaw", "free"],
  move: ["to", "by", "free"],
  rotate: ["turns", "degrees"],
  remove: [],
  duplicate: ["side", "id", "free"],
  room: ["rect"],
  door: [],
  light: ["at", "kind", "id", "to", "by", "free", "rooms"],
};
const GLOBAL_FLAGS = ["file", "help"];
const DOOR_PARTS = ["axis", "line", "cell"];

/** Bad command-line input: printed with the usage and a non-zero exit. */
class UsageError extends Error {}

/** The document file changed under an edit; nothing was written. */
class ConflictError extends Error {}

/** The document file is missing, unreadable, not JSON or not a valid level. */
class DocumentError extends Error {}

function numbers(text: string | undefined, count: number, what: string): number[] {
  const tokens = (text ?? "").split(",");
  const parts = tokens.map(Number);
  if (
    parts.length !== count ||
    tokens.some((token) => token.trim() === "") ||
    !parts.every(Number.isFinite)
  ) {
    throw new UsageError(
      `${what} needs ${count} comma-separated numbers, got ${JSON.stringify(text)}`,
    );
  }
  return parts;
}

function side(text: string | undefined, what: string): Side {
  if (!SIDES.includes(text as Side))
    throw new UsageError(`${what} side must be one of ${SIDES.join(", ")}`);
  return text as Side;
}

function required(value: string | undefined, what: string): string {
  if (value === undefined || value === "") throw new UsageError(`missing ${what}`);
  return value;
}

function cellRect(text: string | undefined): CellRect {
  const [i0, i1, j0, j1] = numbers(text, 4, "a rect");
  return { i0: i0!, i1: i1!, j0: j0!, j1: j1! };
}

function placement(values: Record<string, string | boolean | undefined>): Placement {
  const given = ["at", "center", "wall", "next-to", "row"].filter(
    (key) => values[key] !== undefined,
  );
  if (given.length !== 1) {
    throw new UsageError("place needs exactly one of --at, --center, --wall, --next-to, --row");
  }
  const text = values[given[0]!] as string;
  switch (given[0]) {
    case "at": {
      const [x, z] = numbers(text, 2, "--at");
      return { at: { x: x!, z: z! } };
    }
    case "center":
      return { center: text };
    case "wall": {
      const [room, wall] = text.split(":");
      return {
        againstWall: { room: required(room, "--wall room"), side: side(wall, "--wall") },
        facing: "in",
      };
    }
    case "next-to": {
      const [id, at] = text.split(":");
      return { nextTo: required(id, "--next-to object id"), side: side(at, "--next-to") };
    }
    default: {
      const [room, along, count, gap] = text.split(":");
      if (along !== "x" && along !== "z") throw new UsageError("--row axis must be x or z");
      return {
        row: {
          room: required(room, "--row room"),
          along,
          count: numbers(count, 1, "--row count")[0]!,
          gap: numbers(gap, 1, "--row gap")[0]!,
        },
      };
    }
  }
}

function load(file: string): { text: string; doc: LevelDocument; context: LevelContext } {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    const code = (error as { code?: unknown }).code ?? "unreadable";
    throw new DocumentError(
      `cannot read ${file} (${String(code)}); pass --file with the path of a level document`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new DocumentError(
      `${file} is not valid JSON (${(error as Error).message}); fix the syntax or restore it with git`,
    );
  }
  const id = typeof raw === "object" && raw !== null ? (raw as { id?: unknown }).id : undefined;
  const catalog = isMapId(id) ? CATALOGS[id] : undefined;
  if (catalog === undefined) {
    throw new DocumentError(
      `${file} has id ${JSON.stringify(id)}, which has no level catalog; the CLI edits ${Object.keys(CATALOGS).join(", ")} documents`,
    );
  }
  const context = { catalog, cards: ASSET_CARDS, tags: ASSET_TAGS };
  try {
    return { text, doc: parseLevelDocument(raw, { catalog, id: id as MapId }), context };
  } catch (error) {
    if (error instanceof LevelValidationError) throw new DocumentError(`${file}: ${error.message}`);
    throw error;
  }
}

/**
 * Replace the document file atomically, refusing when it changed since `base` was
 * read, so a concurrent edit is reported instead of silently overwritten.
 */
function write(
  file: string,
  base: string,
  doc: LevelDocument,
  context: LevelContext,
): LevelDocument {
  const text = formatLevelDocument(doc);
  const checked = parseLevelDocument(JSON.parse(text), { catalog: context.catalog, id: doc.id });
  if (readFileSync(file, "utf8") !== base) {
    throw new ConflictError(
      `${file} changed while this edit ran; nothing was written, run it again`,
    );
  }
  const temp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, text, "utf8");
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
  return checked;
}

function lightEdit(
  action: string | undefined,
  id: string | undefined,
  values: Record<string, string | boolean | undefined>,
  doc: LevelDocument,
): OpResult {
  const free = values.free === true;
  switch (action) {
    case "add": {
      const kind = values.kind ?? "room";
      if (kind !== "room" && kind !== "corridor") {
        throw new UsageError("--kind must be room or corridor");
      }
      const [x, z] = numbers(values.at as string | undefined, 2, "--at");
      return addLight(doc, {
        at: { x: x!, z: z! },
        kind,
        free,
        ...(values.id !== undefined ? { id: values.id as string } : {}),
      });
    }
    case "move": {
      const given = ["to", "by"].filter((k) => values[k] !== undefined);
      const [key] = given;
      if (key === undefined || given.length > 1) {
        throw new UsageError("light move needs exactly one of --to x,z or --by dx,dz");
      }
      const [x, z] = numbers(values[key] as string, 2, `--${key}`);
      return moveLight(doc, { id: required(id, "light id"), [key]: { x: x!, z: z! }, free });
    }
    case "remove":
      return removeLight(doc, { id: required(id, "light id") });
    case "propose":
      return proposeLights(doc, {
        ...(values.rooms !== undefined
          ? { roomCount: numbers(values.rooms as string, 1, "--rooms")[0]! }
          : {}),
      });
    default:
      throw new UsageError("light needs list, add, move, remove or propose");
  }
}

function edit(
  args: string[],
  values: Record<string, string | boolean | undefined>,
  doc: LevelDocument,
  context: LevelContext,
): OpResult {
  const [command, first, second] = args;
  const free = values.free === true;
  switch (command) {
    case "place":
      return placeObject(
        doc,
        {
          type: required(first, "object type"),
          relation: placement(values),
          free,
          ...(values.id !== undefined ? { id: values.id as string } : {}),
          ...(values.yaw !== undefined
            ? { yawDegrees: numbers(values.yaw as string, 1, "--yaw")[0]! }
            : {}),
        },
        context,
      );
    case "move": {
      const given = ["to", "by"].filter((k) => values[k] !== undefined);
      const [key] = given;
      if (key === undefined || given.length > 1) {
        throw new UsageError("move needs exactly one of --to x,z or --by dx,dz");
      }
      const [x, z] = numbers(values[key] as string, 2, `--${key}`);
      return moveObject(
        doc,
        { id: required(first, "object id"), [key]: { x: x!, z: z! }, free },
        context,
      );
    }
    case "rotate":
      return rotateObject(
        doc,
        {
          id: required(first, "object id"),
          ...(values.turns !== undefined
            ? { turns: numbers(values.turns as string, 1, "--turns")[0]! }
            : {}),
          ...(values.degrees !== undefined
            ? { degrees: numbers(values.degrees as string, 1, "--degrees")[0]! }
            : {}),
        },
        context,
      );
    case "remove":
      return removeObject(doc, { id: required(first, "object id") });
    case "duplicate":
      return duplicateObject(
        doc,
        {
          id: required(first, "object id"),
          ...(values.side !== undefined ? { side: side(values.side as string, "--side") } : {}),
          ...(values.id !== undefined ? { newId: values.id as string } : {}),
          free,
        },
        context,
      );
    case "light":
      return lightEdit(first, second, values, doc);
    case "room": {
      const id = required(second, "room id");
      if (first === "add") return addRoom(doc, { id, rect: cellRect(args[3]) });
      if (first === "remove") return removeRoom(doc, { id });
      if (first === "resize") {
        const index =
          values.rect === undefined ? 0 : numbers(values.rect as string, 1, "--rect")[0]!;
        return resizeRoom(doc, { id, rect: cellRect(args[3]), index });
      }
      throw new UsageError("room needs add, resize or remove");
    }
    case "door": {
      if (first !== "toggle") throw new UsageError("door needs toggle");
      const parts = required(second, "door as v|h:line:cell").split(":");
      const missing = DOOR_PARTS.filter((_, k) => (parts[k] ?? "") === "");
      if (missing.length > 0 || parts.length > DOOR_PARTS.length) {
        throw new UsageError(
          `door needs v|h:line:cell, ${missing.length > 0 ? `missing ${missing.join(" and ")}` : "got extra parts"} in ${JSON.stringify(second)}`,
        );
      }
      const [axis, line, cell] = parts;
      if (axis !== "v" && axis !== "h") throw new UsageError("door axis must be v or h");
      const [l, c] = numbers(`${line},${cell}`, 2, "door line and cell");
      return toggleDoor(doc, { axis, line: l!, cell: c! });
    }
    default:
      throw new UsageError(`unknown command ${JSON.stringify(command)}`);
  }
}

function run(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      file: { type: "string" },
      at: { type: "string" },
      center: { type: "string" },
      wall: { type: "string" },
      "next-to": { type: "string" },
      row: { type: "string" },
      id: { type: "string" },
      yaw: { type: "string" },
      free: { type: "boolean" },
      to: { type: "string" },
      by: { type: "string" },
      turns: { type: "string" },
      degrees: { type: "string" },
      side: { type: "string" },
      rect: { type: "string" },
      kind: { type: "string" },
      rooms: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, room] = positionals;
  if (values.help === true || command === "help") {
    console.log(USAGE);
    return 0;
  }
  if (command === undefined) throw new UsageError("missing command");
  const allowed = COMMAND_FLAGS[command];
  if (allowed === undefined) throw new UsageError(`unknown command ${JSON.stringify(command)}`);
  const stray = Object.keys(values).filter(
    (flag) => !GLOBAL_FLAGS.includes(flag) && !allowed.includes(flag),
  );
  if (stray.length > 0) {
    throw new UsageError(
      `${command} does not take ${stray.map((flag) => `--${flag}`).join(", ")}${allowed.length > 0 ? `; it takes ${allowed.map((flag) => `--${flag}`).join(", ")}` : ""}`,
    );
  }
  const file = values.file ?? DEFAULT_FILE;
  const { text, doc, context } = load(file);
  const hasRoom = (id: string | undefined): string | undefined => {
    if (id !== undefined && !doc.rooms.some((entry) => entry.id === id)) {
      throw new UsageError(
        `no room "${id}"; rooms: ${doc.rooms.map((entry) => entry.id).join(", ")}`,
      );
    }
    return id;
  };
  if (command === "light" && positionals[1] === "list") {
    console.log(listLights(doc, context));
    return 0;
  }
  switch (command) {
    case "view": {
      const id = hasRoom(room);
      console.log(id === undefined ? summarizeLevel(doc, context) : planRoom(doc, context, id));
      return 0;
    }
    case "list":
      console.log(listObjects(doc, context, hasRoom(room)));
      return 0;
    case "check": {
      const id = hasRoom(room);
      const full = validateLevel(doc, context);
      const report = id === undefined ? full : reportForRoom(full, doc, context, id);
      console.log(formatReport(report));
      return report.findings.some((finding) => finding.severity === "error") ? EXIT_INVALID : 0;
    }
  }
  const before = validateLevel(doc, context);
  const result = edit(positionals, values, doc, context);
  for (const finding of result.findings) console.log(formatFinding(finding));
  if (!result.ok) return EXIT_INVALID;
  const written = write(file, text, result.doc, context);
  console.log(`wrote ${relative(process.cwd(), file)}`);
  console.log(formatReportDelta(before, validateLevel(written, context)));
  return 0;
}

function isParseArgsError(error: unknown): boolean {
  const code = error instanceof TypeError ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS");
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError || isParseArgsError(error)) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    process.exitCode = EXIT_USAGE;
  } else if (
    error instanceof DocumentError ||
    error instanceof ConflictError ||
    error instanceof LevelValidationError
  ) {
    console.error(error.message);
    process.exitCode = EXIT_INVALID;
  } else {
    throw error;
  }
}
