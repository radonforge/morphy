import {
  type BoxCollider,
  type MapDefinition,
  makeRng,
  type PropDefinition,
  type TileInstance,
} from "@morphy/shared";
import { DEFAULT_CEILING, type LevelDocument } from "./document";
import {
  type Cell,
  emitCeiling,
  emitFloorplan,
  FLOOR_THICKNESS,
  type Grid,
  TILE,
  WALL_HEIGHT,
} from "./floorplan";

export interface CompileOptions {
  catalog: readonly PropDefinition[];
  seed: number;
}

/**
 * Compile a validated level document into the `MapDefinition` the room and the
 * client consume: a floor slab under the whole grid, walls, gates and floor
 * tiles from the floorplan emitter, a ceiling panel over every floor cell, and
 * one prop per object at `y = 0`. `seed`
 * only picks floor and wall tile variants; nothing moves with it. The document's
 * lights, when it has any, are carried over as they are.
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
  emitFloorplan(grid, region, doc.doors, makeRng(seed), { tiles, colliders });
  const ceilingKinds = new Map(doc.rooms.map((room) => [room.id, room.ceiling ?? DEFAULT_CEILING]));
  const ceiling = emitCeiling(grid, region, (id) => ceilingKinds.get(id) ?? DEFAULT_CEILING);

  return {
    id: doc.id,
    bounds: {
      min: { x: -grid.halfW, y: 0, z: -grid.halfD },
      max: { x: grid.halfW, y: WALL_HEIGHT, z: grid.halfD },
    },
    spawnPoints: {
      props: doc.spawns.props.map(({ x, z }) => ({ x, y: 0, z })),
      hunters: doc.spawns.hunters.map(({ x, z }) => ({ x, y: 0, z })),
    },
    colliders,
    tiles,
    scenery: [],
    props: doc.objects.map((object) => ({
      type: object.type,
      position: { x: object.x, y: 0, z: object.z },
      rotation: object.yaw,
    })),
    propCatalog: [...catalog],
    ...(doc.lights !== undefined ? { lights: doc.lights.map((light) => ({ ...light })) } : {}),
    ceiling,
  };
}
