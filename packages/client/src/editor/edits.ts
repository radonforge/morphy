import {
  buriedLight,
  type CellRect,
  doorKey,
  type LevelContext,
  type LevelDocument,
  type LevelDoor,
  type LevelLight,
  type OpResult,
  objectFootprint,
  rectContains,
  TILE,
} from "@morphy/level";

/** Grid step of a snapped object or spawn position, in metres. */
export const POSITION_STEP = 0.5;
/** Decimals kept on a free position or angle, so the document does not fill with float noise. */
const FREE_DECIMALS = 3;
const TURN_EPSILON = 1e-6;
const FULL_TURN = Math.PI * 2;

export type SpawnTeam = "props" | "hunters";

/** A document change that could not be applied, with the reason shown to the author. */
export interface EditRefusal {
  refused: string;
}

export type EditResult = LevelDocument | EditRefusal;

export function isRefusal(result: EditResult): result is EditRefusal {
  return "refused" in result;
}

/** Op finding codes worth telling the author about even when the op succeeded. */
const NOTABLE_OP_CODES = new Set(["op.yaw-snapped", "op.door-removed"]);

/**
 * The document a `@morphy/level` op produced, or its first error as the refusal
 * shown to the author (an `op.blocked` message names what is in the way), so the
 * editor applies exactly the rules the `pnpm level` CLI does.
 */
export function fromOp(result: OpResult): EditResult {
  if (result.ok) return result.doc;
  const error = result.findings.find((finding) => finding.severity === "error");
  if (!error) return { refused: "the operation failed without saying why" };
  return { refused: error.hint ? `${error.message} (${error.hint})` : error.message };
}

/** What a successful op said that the author should see: a rounded yaw, a door it removed. */
export function opNotes(result: OpResult): string[] {
  return result.ok
    ? result.findings.filter((finding) => NOTABLE_OP_CODES.has(finding.code)).map((f) => f.message)
    : [];
}

/** The id of the object `after` has and `before` did not, as a place or duplicate op leaves it. */
export function addedObjectId(before: LevelDocument, after: LevelDocument): string | null {
  const known = new Set(before.objects.map((object) => object.id));
  return after.objects.find((object) => !known.has(object.id))?.id ?? null;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Snap a coordinate to {@link POSITION_STEP}, or only trim it to millimetres when `free`. */
export function snapPosition(value: number, free: boolean): number {
  return free
    ? roundTo(value, FREE_DECIMALS)
    : Math.round(value / POSITION_STEP) * POSITION_STEP + 0;
}

/** Wrap an angle into (-PI, PI]. */
export function normalizeYaw(yaw: number): number {
  const wrapped = ((((yaw + Math.PI) % FULL_TURN) + FULL_TURN) % FULL_TURN) - Math.PI;
  return wrapped <= -Math.PI + TURN_EPSILON ? Math.PI : wrapped;
}

/** Half extents of the document's grid in world metres. */
export function halfExtents(doc: LevelDocument): { halfW: number; halfD: number } {
  return { halfW: (doc.grid.cols * TILE) / 2, halfD: (doc.grid.rows * TILE) / 2 };
}

/** A world point in fractional grid units: `gx` counts columns from the left edge, `gz` rows from the top. */
export function toGrid(doc: LevelDocument, x: number, z: number): { gx: number; gz: number } {
  const { halfW, halfD } = halfExtents(doc);
  return { gx: (x + halfW) / TILE, gz: (z + halfD) / TILE };
}

/** Keep a point inside the map, where the parser accepts it. */
export function clampToMap(doc: LevelDocument, x: number, z: number): { x: number; z: number } {
  const { halfW, halfD } = halfExtents(doc);
  return {
    x: Math.min(halfW, Math.max(-halfW, x)),
    z: Math.min(halfD, Math.max(-halfD, z)),
  };
}

/** Owner room id of every cell, `null` for open ground, indexed `[i][j]`. */
export function regionGrid(doc: LevelDocument): (string | null)[][] {
  const owner = Array.from({ length: doc.grid.cols }, () =>
    new Array<string | null>(doc.grid.rows).fill(null),
  );
  for (const room of doc.rooms) {
    for (const rect of room.rects) {
      for (let i = rect.i0; i < rect.i1; i++) {
        for (let j = rect.j0; j < rect.j1; j++) owner[i]![j] = room.id;
      }
    }
  }
  return owner;
}

function regionAt(owner: (string | null)[][], i: number, j: number): string | null {
  return owner[i]?.[j] ?? null;
}

/** The two regions a door edge separates. */
function doorSides(owner: (string | null)[][], door: LevelDoor): [string | null, string | null] {
  return door.axis === "v"
    ? [regionAt(owner, door.line - 1, door.cell), regionAt(owner, door.line, door.cell)]
    : [regionAt(owner, door.cell, door.line - 1), regionAt(owner, door.cell, door.line)];
}

/** Whether `door` lies on an inner grid edge between two different regions, where the parser accepts one. */
export function isWallEdge(doc: LevelDocument, door: LevelDoor, owner = regionGrid(doc)): boolean {
  const [lines, cells] =
    door.axis === "v" ? [doc.grid.cols, doc.grid.rows] : [doc.grid.rows, doc.grid.cols];
  if (door.line <= 0 || door.line >= lines || door.cell < 0 || door.cell >= cells) return false;
  const [a, b] = doorSides(owner, door);
  return a !== b;
}

/**
 * The grid edge nearest a world point, when the point is within `tolerance`
 * cells of it: the edge a click toggles a door on.
 */
export function edgeAt(
  doc: LevelDocument,
  x: number,
  z: number,
  tolerance: number,
): LevelDoor | null {
  const { gx, gz } = toGrid(doc, x, z);
  const dv = Math.abs(gx - Math.round(gx));
  const dh = Math.abs(gz - Math.round(gz));
  if (Math.min(dv, dh) > tolerance) return null;
  return dv <= dh
    ? { axis: "v", line: Math.round(gx), cell: Math.floor(gz) }
    : { axis: "h", line: Math.round(gz), cell: Math.floor(gx) };
}

/** Drop every door that no longer sits between two different regions, as a room edit can leave behind. */
export function pruneDoors(doc: LevelDocument): LevelDocument {
  const owner = regionGrid(doc);
  const doors = doc.doors.filter((door) => isWallEdge(doc, door, owner));
  return doors.length === doc.doors.length ? doc : { ...doc, doors };
}

/** The rect spanned by two cells, inclusive of both, clipped to the grid. */
export function rectBetween(
  doc: LevelDocument,
  a: { i: number; j: number },
  b: { i: number; j: number },
): CellRect {
  const clampI = (i: number) => Math.min(doc.grid.cols - 1, Math.max(0, i));
  const clampJ = (j: number) => Math.min(doc.grid.rows - 1, Math.max(0, j));
  const [ia, ib] = [clampI(a.i), clampI(b.i)];
  const [ja, jb] = [clampJ(a.j), clampJ(b.j)];
  return {
    i0: Math.min(ia, ib),
    i1: Math.max(ia, ib) + 1,
    j0: Math.min(ja, jb),
    j1: Math.max(ja, jb) + 1,
  };
}

/** The cell under a world point, clamped to the grid. */
export function cellAt(doc: LevelDocument, x: number, z: number): { i: number; j: number } {
  const { gx, gz } = toGrid(doc, x, z);
  return {
    i: Math.min(doc.grid.cols - 1, Math.max(0, Math.floor(gx))),
    j: Math.min(doc.grid.rows - 1, Math.max(0, Math.floor(gz))),
  };
}

function rectFits(doc: LevelDocument, rect: CellRect): boolean {
  return (
    rect.i0 >= 0 &&
    rect.j0 >= 0 &&
    rect.i1 <= doc.grid.cols &&
    rect.j1 <= doc.grid.rows &&
    rect.i0 < rect.i1 &&
    rect.j0 < rect.j1
  );
}

function overlapsOther(doc: LevelDocument, rect: CellRect, roomId: string | null): string | null {
  const owner = regionGrid(doc);
  for (let i = rect.i0; i < rect.i1; i++) {
    for (let j = rect.j0; j < rect.j1; j++) {
      const other = owner[i]![j]!;
      if (other !== null && other !== roomId) return other;
    }
  }
  return null;
}

/** The first free `room-<n>` id, for a room the author paints. */
export function newRoomId(doc: LevelDocument): string {
  const used = new Set(doc.rooms.map((room) => room.id));
  let n = 1;
  while (used.has(`room-${n}`)) n++;
  return `room-${n}`;
}

/** `doc`, or a refusal naming the light a room edit would leave inside a wall the parser rejects. */
function keepLightsOutOfWalls(doc: LevelDocument): EditResult {
  const buried = buriedLight(doc);
  return buried === undefined
    ? doc
    : { refused: `light ${buried.id} would end up inside a wall, move it first` };
}

/** Add another rect to a room, e.g. the second arm of an L. */
export function addRoomRect(doc: LevelDocument, roomId: string, rect: CellRect): EditResult {
  if (!rectFits(doc, rect)) return { refused: "the rect is off the grid" };
  const other = overlapsOther(doc, rect, roomId);
  if (other !== null) return { refused: `it overlaps room "${other}"` };
  return keepLightsOutOfWalls(
    pruneDoors({
      ...doc,
      rooms: doc.rooms.map((room) =>
        room.id === roomId ? { ...room, rects: [...room.rects, { ...rect }] } : room,
      ),
    }),
  );
}

/** Which side of `rect` lies within `tolerance` cells of a grid point, the handle an edge drag moves. */
export type RectEdge = "i0" | "i1" | "j0" | "j1";

export function rectEdgeAt(
  rect: CellRect,
  gx: number,
  gz: number,
  tolerance: number,
): RectEdge | null {
  const withinJ = gz >= rect.j0 - tolerance && gz <= rect.j1 + tolerance;
  const withinI = gx >= rect.i0 - tolerance && gx <= rect.i1 + tolerance;
  const candidates: [RectEdge, number, boolean][] = [
    ["i0", Math.abs(gx - rect.i0), withinJ],
    ["i1", Math.abs(gx - rect.i1), withinJ],
    ["j0", Math.abs(gz - rect.j0), withinI],
    ["j1", Math.abs(gz - rect.j1), withinI],
  ];
  let best: RectEdge | null = null;
  let bestDistance = tolerance;
  for (const [edge, distance, within] of candidates) {
    if (within && distance <= bestDistance) {
      best = edge;
      bestDistance = distance;
    }
  }
  return best;
}

/** Move one side of `rect` to grid line `line`, keeping it at least one cell wide. */
export function moveRectEdge(rect: CellRect, edge: RectEdge, line: number): CellRect {
  switch (edge) {
    case "i0":
      return { ...rect, i0: Math.min(line, rect.i1 - 1) };
    case "i1":
      return { ...rect, i1: Math.max(line, rect.i0 + 1) };
    case "j0":
      return { ...rect, j0: Math.min(line, rect.j1 - 1) };
    case "j1":
      return { ...rect, j1: Math.max(line, rect.j0 + 1) };
  }
}

/**
 * Delete one rect of a room that has several, such as an arm of an L. There is no
 * level op for this; a room's last rect goes with the room, through `removeRoom`.
 */
export function removeRoomRect(doc: LevelDocument, roomId: string, index: number): EditResult {
  const room = doc.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return { refused: `there is no room "${roomId}"` };
  if (room.rects.length < 2) return { refused: `room "${roomId}" has a single rect` };
  return keepLightsOutOfWalls(
    pruneDoors({
      ...doc,
      rooms: doc.rooms.map((candidate) =>
        candidate.id === roomId
          ? { ...candidate, rects: candidate.rects.filter((_, at) => at !== index) }
          : candidate,
      ),
    }),
  );
}

/** The room rect under a point, last listed first as it draws on top. */
export function roomRectAt(
  doc: LevelDocument,
  x: number,
  z: number,
): { roomId: string; index: number } | null {
  const { gx, gz } = toGrid(doc, x, z);
  for (const room of [...doc.rooms].reverse()) {
    const index = room.rects.findIndex(
      (rect) => gx >= rect.i0 && gx < rect.i1 && gz >= rect.j0 && gz < rect.j1,
    );
    if (index >= 0) return { roomId: room.id, index };
  }
  return null;
}

/**
 * The object whose real footprint (the rotated rect the checks measure) contains
 * the point, nearest centre first; an object without an asset card falls back to
 * a circle of `fallbackRadius`.
 */
export function objectAt(
  doc: LevelDocument,
  x: number,
  z: number,
  context: LevelContext,
  fallbackRadius: number,
): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const object of doc.objects) {
    const distance = Math.hypot(object.x - x, object.z - z);
    const footprint = objectFootprint(object, context);
    const inside = footprint ? rectContains(footprint.rect, x, z) : distance <= fallbackRadius;
    if (inside && distance < bestDistance) {
      best = object.id;
      bestDistance = distance;
    }
  }
  return best;
}

export function addSpawn(
  doc: LevelDocument,
  team: SpawnTeam,
  x: number,
  z: number,
): { doc: LevelDocument; index: number } {
  const at = clampToMap(doc, x, z);
  const list = [...doc.spawns[team], at];
  return { doc: { ...doc, spawns: { ...doc.spawns, [team]: list } }, index: list.length - 1 };
}

export function moveSpawn(
  doc: LevelDocument,
  team: SpawnTeam,
  index: number,
  x: number,
  z: number,
): LevelDocument {
  const at = clampToMap(doc, x, z);
  const list = doc.spawns[team].map((point, i) => (i === index ? at : point));
  return { ...doc, spawns: { ...doc.spawns, [team]: list } };
}

/** Remove a spawn point; each team keeps at least one, as the parser requires. */
export function deleteSpawn(doc: LevelDocument, team: SpawnTeam, index: number): EditResult {
  if (doc.spawns[team].length <= 1) return { refused: `the ${team} need at least one spawn` };
  const list = doc.spawns[team].filter((_, i) => i !== index);
  return { ...doc, spawns: { ...doc.spawns, [team]: list } };
}

/** The spawn point within `radius` of a point, nearest first. */
export function spawnAt(
  doc: LevelDocument,
  x: number,
  z: number,
  radius: number,
): { team: SpawnTeam; index: number } | null {
  let best: { team: SpawnTeam; index: number } | null = null;
  let bestDistance = radius;
  for (const team of ["props", "hunters"] as const) {
    doc.spawns[team].forEach((point, index) => {
      const distance = Math.hypot(point.x - x, point.z - z);
      if (distance <= bestDistance) {
        best = { team, index };
        bestDistance = distance;
      }
    });
  }
  return best;
}

/** The id of the light `after` has and `before` did not, as an add op leaves it. */
export function addedLightId(before: LevelDocument, after: LevelDocument): string | null {
  const known = new Set((before.lights ?? []).map((light) => light.id));
  return (after.lights ?? []).find((light) => !known.has(light.id))?.id ?? null;
}

/** The light within `radius` of a point, nearest first. */
export function lightAt(doc: LevelDocument, x: number, z: number, radius: number): string | null {
  let best: string | null = null;
  let bestDistance = radius;
  for (const light of doc.lights ?? []) {
    const distance = Math.hypot(light.x - x, light.z - z);
    if (distance <= bestDistance) {
      best = light.id;
      bestDistance = distance;
    }
  }
  return best;
}

/** Give a light another kind; no level op covers this, and the position is untouched. */
export function setLightKind(doc: LevelDocument, id: string, kind: LevelLight["kind"]): EditResult {
  const lights = doc.lights ?? [];
  if (!lights.some((light) => light.id === id)) return { refused: `there is no light "${id}"` };
  return { ...doc, lights: lights.map((light) => (light.id === id ? { ...light, kind } : light)) };
}

/**
 * Keys of what differs from `before` to `after` and still exists in `after`,
 * the entities an external change highlights: `object:<id>`, `room:<id>`,
 * `door:<key>`, `spawn:<team>:<index>` and `light:<id>`. `removed` counts what went away.
 */
export function changedEntities(
  before: LevelDocument,
  after: LevelDocument,
): { keys: string[]; removed: number } {
  const keys: string[] = [];
  let removed = 0;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  const objectsBefore = new Map(before.objects.map((object) => [object.id, object]));
  for (const object of after.objects) {
    if (!same(objectsBefore.get(object.id), object)) keys.push(`object:${object.id}`);
  }
  const objectIds = new Set(after.objects.map((object) => object.id));
  removed += before.objects.filter((object) => !objectIds.has(object.id)).length;

  const roomsBefore = new Map(before.rooms.map((room) => [room.id, room]));
  for (const room of after.rooms) {
    if (!same(roomsBefore.get(room.id), room)) keys.push(`room:${room.id}`);
  }
  const roomIds = new Set(after.rooms.map((room) => room.id));
  removed += before.rooms.filter((room) => !roomIds.has(room.id)).length;

  const doorsBefore = new Set(before.doors.map(doorKey));
  const doorsAfter = new Set(after.doors.map(doorKey));
  for (const key of doorsAfter) if (!doorsBefore.has(key)) keys.push(`door:${key}`);
  removed += [...doorsBefore].filter((key) => !doorsAfter.has(key)).length;

  for (const team of ["props", "hunters"] as const) {
    after.spawns[team].forEach((point, index) => {
      if (!same(before.spawns[team][index], point)) keys.push(`spawn:${team}:${index}`);
    });
    removed += Math.max(0, before.spawns[team].length - after.spawns[team].length);
  }
  const lightsBefore = new Map((before.lights ?? []).map((light) => [light.id, light]));
  for (const light of after.lights ?? []) {
    if (!same(lightsBefore.get(light.id), light)) keys.push(`light:${light.id}`);
  }
  const lightIds = new Set((after.lights ?? []).map((light) => light.id));
  removed += (before.lights ?? []).filter((light) => !lightIds.has(light.id)).length;

  if (!same(before.grid, after.grid)) keys.push("grid");
  return { keys, removed };
}
