import type { BoxCollider, MapDefinition, PropInstance, TileInstance, Vec3 } from "@webhunt/shared";
import { ARCHETYPE, type Doorway, furnishRoom, type Keepout, type RoomRect } from "../furnish";
import { SPACE_CATALOG } from "../spaceCatalog";
import {
  type Cell,
  emitDeck,
  emitFloorplan,
  emitStairs,
  FLOOR_THICKNESS,
  type FloorplanDoor,
  type Grid,
  lineX,
  lineZ,
  makeRng,
  STAIR_RISE,
  STAIR_RUN,
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

/**
 * Hangar mezzanine: a catwalk deck hugging the east wall (grid cells i 21-22,
 * j 12-17), reached by walk-up stairs descending north from its front edge and
 * by a crate-hop chain along its west edge. The deck top must clear player
 * height underneath (walk-under) and keep standing eyes below WALL_HEIGHT on
 * top; a jump's apex briefly clears the wall line at grazing angles, which is
 * accepted (the third-person camera is still occluded by wall footprints).
 */
const DECK_CELLS = { i0: 21, i1: 22, j0: 12, j1: 17 };
const DECK_TOP = 2.4;
const RAIL_MODEL = "/models/space/station/balcony-rail-center.glb";
const RAIL_PITCH = 1;
const RAIL_GAP_Z = { min: 23, max: 26 };
const CRATE_EDGE_OFFSET = 0.7;
const CRATE_CHAIN: readonly { type: string; z: number }[] = [
  { type: "container-flat", z: 26.6 },
  { type: "container", z: 25.2 },
  { type: "container-tall", z: 23.8 },
];
const DECK_PROPS: readonly { type: string; dx: number; z: number }[] = [
  { type: "container", dx: -0.4, z: 16.4 },
  { type: "barrel", dx: 0.6, z: 29.2 },
];
const STAIR_KEEPOUT_RADIUS = 3.4;
const CRATE_KEEPOUT_RADIUS = 2.8;
const HALF_PI = Math.PI / 2;

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
  const deck = {
    x0: lineX(grid, DECK_CELLS.i0),
    x1: lineX(grid, DECK_CELLS.i1),
    z0: lineZ(grid, DECK_CELLS.j0),
    z1: lineZ(grid, DECK_CELLS.j1),
  };
  const deckCx = (deck.x0 + deck.x1) / 2;
  emitDeck(deck, DECK_TOP, { tiles, colliders });
  emitStairs(
    { x: deckCx, z: deck.z0, width: TILE, top: DECK_TOP, dirX: 0, dirZ: -1 },
    { tiles, colliders },
  );
  for (let z = deck.z0 + RAIL_PITCH / 2; z < deck.z1; z += RAIL_PITCH) {
    if (z > RAIL_GAP_Z.min && z < RAIL_GAP_Z.max) continue;
    tiles.push({
      model: RAIL_MODEL,
      position: { x: deck.x0, y: DECK_TOP, z },
      rotationY: HALF_PI,
    });
  }
  for (let x = deck.x0 + RAIL_PITCH / 2; x < deck.x1; x += RAIL_PITCH) {
    tiles.push({
      model: RAIL_MODEL,
      position: { x, y: DECK_TOP, z: deck.z1 },
      rotationY: 0,
    });
  }
  const crateX = deck.x0 - CRATE_EDGE_OFFSET;
  for (const crate of CRATE_CHAIN) {
    props.push({ type: crate.type, position: { x: crateX, y: 0, z: crate.z }, rotation: 0 });
  }
  for (const dressing of DECK_PROPS) {
    props.push({
      type: dressing.type,
      position: { x: deckCx + dressing.dx, y: DECK_TOP, z: dressing.z },
      rotation: 0,
    });
  }
  const stairSteps = Math.round(DECK_TOP / STAIR_RISE);
  const hangarKeepouts: Keepout[] = [
    { x: deckCx, z: deck.z0 - (stairSteps * STAIR_RUN) / 2, radius: STAIR_KEEPOUT_RADIUS },
    { x: crateX, z: CRATE_CHAIN[1]!.z, radius: CRATE_KEEPOUT_RADIUS },
  ];

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
      keepouts: room.id === "hangar" ? hangarKeepouts : undefined,
    });
    propSpawns.push(...spawns);
  }

  return {
    id: "station",
    name: "Stazione Kepler-9",
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
