import { isMapId, type MapId, type PropDefinition } from "@morphy/shared";
import { TILE } from "./floorplan";

/** Half-open cell range: columns [i0, i1), rows [j0, j1). */
export interface CellRect {
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

/** A named region of floor cells; its walls fall on every edge it shares with another region. */
export interface LevelRoom {
  id: string;
  rects: CellRect[];
}

/** A wall gap: `axis: "v"` on vertical grid line `line` at row `cell`; `"h"` on horizontal line `line` at column `cell`. */
export interface LevelDoor {
  axis: "v" | "h";
  line: number;
  cell: number;
}

/** A placed catalog prop. `yaw` in radians about +Y (editor and CLI write multiples of PI/2). */
export interface LevelObject {
  id: string;
  type: string;
  x: number;
  z: number;
  yaw: number;
}

export interface LevelPoint {
  x: number;
  z: number;
}

/**
 * A hand-authored map as a document of intents: a grid of rooms, the doors
 * between them, placed objects and spawn points. {@link compileLevel} turns it
 * into a `MapDefinition`; object positions are fixed, a seed only varies tiles.
 */
export interface LevelDocument {
  version: 1;
  id: MapId;
  grid: { cols: number; rows: number };
  rooms: LevelRoom[];
  doors: LevelDoor[];
  objects: LevelObject[];
  spawns: { props: LevelPoint[]; hunters: LevelPoint[] };
}

const LEVEL_DOCUMENT_VERSION = 1;
const MAX_GRID_SIDE = 128;

/** A level document failed validation; names the document, the offending entity and a fix. */
export class LevelValidationError extends Error {
  readonly documentId: string;
  readonly entityId: string;
  readonly hint: string;

  constructor(documentId: string, entityId: string, detail: string, hint: string) {
    super(`invalid level "${documentId}", ${entityId}: ${detail}. Fix: ${hint}`);
    this.name = "LevelValidationError";
    this.documentId = documentId;
    this.entityId = entityId;
    this.hint = hint;
  }
}

/** What a document is checked against: the prop catalog its objects must come from. */
export interface LevelParseOptions {
  catalog: readonly PropDefinition[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function doorKey(door: LevelDoor): string {
  return `${door.axis}:${door.line}:${door.cell}`;
}

/**
 * Parse and validate a level document read from a file or sent by a tool.
 * Checks shape, that rects stay on the grid and different rooms never overlap
 * (rects of one room may), that ids are unique, that every object type is in
 * `catalog`, that every door sits on an inner edge between two different
 * regions (open ground counts as one) and that
 * objects and spawns lie inside the map. Throws {@link LevelValidationError}.
 */
export function parseLevelDocument(input: unknown, options: LevelParseOptions): LevelDocument {
  const docId = isRecord(input) && isNonEmptyString(input.id) ? input.id : "?";
  const fail = (entity: string, detail: string, hint: string): never => {
    throw new LevelValidationError(docId, entity, detail, hint);
  };

  if (!isRecord(input)) return fail("document", "root is not an object", "write a JSON object");
  if (!isMapId(input.id)) {
    return fail("document", `id ${JSON.stringify(input.id)} is not a map id`, "use a MapId");
  }
  const id = input.id;
  if (input.version !== LEVEL_DOCUMENT_VERSION) {
    return fail(
      "document",
      `version ${JSON.stringify(input.version)} is not supported`,
      `set "version": ${LEVEL_DOCUMENT_VERSION}`,
    );
  }

  const grid = input.grid;
  if (
    !isRecord(grid) ||
    !Number.isInteger(grid.cols) ||
    !Number.isInteger(grid.rows) ||
    (grid.cols as number) < 1 ||
    (grid.rows as number) < 1 ||
    (grid.cols as number) > MAX_GRID_SIDE ||
    (grid.rows as number) > MAX_GRID_SIDE
  ) {
    return fail(
      "grid",
      `cols and rows must be integers from 1 to ${MAX_GRID_SIDE}`,
      'write "grid": { cols, rows }',
    );
  }
  const cols = grid.cols as number;
  const rows = grid.rows as number;
  const halfW = (cols * TILE) / 2;
  const halfD = (rows * TILE) / 2;

  if (!Array.isArray(input.rooms) || input.rooms.length === 0) {
    return fail("rooms", "must be a non-empty array", "add at least one room");
  }
  const owner: (string | null)[][] = Array.from({ length: cols }, () =>
    new Array<string | null>(rows).fill(null),
  );
  const rooms: LevelRoom[] = [];
  for (const [index, raw] of input.rooms.entries()) {
    if (!isRecord(raw) || !isNonEmptyString(raw.id)) {
      return fail(`rooms[${index}]`, "missing string id", "give the room a non-empty id");
    }
    const roomId = raw.id;
    const entity = `room "${roomId}"`;
    if (rooms.some((room) => room.id === roomId)) {
      return fail(entity, "id is used by another room", "rename one of the two rooms");
    }
    if (!Array.isArray(raw.rects) || raw.rects.length === 0) {
      return fail(entity, "rects must be a non-empty array", "give the room at least one rect");
    }
    const rects: CellRect[] = [];
    for (const rect of raw.rects) {
      const edges = isRecord(rect) ? [rect.i0, rect.i1, rect.j0, rect.j1] : [];
      if (edges.length !== 4 || !edges.every(Number.isInteger)) {
        return fail(entity, "rect needs integer i0, i1, j0, j1", "write whole cell indices");
      }
      const [i0, i1, j0, j1] = edges as [number, number, number, number];
      if (i0 < 0 || i1 > cols || i0 >= i1 || j0 < 0 || j1 > rows || j0 >= j1) {
        return fail(
          entity,
          `rect i ${i0}..${i1}, j ${j0}..${j1} is empty or off the ${cols}x${rows} grid`,
          `keep 0 <= i0 < i1 <= ${cols} and 0 <= j0 < j1 <= ${rows}`,
        );
      }
      for (let i = i0; i < i1; i++) {
        for (let j = j0; j < j1; j++) {
          const other = owner[i]![j];
          if (other !== null && other !== roomId) {
            return fail(
              entity,
              `cell (${i},${j}) is already in room "${other}"`,
              "shrink one of the two rects so rooms do not overlap",
            );
          }
          owner[i]![j] = roomId;
        }
      }
      rects.push({ i0, i1, j0, j1 });
    }
    rooms.push({ id: roomId, rects });
  }

  const regionAt = (i: number, j: number): string | null =>
    i >= 0 && i < cols && j >= 0 && j < rows ? owner[i]![j]! : null;

  if (!Array.isArray(input.doors)) return fail("doors", "must be an array", 'write "doors": []');
  const doors: LevelDoor[] = [];
  const doorKeys = new Set<string>();
  for (const [index, raw] of input.doors.entries()) {
    if (
      !isRecord(raw) ||
      (raw.axis !== "v" && raw.axis !== "h") ||
      !Number.isInteger(raw.line) ||
      !Number.isInteger(raw.cell)
    ) {
      return fail(`doors[${index}]`, "needs axis v|h and integer line, cell", "fix the door");
    }
    const door: LevelDoor = { axis: raw.axis, line: raw.line as number, cell: raw.cell as number };
    const entity = `door ${doorKey(door)}`;
    const [lines, cells] = door.axis === "v" ? [cols, rows] : [rows, cols];
    if (door.line <= 0 || door.line >= lines || door.cell < 0 || door.cell >= cells) {
      return fail(
        entity,
        "lies on the grid border or off the grid, so it would open the map's outer wall",
        `keep 0 < line < ${lines} and 0 <= cell < ${cells}`,
      );
    }
    if (doorKeys.has(doorKey(door))) return fail(entity, "is listed twice", "remove the duplicate");
    const [a, b] =
      door.axis === "v"
        ? [regionAt(door.line - 1, door.cell), regionAt(door.line, door.cell)]
        : [regionAt(door.cell, door.line - 1), regionAt(door.cell, door.line)];
    if (a === b) {
      return fail(
        entity,
        `both sides are ${a === null ? "open ground" : `room "${a}"`}, so there is no wall`,
        "move the door onto an edge between two different regions",
      );
    }
    doorKeys.add(doorKey(door));
    doors.push(door);
  }

  const inside = (x: number, z: number): boolean =>
    x >= -halfW && x <= halfW && z >= -halfD && z <= halfD;
  const bounds = `x in [${-halfW}, ${halfW}], z in [${-halfD}, ${halfD}]`;

  if (!Array.isArray(input.objects)) {
    return fail("objects", "must be an array", 'write "objects": []');
  }
  const catalogIds = new Set(options.catalog.map((definition) => definition.id));
  const objects: LevelObject[] = [];
  const objectIds = new Set<string>();
  for (const [index, raw] of input.objects.entries()) {
    if (!isRecord(raw) || !isNonEmptyString(raw.id)) {
      return fail(`objects[${index}]`, "missing string id", "give the object a non-empty id");
    }
    const entity = `object "${raw.id}"`;
    if (objectIds.has(raw.id)) {
      return fail(entity, "id is used by another object", "give each object its own id");
    }
    if (typeof raw.type !== "string" || !catalogIds.has(raw.type)) {
      return fail(
        entity,
        `type ${JSON.stringify(raw.type)} is not in the prop catalog`,
        "use one of the catalog ids",
      );
    }
    if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.z) || !isFiniteNumber(raw.yaw)) {
      return fail(entity, "x, z and yaw must be finite numbers", "write numeric coordinates");
    }
    if (!inside(raw.x, raw.z)) {
      return fail(entity, `(${raw.x}, ${raw.z}) is outside the map`, `keep ${bounds}`);
    }
    objectIds.add(raw.id);
    objects.push({ id: raw.id, type: raw.type, x: raw.x, z: raw.z, yaw: raw.yaw });
  }

  const spawns = input.spawns;
  if (!isRecord(spawns)) {
    return fail("spawns", "must be an object", 'write "spawns": { props, hunters }');
  }
  const points = (key: "props" | "hunters"): LevelPoint[] => {
    const list = spawns[key];
    if (!Array.isArray(list) || list.length === 0) {
      return fail(`spawns.${key}`, "must be a non-empty array", "add at least one spawn point");
    }
    return list.map((raw, index) => {
      if (!isRecord(raw) || !isFiniteNumber(raw.x) || !isFiniteNumber(raw.z)) {
        return fail(`spawns.${key}[${index}]`, "needs finite x and z", "write numeric x, z");
      }
      if (!inside(raw.x, raw.z)) {
        return fail(`spawns.${key}[${index}]`, "is outside the map", `keep ${bounds}`);
      }
      return { x: raw.x, z: raw.z };
    });
  };

  return {
    version: LEVEL_DOCUMENT_VERSION,
    id,
    grid: { cols, rows },
    rooms,
    doors,
    objects,
    spawns: { props: points("props"), hunters: points("hunters") },
  };
}
