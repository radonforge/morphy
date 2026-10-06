import {
  type BoxCollider,
  type MapDefinition,
  makeRng,
  type PropDefinition,
  type TileInstance,
} from "@morphy/shared";
import { DEFAULT_CEILING, DEFAULT_GROUND, isOutdoor, type LevelDocument } from "./document";
import {
  type Cell,
  emitCeiling,
  emitFloorplan,
  FLOOR_THICKNESS,
  type Grid,
  TILE,
  WALL_HEIGHT,
} from "./floorplan";
import { compileOutdoor } from "./outdoor";

/** How high an outdoor map's bounds reach, above its tallest tower. */
const OUTDOOR_CEILING_Y = 40;

export interface CompileOptions {
  catalog: readonly PropDefinition[];
  seed: number;
}

/**
 * Compile a validated level document into the `MapDefinition` the room and the
 * client consume: a floor slab under the whole grid and one prop per object at
 * `y = 0`. Indoors, walls, gates and floor tiles from the floorplan emitter and a
 * ceiling panel over every floor cell; `seed` only picks floor and wall tile
 * variants, nothing moves with it, and the document's lights are carried over as
 * they are. Outdoors, ground patches, block buildings, the unseen perimeter and the
 * street lamps from {@link compileOutdoor}, under an open sky.
 */
export function compileLevel(doc: LevelDocument, { catalog, seed }: CompileOptions): MapDefinition {
  const { cols, rows } = doc.grid;
  const grid: Grid = { gx: cols, gz: rows, halfW: (cols * TILE) / 2, halfD: (rows * TILE) / 2 };

  const region: Cell[][] = Array.from({ length: cols }, () => new Array<Cell>(rows).fill(null));
  for (const room of doc.rooms) {
    for (const rect of room.rects) {
      for (let i = rect.i0; i < rect.i1; i++) {
        for (let j = rect.j0; j < rect.j1; j++) region[i]![j] = room.id;
      }
    }
  }

  const tiles: TileInstance[] = [];
  const colliders: BoxCollider[] = [
    {
      position: { x: 0, y: -FLOOR_THICKNESS / 2, z: 0 },
      size: { x: cols * TILE, y: FLOOR_THICKNESS, z: rows * TILE },
    },
  ];
  const spawnPoints = {
    props: doc.spawns.props.map(({ x, z }) => ({ x, y: 0, z })),
    hunters: doc.spawns.hunters.map(({ x, z }) => ({ x, y: 0, z })),
  };
  const props = doc.objects.map((object) => ({
    type: object.type,
    position: { x: object.x, y: 0, z: object.z },
    rotation: object.yaw,
  }));

  if (isOutdoor(doc)) {
    const groundKinds = new Map(doc.rooms.map((room) => [room.id, room.ground ?? DEFAULT_GROUND]));
    const outdoor = compileOutdoor(doc, (i, j) => {
      const id = region[i]![j];
      return id === null || id === undefined ? null : (groundKinds.get(id) ?? DEFAULT_GROUND);
    });
    return {
      id: doc.id,
      bounds: {
        min: { x: -grid.halfW, y: 0, z: -grid.halfD },
        max: { x: grid.halfW, y: OUTDOOR_CEILING_Y, z: grid.halfD },
      },
      spawnPoints,
      colliders: [...colliders, ...outdoor.colliders],
      tiles,
      scenery: outdoor.scenery,
      props,
      propCatalog: [...catalog],
      ...(outdoor.lights !== undefined ? { lights: outdoor.lights } : {}),
      ground: outdoor.ground,
    };
  }

  emitFloorplan(grid, region, doc.doors, makeRng(seed), { tiles, colliders });
  const ceilingKinds = new Map(doc.rooms.map((room) => [room.id, room.ceiling ?? DEFAULT_CEILING]));
  const ceiling = emitCeiling(grid, region, (id) => ceilingKinds.get(id) ?? DEFAULT_CEILING);

  return {
    id: doc.id,
    bounds: {
      min: { x: -grid.halfW, y: 0, z: -grid.halfD },
      max: { x: grid.halfW, y: WALL_HEIGHT, z: grid.halfD },
    },
    spawnPoints,
    colliders,
    tiles,
    scenery: [],
    props,
    propCatalog: [...catalog],
    ...(doc.lights !== undefined
      ? { lights: doc.lights.map(({ id, x, z, kind }) => ({ id, x, z, kind })) }
      : {}),
    ceiling,
  };
}
