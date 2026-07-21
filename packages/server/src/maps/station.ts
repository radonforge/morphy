import type { BoxCollider, MapDefinition, PropInstance, TileInstance, Vec3 } from "@morphy/shared";
import { ARCHETYPE, type Doorway, furnishRoom, type RoomRect } from "../furnish";
import { SPACE_CATALOG } from "../spaceCatalog";
import {
  type Cell,
  emitFloorplan,
  FLOOR_THICKNESS,
  type FloorplanDoor,
  type Grid,
  lineX,
  lineZ,
  makeRng,
  TILE,
  WALL_HEIGHT,
} from "./lib";

const GX = 22;
const GZ = 18;

interface Room {
  id: string;
  name: string;
  i0: number;
  i1: number;
  j0: number;
  j1: number;
  archetype: number;
}

const CORR = "corr";

/**
 * Hand-authored deck plan: a `+`-shaped corridor splits the deck into six themed
 * compartments. Each is reachable from the central spine (no soft-lock), and a
 * Stiva↔Alloggi side door adds a flanking route.
 */
const ROOMS: Room[] = [
  { id: "comando", name: "Comando", i0: 0, i1: 10, j0: 0, j1: 8, archetype: ARCHETYPE.CONTROL },
  { id: "lab", name: "Laboratorio", i0: 12, i1: 22, j0: 0, j1: 4, archetype: ARCHETYPE.LAB },
  { id: "mensa", name: "Mensa", i0: 12, i1: 22, j0: 4, j1: 8, archetype: ARCHETYPE.MESS },
  { id: "stiva", name: "Stiva", i0: 0, i1: 6, j0: 10, j1: 18, archetype: ARCHETYPE.STORAGE },
  { id: "alloggi", name: "Alloggi", i0: 6, i1: 10, j0: 10, j1: 18, archetype: ARCHETYPE.QUARTERS },
  { id: "hangar", name: "Hangar", i0: 12, i1: 22, j0: 10, j1: 18, archetype: ARCHETYPE.STORAGE },
];

const DOORS: FloorplanDoor[] = [
  { axis: "v", line: 10, cell: 3 }, // Comando ↔ spina
  { axis: "h", line: 8, cell: 4 }, // Comando ↔ spina
  { axis: "v", line: 12, cell: 2 }, // Laboratorio ↔ spina
  { axis: "v", line: 12, cell: 6 }, // Mensa ↔ spina
  { axis: "h", line: 8, cell: 16 }, // Mensa ↔ spina
  { axis: "h", line: 10, cell: 3 }, // Stiva ↔ spina
  { axis: "v", line: 6, cell: 13 }, // Stiva ↔ Alloggi
  { axis: "h", line: 10, cell: 8 }, // Alloggi ↔ spina
  { axis: "v", line: 10, cell: 13 }, // Alloggi ↔ spina
  { axis: "v", line: 12, cell: 13 }, // Hangar ↔ spina
  { axis: "h", line: 10, cell: 16 }, // Hangar ↔ spina
];

const SPAWN_INSET = 2.6;
const SPAWN_DOOR_CLEAR = 4;
const SPAWNS_PER_ROOM = 3;

function paint(region: Cell[][], id: string, r: Pick<Room, "i0" | "i1" | "j0" | "j1">): void {
  for (let i = r.i0; i < r.i1; i++) {
    for (let j = r.j0; j < r.j1; j++) region[i]![j] = id;
  }
}

/** Per-room prop spawns: inset corners far enough from doorways, spread out. */
function roomSpawns(rect: RoomRect, doorways: Doorway[]): Vec3[] {
  const corners = [
    { x: rect.x0 + SPAWN_INSET, z: rect.z0 + SPAWN_INSET },
    { x: rect.x1 - SPAWN_INSET, z: rect.z0 + SPAWN_INSET },
    { x: rect.x0 + SPAWN_INSET, z: rect.z1 - SPAWN_INSET },
    { x: rect.x1 - SPAWN_INSET, z: rect.z1 - SPAWN_INSET },
  ];
  const scored = corners
    .map((c) => {
      let nearest = Infinity;
      for (const d of doorways) nearest = Math.min(nearest, Math.hypot(c.x - d.x, c.z - d.z));
      return { c, nearest };
    })
    .filter((s) => s.nearest > SPAWN_DOOR_CLEAR)
    .sort((a, b) => b.nearest - a.nearest)
    .slice(0, SPAWNS_PER_ROOM);
  return scored.map((s) => ({ x: s.c.x, y: 0, z: s.c.z }));
}

/** Stazione Kepler-9 — hand-authored deck of themed compartments around a central spine. */
export function buildStation(seed: number): MapDefinition {
  const rng = makeRng(seed);
  const grid: Grid = { gx: GX, gz: GZ, halfW: (GX * TILE) / 2, halfD: (GZ * TILE) / 2 };

  const region: Cell[][] = Array.from({ length: GX }, () => new Array<Cell>(GZ).fill(null));
  paint(region, CORR, { i0: 10, i1: 12, j0: 0, j1: GZ });
  paint(region, CORR, { i0: 0, i1: GX, j0: 8, j1: 10 });
  for (const r of ROOMS) paint(region, r.id, r);
  for (let i = 0; i < GX; i++) {
    for (let j = 0; j < GZ; j++) {
      if (region[i]![j] === null) {
        throw new Error(`station: cell (${i},${j}) unassigned`);
      }
    }
  }

  const tiles: TileInstance[] = [];
  const colliders: BoxCollider[] = [
    {
      position: { x: 0, y: -FLOOR_THICKNESS / 2, z: 0 },
      size: { x: GX * TILE, y: FLOOR_THICKNESS, z: GZ * TILE },
    },
  ];
  const doorways: Doorway[] = [];
  emitFloorplan(grid, region, DOORS, rng, { tiles, colliders, doorways });

  const props: PropInstance[] = [];
  const propSpawns: Vec3[] = [];
  for (const room of ROOMS) {
    const rect: RoomRect = {
      x0: lineX(grid, room.i0),
      x1: lineX(grid, room.i1),
      z0: lineZ(grid, room.j0),
      z1: lineZ(grid, room.j1),
    };
    const spawns = roomSpawns(rect, doorways);
    const keepout = spawns[0]
      ? { x: spawns[0].x, z: spawns[0].z }
      : { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2 };
    furnishRoom({
      rect,
      doorways,
      spawn: keepout,
      catalog: SPACE_CATALOG,
      rng,
      out: props,
      archetype: room.archetype,
    });
    propSpawns.push(...spawns);
  }

  return {
    id: "station",
    bounds: {
      min: { x: -grid.halfW, y: 0, z: -grid.halfD },
      max: { x: grid.halfW, y: WALL_HEIGHT, z: grid.halfD },
    },
    spawnPoints: { props: propSpawns },
    colliders,
    tiles,
    scenery: [],
    props,
    propCatalog: SPACE_CATALOG,
  };
}
