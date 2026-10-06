import {
  LEVEL_BODY_RADIUS,
  LEVEL_MIN_DISGUISES,
  LEVEL_OVERLAP_TOLERANCE,
  LEVEL_SAMPLE_CELL,
  LEVEL_SIGHT_BLOCK_HEIGHT,
  LEVEL_SIGHTLINE_MAX,
  LEVEL_UNREACHABLE_MIN_AREA,
} from "@morphy/shared";
import { isOutdoor, type LevelDocument, type LevelObject, type LevelPoint } from "./document";
import { TILE } from "./floorplan";
import type { LevelContext } from "./footprint";
import { num, point } from "./format";
import {
  circleHitsRect,
  overlapDepth,
  penetration,
  rectCorners,
  rectExtent,
  snapToward,
  spansMeet,
} from "./geometry";
import { DECK_LIGHT_CLEARANCE_SLACK, DECK_LIGHT_WALL_CLEARANCE, wallClearance } from "./lights";
import {
  components,
  floodReach,
  longestSightline,
  nearestWalkable,
  neighbours,
  type SampleGrid,
  type Sightline,
  sampleSpace,
} from "./samples";
import { buildSpace, type LevelSpace } from "./space";

export type FindingSeverity = "error" | "warning" | "info";

/** One thing wrong with, or worth knowing about, a level: what, where, and how to fix it. */
export interface Finding {
  code: string;
  severity: FindingSeverity;
  message: string;
  entities: string[];
  at?: LevelPoint;
  hint?: string;
}

/**
 * What {@link validateLevel} found. `unplaced` lists objects it could not measure
 * (never objects it dropped: validators neither drop nor move anything); `metrics`
 * holds totals under plain keys and per-room values under `room.<id>.<name>`.
 */
export interface LevelReport {
  findings: Finding[];
  unplaced: string[];
  metrics: Record<string, number>;
}

/** Every finding code {@link validateLevel} can emit. */
export const FINDING_CODES = [
  "object.unmeasured",
  "object.wall",
  "object.overlap",
  "object.open-ground",
  "object.outside-room",
  "door.blocked",
  "spawn.blocked",
  "floor.unreachable",
  "room.sightline",
  "room.few-disguises",
  "object.unique-type",
  "light.wall-clearance",
] as const;

/** Label for the region with no room, where the checks name one. */
export const OPEN_GROUND = "open-ground";

const SEVERITY_ORDER: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2 };
const SAMPLE_AREA = LEVEL_SAMPLE_CELL * LEVEL_SAMPLE_CELL;
const MAX_NAMED_BLOCKERS = 5;

function label(object: LevelObject): string {
  return `${object.id} (${object.type})`;
}

function moveHint(object: LevelObject, dx: number, dz: number): string {
  const x = snapToward(object.x + dx, dx);
  const z = snapToward(object.z + dz, dz);
  return `pnpm level move ${object.id} --to=${num(x)},${num(z)}`;
}

function regionName(region: string | null | undefined): string {
  return region ?? OPEN_GROUND;
}

function objectFindings(space: LevelSpace, findings: Finding[], unplaced: string[]): void {
  const { doc } = space;
  for (const object of doc.objects) {
    const footprint = space.footprints.get(object.id);
    const at = { x: object.x, z: object.z };
    if (footprint === undefined) {
      const def = space.context.catalog.find((entry) => entry.id === object.type);
      unplaced.push(object.id);
      findings.push({
        code: "object.unmeasured",
        severity: "error",
        message: `${label(object)} has no asset card for ${def?.model ?? "its model"}`,
        entities: [object.id],
        at,
        hint: "run pnpm cards to regenerate the asset cards",
      });
      continue;
    }
    const region = space.regionAt(object.x, object.z) ?? null;
    if (region === null) {
      findings.push({
        code: "object.open-ground",
        severity: "warning",
        message: `${label(object)} stands on open ground, outside every room`,
        entities: [object.id],
        at,
        hint: "move it into a room or add a room around it",
      });
    } else if (!isOutdoor(doc)) {
      const strays = new Set<string>();
      for (const corner of rectCorners(footprint.rect)) {
        const other = space.regionAt(corner.x, corner.z);
        if (other !== region) strays.add(regionName(other));
      }
      if (strays.size > 0) {
        findings.push({
          code: "object.outside-room",
          severity: "warning",
          message: `${label(object)} in ${region} reaches into ${[...strays].join(", ")}`,
          entities: [object.id, region, ...strays],
          at,
          hint: `keep its footprint inside ${region}`,
        });
      }
    }

    let worst: { depth: number; nx: number; nz: number } | null = null;
    for (const wall of space.walls) {
      const hit = penetration(wall, footprint.rect);
      if (hit.depth > LEVEL_OVERLAP_TOLERANCE && (worst === null || hit.depth > worst.depth)) {
        worst = hit;
      }
    }
    if (worst !== null) {
      findings.push({
        code: "object.wall",
        severity: "error",
        message: `${label(object)} cuts ${num(worst.depth)} m into a wall`,
        entities: [object.id],
        at,
        hint: moveHint(object, worst.nx * worst.depth, worst.nz * worst.depth),
      });
    }
  }

  const placed = doc.objects.filter((object) => space.footprints.has(object.id));
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i]!;
    const fa = space.footprints.get(a.id)!;
    const ra = fa.rect;
    const ea = rectExtent(ra);
    for (let k = i + 1; k < placed.length; k++) {
      const b = placed[k]!;
      const fb = space.footprints.get(b.id)!;
      const rb = fb.rect;
      const eb = rectExtent(rb);
      if (eb.minX >= ea.maxX || eb.maxX <= ea.minX || eb.minZ >= ea.maxZ || eb.maxZ <= ea.minZ) {
        continue;
      }
      if (!spansMeet(fa, fb)) continue;
      const hit = penetration(ra, rb);
      if (hit.depth <= LEVEL_OVERLAP_TOLERANCE) continue;
      findings.push({
        code: "object.overlap",
        severity: "warning",
        message: `${label(a)} and ${label(b)} overlap by ${num(hit.depth)} m`,
        entities: [a.id, b.id],
        at: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 },
        hint: moveHint(b, hit.nx * hit.depth, hit.nz * hit.depth),
      });
    }
  }
}

function doorFindings(space: LevelSpace, findings: Finding[]): void {
  for (const zone of space.doors) {
    for (const side of zone.sides) {
      const blockers = space.doc.objects.filter((object) =>
        (space.hitboxes.get(object.id) ?? []).some(
          (box) => overlapDepth(box, side.zone) > LEVEL_OVERLAP_TOLERANCE,
        ),
      );
      if (blockers.length === 0) continue;
      const extent = rectExtent(side.zone);
      findings.push({
        code: "door.blocked",
        severity: "warning",
        message: `door ${zone.key} is blocked on the ${regionName(side.region)} side by ${blockers.map(label).join(", ")}`,
        entities: [zone.key, ...blockers.map((object) => object.id)],
        at: { x: side.zone.x, z: side.zone.z },
        hint: `keep x ${num(extent.minX)}..${num(extent.maxX)}, z ${num(extent.minZ)}..${num(extent.maxZ)} free of collision boxes`,
      });
    }
  }
}

function spawnFindings(space: LevelSpace, findings: Finding[]): void {
  for (const kind of ["props", "hunters"] as const) {
    space.doc.spawns[kind].forEach((spawn, index) => {
      const id = `spawns.${kind}[${index}]`;
      const inWall = space.walls.some((wall) =>
        circleHitsRect(spawn.x, spawn.z, LEVEL_BODY_RADIUS, wall),
      );
      const blockers = space.doc.objects.filter((object) =>
        (space.hitboxes.get(object.id) ?? []).some((box) =>
          circleHitsRect(spawn.x, spawn.z, LEVEL_BODY_RADIUS, box),
        ),
      );
      if (!inWall && blockers.length === 0) return;
      const what = [...(inWall ? ["a wall"] : []), ...blockers.map(label)].join(", ");
      findings.push({
        code: "spawn.blocked",
        severity: "error",
        message: `${id} at ${point(spawn)} puts a player inside ${what}`,
        entities: [id, ...blockers.map((object) => object.id)],
        at: spawn,
        hint: `move the spawn at least ${num(LEVEL_BODY_RADIUS)} m clear of it`,
      });
    });
  }
}

function lightFindings(space: LevelSpace, findings: Finding[]): void {
  const bounds = { halfW: space.halfW, halfD: space.halfD };
  for (const light of space.doc.lights ?? []) {
    if (light.kind !== "room") continue;
    const { distance, target } = wallClearance(space.walls, bounds, light);
    if (distance >= DECK_LIGHT_WALL_CLEARANCE - DECK_LIGHT_CLEARANCE_SLACK) continue;
    findings.push({
      code: "light.wall-clearance",
      severity: "warning",
      message: `light ${light.id} at ${point(light)} is ${num(distance)} m from a wall, under ${DECK_LIGHT_WALL_CLEARANCE} m, so it burns a hotspot into it`,
      entities: [light.id],
      at: { x: light.x, z: light.z },
      hint:
        target === null
          ? `move it at least ${num(DECK_LIGHT_WALL_CLEARANCE - distance)} m away from the wall`
          : `pnpm level light move ${light.id} --to=${num(target.x)},${num(target.z)}`,
    });
  }
}

function reachFindings(
  space: LevelSpace,
  findings: Finding[],
  metrics: Record<string, number>,
): SampleGrid {
  const grid = sampleSpace(space);
  const hunters = space.doc.spawns.hunters;
  const seeds = hunters.map((spawn) => nearestWalkable(grid, spawn));
  if (seeds.every((index) => index < 0)) {
    hunters.forEach((spawn, index) => {
      const id = `spawns.hunters[${index}]`;
      if (findings.some((f) => f.code === "spawn.blocked" && f.entities[0] === id)) return;
      findings.push({
        code: "spawn.blocked",
        severity: "error",
        message: `${id} at ${point(spawn)} leaves no room for a body on the ${num(LEVEL_SAMPLE_CELL)} m sample grid`,
        entities: [id],
        at: spawn,
        hint: `move the spawn at least ${num(LEVEL_BODY_RADIUS + LEVEL_SAMPLE_CELL)} m clear of walls and objects`,
      });
    });
    return grid;
  }
  const reached = floodReach(
    grid,
    seeds.filter((index) => index >= 0),
  );
  let reachable = 0;
  for (const value of reached) reachable += value;
  metrics["floor.reachable.m2"] = reachable * SAMPLE_AREA;

  const doored = new Set(
    space.doors.flatMap((zone) => zone.sides.map((side) => regionName(side.region))),
  );
  let unreachable = 0;
  for (const group of components(grid, (index) => !!grid.walkable[index] && !reached[index])) {
    const area = group.length * SAMPLE_AREA;
    if (area < LEVEL_UNREACHABLE_MIN_AREA) continue;
    unreachable += area;
    const points = group.map((index) => grid.centre(index));
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const cz = points.reduce((sum, p) => sum + p.z, 0) / points.length;
    const at = points.reduce((best, p) =>
      Math.hypot(p.x - cx, p.z - cz) < Math.hypot(best.x - cx, best.z - cz) ? p : best,
    );
    const regions = [...new Set(points.map((p) => regionName(space.regionAt(p.x, p.z))))].sort();
    const enclosing = new Set<string>();
    for (const index of group) {
      for (const next of neighbours(grid, index)) {
        for (const id of grid.blockers.get(next) ?? []) enclosing.add(id);
      }
    }
    const named = [...enclosing].sort().slice(0, MAX_NAMED_BLOCKERS);
    const sealed = regions.filter((region) => !doored.has(region));
    findings.push({
      code: "floor.unreachable",
      severity: "warning",
      message: `${num(area)} m2 of floor in ${regions.join(", ")} cannot be reached from any hunter spawn`,
      entities: [...regions, ...named],
      at,
      hint:
        sealed.length > 0 && !isOutdoor(space.doc)
          ? `add a door into ${sealed.join(", ")}`
          : `widen a gap to at least ${num(2 * LEVEL_BODY_RADIUS + LEVEL_SAMPLE_CELL)} m between ${named.join(", ") || "the walls around it"}`,
    });
  }
  metrics["floor.unreachable.m2"] = unreachable;
  return grid;
}

function roomFindings(
  space: LevelSpace,
  grid: SampleGrid,
  findings: Finding[],
  metrics: Record<string, number>,
): void {
  for (const room of space.doc.rooms) {
    const key = (name: string): string => `room.${room.id}.${name}`;
    const cells = room.rects.reduce((sum, r) => sum + (r.i1 - r.i0) * (r.j1 - r.j0), 0);
    metrics[key("area.m2")] = cells * TILE * TILE;
    const inside = space.doc.objects.filter(
      (object) => space.regionAt(object.x, object.z) === room.id,
    );
    metrics[key("objects")] = inside.length;

    const byType = new Map<string, LevelObject[]>();
    for (const object of inside)
      byType.set(object.type, [...(byType.get(object.type) ?? []), object]);
    let disguises = 0;
    for (const [type, group] of byType) {
      if (group.length > 1) {
        disguises += group.length;
        continue;
      }
      const object = group[0]!;
      findings.push({
        code: "object.unique-type",
        severity: "info",
        message: `${object.id} is the only ${type} in ${room.id}, so a prop disguised as one stands out`,
        entities: [object.id, room.id],
        at: { x: object.x, z: object.z },
        hint: `add another ${type} to ${room.id} or use a type the room already repeats`,
      });
    }
    metrics[key("disguises")] = disguises;
    if (inside.length > 0 && disguises < LEVEL_MIN_DISGUISES) {
      findings.push({
        code: "room.few-disguises",
        severity: "warning",
        message: `${room.id} has ${disguises} objects of a repeated type, fewer than ${LEVEL_MIN_DISGUISES}`,
        entities: [room.id],
        hint: "add objects of a type the room already has, so a disguise blends in",
      });
    }

    if (isOutdoor(space.doc)) continue;
    const line = longestSightline(grid, (p) => space.regionAt(p.x, p.z) === room.id);
    metrics[key("sightline.m")] = line?.length ?? 0;
    sightlineFinding(line, room.id, findings);
  }
  if (!isOutdoor(space.doc)) return;
  const line = longestSightline(grid, (p) => (space.regionAt(p.x, p.z) ?? null) !== null);
  metrics["open.sightline.m"] = line?.length ?? 0;
  if (line !== null)
    sightlineFinding(line, regionName(space.regionAt(line.from.x, line.from.z)), findings);
}

/**
 * A `room.sightline` warning when `line` runs past {@link LEVEL_SIGHTLINE_MAX}. Outdoors
 * one line is measured over all the open ground, since nothing walls one ground region
 * off from the next, and it is reported against the region it starts in.
 */
function sightlineFinding(line: Sightline | null, region: string, findings: Finding[]): void {
  if (line === null || line.length <= LEVEL_SIGHTLINE_MAX) return;
  const mid = { x: (line.from.x + line.to.x) / 2, z: (line.from.z + line.to.z) / 2 };
  findings.push({
    code: "room.sightline",
    severity: "warning",
    message: `${region} has a ${num(line.length)} m clear sightline from ${point(line.from)} to ${point(line.to)}, over ${LEVEL_SIGHTLINE_MAX} m`,
    entities: [region],
    at: line.from,
    hint: `break it with an object at least ${num(LEVEL_SIGHT_BLOCK_HEIGHT)} m tall near ${point(mid)}`,
  });
}

function compareFindings(a: Finding, b: Finding): number {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    a.code.localeCompare(b.code) ||
    a.entities.join(",").localeCompare(b.entities.join(","))
  );
}

/**
 * Check a parsed document for layout problems an agent can fix without looking at
 * it: objects cutting into walls or each other (real rendered footprints), objects
 * off their room, blocked doorways, spawns inside geometry, room lights hung against a
 * wall, floor a hunter cannot reach, and per room the longest clear sightline and how well a disguise blends
 * in. Pure: it neither drops nor moves anything.
 */
export function validateLevel(doc: LevelDocument, context: LevelContext): LevelReport {
  const space = buildSpace(doc, context);
  const findings: Finding[] = [];
  const unplaced: string[] = [];
  const metrics: Record<string, number> = {
    rooms: doc.rooms.length,
    doors: doc.doors.length,
    objects: doc.objects.length,
  };
  objectFindings(space, findings, unplaced);
  doorFindings(space, findings);
  spawnFindings(space, findings);
  lightFindings(space, findings);
  const grid = reachFindings(space, findings, metrics);
  roomFindings(space, grid, findings, metrics);
  findings.sort(compareFindings);
  for (const severity of ["error", "warning", "info"] as const) {
    metrics[`findings.${severity}`] = findings.filter((f) => f.severity === severity).length;
  }
  return { findings, unplaced, metrics };
}
