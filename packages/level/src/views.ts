import { LEVEL_SAMPLE_CELL } from "@morphy/shared";
import { type Finding, type LevelReport, OPEN_GROUND } from "./checks";
import {
  type CellRect,
  DEFAULT_GROUND,
  isOutdoor,
  type LevelDocument,
  type LevelObject,
} from "./document";
import { TILE, WALL_HALF_THICKNESS } from "./floorplan";
import type { Footprint, LevelContext } from "./footprint";
import { degrees, num, point } from "./format";
import { rectContains, rectExtent, SNAP_EPSILON } from "./geometry";
import { buildSpace, type LevelSpace, lineX, lineZ } from "./space";

const OBJECT_GLYPHS = "abcdefghijklmnopqrstuvwxyzABCDEFGIJKLMNOQRSTUVWXYZ0123456789";
const OVERFLOW_GLYPH = "*";
const GLYPH = { wall: "#", door: "+", floor: ".", outside: " ", props: "P", hunters: "H" };
const PLAN_MARGIN = 1;
const RULER_EVERY = TILE / LEVEL_SAMPLE_CELL;
const Z_LABEL_WIDTH = 7;

function rectText(doc: LevelDocument, rect: CellRect): string {
  const [x0, x1, z0, z1] = [
    lineX(doc, rect.i0),
    lineX(doc, rect.i1),
    lineZ(doc, rect.j0),
    lineZ(doc, rect.j1),
  ];
  return `x ${x0}..${x1}, z ${z0}..${z1} (${x1 - x0} x ${z1 - z0} m)`;
}

function sizeText(footprint: Footprint | undefined): string {
  if (footprint === undefined) return "unmeasured";
  const { halfX, halfZ } = footprint.rect;
  return `${num(2 * halfX)} x ${num(2 * halfZ)} m, h ${num(footprint.yMax)} m`;
}

function roomOf(space: LevelSpace, object: LevelObject): string {
  return space.regionAt(object.x, object.z) ?? OPEN_GROUND;
}

function typeCounts(objects: readonly LevelObject[]): string {
  const counts = new Map<string, number>();
  for (const object of objects) counts.set(object.type, (counts.get(object.type) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => `${type} ${count}`)
    .join(", ");
}

/** A compact text overview of a document: grid, rooms with their size in metres, doors and object counts. */
export function summarizeLevel(doc: LevelDocument, context: LevelContext): string {
  const space = buildSpace(doc, context);
  const { cols, rows } = doc.grid;
  const outdoor = isOutdoor(doc);
  const lines = [
    `${doc.id}: ${outdoor ? "outdoor, " : ""}${cols}x${rows} cells of ${TILE} m (${cols * TILE} x ${rows * TILE} m), ${doc.rooms.length} rooms, ${outdoor ? `${doc.blocks?.length ?? 0} blocks` : `${doc.doors.length} doors`}, ${doc.objects.length} objects, spawns ${doc.spawns.props.length} props / ${doc.spawns.hunters.length} hunters, ${doc.lights?.length ?? 0} lights`,
    "rooms:",
  ];
  for (const room of doc.rooms) {
    const objects = doc.objects.filter((object) => roomOf(space, object) === room.id);
    const ground = outdoor ? ` (${room.ground ?? DEFAULT_GROUND})` : "";
    lines.push(
      `  ${room.id}${ground}: ${room.rects.map((rect) => rectText(doc, rect)).join("; ")}`,
    );
    lines.push(
      `    ${objects.length} objects${objects.length > 0 ? `: ${typeCounts(objects)}` : ""}`,
    );
  }
  const loose = doc.objects.filter((object) => roomOf(space, object) === OPEN_GROUND);
  if (loose.length > 0)
    lines.push(`  ${OPEN_GROUND}: ${loose.length} objects: ${typeCounts(loose)}`);
  if (outdoor) {
    lines.push("blocks:");
    for (const block of doc.blocks ?? []) {
      const what = block.building === undefined ? block.zone : `${block.zone}, ${block.building}`;
      lines.push(
        `  ${block.id} (${what}): ${block.rects.map((rect) => rectText(doc, rect)).join("; ")}`,
      );
    }
    return lines.join("\n");
  }
  lines.push("doors:");
  for (const zone of space.doors) {
    const [a, b] = zone.sides.map((side) => side.region ?? OPEN_GROUND);
    lines.push(`  ${zone.key} ${a} | ${b} at ${point(zone)}`);
  }
  return lines.join("\n");
}

/** One line per object, optionally only those standing in `room`: id, type, position, yaw, room and real size. */
export function listObjects(doc: LevelDocument, context: LevelContext, room?: string): string {
  const space = buildSpace(doc, context);
  const lines: string[] = [];
  for (const object of doc.objects) {
    const where = roomOf(space, object);
    if (room !== undefined && where !== room) continue;
    const footprint = space.footprints.get(object.id);
    lines.push(
      `${object.id} ${object.type} ${point(object)} yaw ${degrees(object.yaw)} in ${where}, ${sizeText(footprint)}`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : "no objects";
}

/** One line per light: id, kind, position, its street lamp if it stands on one, and the room it hangs in. */
export function listLights(doc: LevelDocument, context: LevelContext): string {
  const space = buildSpace(doc, context);
  const lines = (doc.lights ?? []).map(
    (light) =>
      `${light.id} ${light.kind} ${point(light)}${light.fixture === undefined ? "" : ` on a ${light.fixture} lamp, yaw ${degrees(light.yaw ?? 0)}`} in ${space.regionAt(light.x, light.z) ?? OPEN_GROUND}`,
  );
  return lines.length > 0 ? lines.join("\n") : "no lights";
}

/**
 * An ASCII plan of one room at {@link LEVEL_SAMPLE_CELL} m per character, north (-Z)
 * up, with a margin of the walls around it: `#` wall, `+` doorway, `.` the room's
 * floor, blank anything else, `P` / `H` spawns and one glyph per object, listed in the
 * legend. Each row starts with the z of its sample centres.
 */
export function planRoom(doc: LevelDocument, context: LevelContext, roomId: string): string {
  const room = doc.rooms.find((entry) => entry.id === roomId);
  if (room === undefined)
    throw new Error(`no room "${roomId}"; rooms: ${doc.rooms.map((r) => r.id).join(", ")}`);
  const space = buildSpace(doc, context);
  const minX = Math.max(
    -space.halfW,
    Math.min(...room.rects.map((r) => lineX(doc, r.i0))) - PLAN_MARGIN,
  );
  const maxX = Math.min(
    space.halfW,
    Math.max(...room.rects.map((r) => lineX(doc, r.i1))) + PLAN_MARGIN,
  );
  const minZ = Math.max(
    -space.halfD,
    Math.min(...room.rects.map((r) => lineZ(doc, r.j0))) - PLAN_MARGIN,
  );
  const maxZ = Math.min(
    space.halfD,
    Math.max(...room.rects.map((r) => lineZ(doc, r.j1))) + PLAN_MARGIN,
  );
  const width = Math.round((maxX - minX) / LEVEL_SAMPLE_CELL);
  const height = Math.round((maxZ - minZ) / LEVEL_SAMPLE_CELL);
  const cx = (col: number): number => minX + (col + 0.5) * LEVEL_SAMPLE_CELL;
  const cz = (row: number): number => minZ + (row + 0.5) * LEVEL_SAMPLE_CELL;

  const gaps = space.doors.map((zone) => {
    const half = TILE / 2;
    const across = WALL_HALF_THICKNESS;
    return zone.door.axis === "v"
      ? { minX: zone.x - across, maxX: zone.x + across, minZ: zone.z - half, maxZ: zone.z + half }
      : { minX: zone.x - half, maxX: zone.x + half, minZ: zone.z - across, maxZ: zone.z + across };
  });
  const cells: string[][] = Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, col) => {
      const x = cx(col);
      const z = cz(row);
      if (space.walls.some((wall) => rectContains(wall, x, z))) return GLYPH.wall;
      if (gaps.some((g) => x > g.minX && x < g.maxX && z > g.minZ && z < g.maxZ)) return GLYPH.door;
      return space.regionAt(x, z) === roomId ? GLYPH.floor : GLYPH.outside;
    }),
  );
  const put = (x: number, z: number, glyph: string): void => {
    const col = Math.floor((x - minX) / LEVEL_SAMPLE_CELL);
    const row = Math.floor((z - minZ) / LEVEL_SAMPLE_CELL);
    if (row >= 0 && row < height && col >= 0 && col < width) cells[row]![col] = glyph;
  };

  const legend: string[] = [];
  const shown = doc.objects.filter((object) => {
    const footprint = space.footprints.get(object.id);
    const e =
      footprint === undefined
        ? { minX: object.x, maxX: object.x, minZ: object.z, maxZ: object.z }
        : rectExtent(footprint.rect);
    return e.maxX >= minX && e.minX <= maxX && e.maxZ >= minZ && e.minZ <= maxZ;
  });
  shown.forEach((object, index) => {
    const glyph = OBJECT_GLYPHS[index] ?? OVERFLOW_GLYPH;
    const footprint = space.footprints.get(object.id);
    if (footprint !== undefined) {
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          if (rectContains(footprint.rect, cx(col), cz(row))) cells[row]![col] = glyph;
        }
      }
    }
    put(object.x, object.z, glyph);
    legend.push(
      `  ${glyph} ${object.id} ${object.type} ${point(object)} yaw ${degrees(object.yaw)}, ${sizeText(footprint)}`,
    );
  });
  for (const kind of ["props", "hunters"] as const) {
    for (const spawn of doc.spawns[kind]) put(spawn.x, spawn.z, GLYPH[kind]);
  }

  const pad = " ".repeat(Z_LABEL_WIDTH);
  const ruler = Array.from({ length: width }, (_, col) =>
    Math.abs(((minX + col * LEVEL_SAMPLE_CELL + space.halfW) / LEVEL_SAMPLE_CELL) % RULER_EVERY) <
    SNAP_EPSILON
      ? "|"
      : " ",
  ).join("");
  const lines = [
    `plan of ${roomId}, ${LEVEL_SAMPLE_CELL} m per char, north (-z) up; x ${num(minX)}..${num(maxX)}, z ${num(minZ)}..${num(maxZ)}`,
    `column 0 is x = ${num(cx(0))}, each column +${LEVEL_SAMPLE_CELL} m; ruler | marks the ${TILE} m grid lines`,
    `${GLYPH.wall} wall  ${GLYPH.door} doorway  ${GLYPH.floor} floor  ${GLYPH.props} prop spawn  ${GLYPH.hunters} hunter spawn`,
    `${pad}${ruler}`,
    ...cells.map((row, index) => `${num(cz(index)).padStart(Z_LABEL_WIDTH - 1)} ${row.join("")}`),
    shown.length > 0 ? "objects:" : "no objects",
    ...legend,
  ];
  return lines.join("\n");
}

/** One line for a finding: severity, code, entities, position, message and fix. */
export function formatFinding(finding: Finding): string {
  const at = finding.at === undefined ? "" : ` at ${point(finding.at)}`;
  const hint = finding.hint === undefined ? "" : ` | fix: ${finding.hint}`;
  return `${finding.severity} ${finding.code} [${finding.entities.join(", ")}]${at}: ${finding.message}${hint}`;
}

function inRoom(doc: LevelDocument, space: LevelSpace, finding: Finding, room: string): boolean {
  if (finding.entities.includes(room)) return true;
  if (finding.at !== undefined && space.regionAt(finding.at.x, finding.at.z) === room) return true;
  return finding.entities.some((id) => {
    const object = doc.objects.find((entry) => entry.id === id);
    return object !== undefined && space.regionAt(object.x, object.z) === room;
  });
}

/** The part of a report about one room: findings that name it or lie in it, and its metrics. */
export function reportForRoom(
  report: LevelReport,
  doc: LevelDocument,
  context: LevelContext,
  room: string,
): LevelReport {
  const space = buildSpace(doc, context);
  const prefix = `room.${room}.`;
  return {
    findings: report.findings.filter((finding) => inRoom(doc, space, finding, room)),
    unplaced: report.unplaced.filter((id) => {
      const object = doc.objects.find((entry) => entry.id === id);
      return object !== undefined && space.regionAt(object.x, object.z) === room;
    }),
    metrics: Object.fromEntries(
      Object.entries(report.metrics).filter(([key]) => key.startsWith(prefix)),
    ),
  };
}

function roomMetricLines(metrics: Record<string, number>): string[] {
  const rooms = new Map<string, string[]>();
  for (const [key, value] of Object.entries(metrics)) {
    if (!key.startsWith("room.")) continue;
    const rest = key.slice("room.".length);
    const dot = rest.indexOf(".");
    const room = rest.slice(0, dot);
    rooms.set(room, [...(rooms.get(room) ?? []), `${rest.slice(dot + 1)} ${num(value)}`]);
  }
  return [...rooms.entries()].map(([room, parts]) => `  ${room}: ${parts.join(", ")}`);
}

/** A report as text: one line per finding, unplaced objects, then totals and one line per room. */
export function formatReport(report: LevelReport): string {
  const lines = report.findings.map(formatFinding);
  if (report.findings.length === 0) lines.push("no findings");
  if (report.unplaced.length > 0) lines.push(`unplaced: ${report.unplaced.join(", ")}`);
  const totals = Object.entries(report.metrics)
    .filter(([key]) => !key.startsWith("room."))
    .map(([key, value]) => `${key} ${num(value)}`);
  if (totals.length > 0) lines.push(`totals: ${totals.join(", ")}`);
  const rooms = roomMetricLines(report.metrics);
  if (rooms.length > 0) lines.push("rooms:", ...rooms);
  return lines.join("\n");
}

function findingKey(finding: Finding): string {
  const at = finding.at === undefined ? "" : point(finding.at);
  return `${finding.code}|${finding.entities.join(",")}|${at}`;
}

/** What changed between two reports: findings that appeared (+) or went away (-) and metrics that moved. */
export function formatReportDelta(before: LevelReport, after: LevelReport): string {
  const was = new Map(before.findings.map((finding) => [findingKey(finding), finding]));
  const now = new Map(after.findings.map((finding) => [findingKey(finding), finding]));
  const lines: string[] = [];
  for (const [key, finding] of now) if (!was.has(key)) lines.push(`+ ${formatFinding(finding)}`);
  for (const [key, finding] of was) if (!now.has(key)) lines.push(`- ${formatFinding(finding)}`);
  const keys = new Set([...Object.keys(before.metrics), ...Object.keys(after.metrics)]);
  for (const key of keys) {
    const a = before.metrics[key];
    const b = after.metrics[key];
    if (a !== b)
      lines.push(
        `~ ${key} ${a === undefined ? "none" : num(a)} -> ${b === undefined ? "none" : num(b)}`,
      );
  }
  return lines.length > 0 ? lines.join("\n") : "report unchanged";
}
