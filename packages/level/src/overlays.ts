import { LEVEL_SAMPLE_CELL, LEVEL_UNREACHABLE_MIN_AREA } from "@morphy/shared";
import { isOutdoor, type LevelDocument, type LevelPoint } from "./document";
import type { LevelContext } from "./footprint";
import {
  components,
  floodReach,
  longestSightline,
  nearestWalkable,
  type SampleGrid,
  type Sightline,
  sampleSpace,
} from "./samples";
import { buildSpace, type LevelSpace } from "./space";

function openSightline(grid: SampleGrid, space: LevelSpace): { room: string; line: Sightline }[] {
  const line = longestSightline(grid, (p) => (space.regionAt(p.x, p.z) ?? null) !== null);
  const room = line === null ? null : space.regionAt(line.from.x, line.from.z);
  return line === null || room === null || room === undefined ? [] : [{ room, line }];
}

/**
 * The geometry behind the `floor.unreachable` and `room.sightline` findings, for
 * drawing them: the centre of every walkable sample no hunter spawn reaches (in
 * pockets of at least {@link LEVEL_UNREACHABLE_MIN_AREA}, as the check counts them)
 * and each room's longest clear sightline (outdoors, the one longest over all the open
 * ground, under the room it starts in). Built from the same sampling as
 * `validateLevel`, so an overlay shows exactly what the checks measured.
 */
export interface LevelOverlays {
  sampleCell: number;
  unreachable: LevelPoint[];
  sightlines: { room: string; line: Sightline }[];
}

export function levelOverlays(doc: LevelDocument, context: LevelContext): LevelOverlays {
  const space = buildSpace(doc, context);
  const grid = sampleSpace(space);
  const seeds = doc.spawns.hunters
    .map((spawn) => nearestWalkable(grid, spawn))
    .filter((index) => index >= 0);
  const unreachable: LevelPoint[] = [];
  if (seeds.length > 0) {
    const reached = floodReach(grid, seeds);
    const pockets = components(grid, (index) => !!grid.walkable[index] && !reached[index]);
    for (const group of pockets) {
      if (group.length * LEVEL_SAMPLE_CELL * LEVEL_SAMPLE_CELL < LEVEL_UNREACHABLE_MIN_AREA)
        continue;
      for (const index of group) unreachable.push(grid.centre(index));
    }
  }
  const sightlines = isOutdoor(doc)
    ? openSightline(grid, space)
    : doc.rooms.flatMap((room) => {
        const line = longestSightline(grid, (p) => space.regionAt(p.x, p.z) === room.id);
        return line === null ? [] : [{ room: room.id, line }];
      });
  return { sampleCell: LEVEL_SAMPLE_CELL, unreachable, sightlines };
}
