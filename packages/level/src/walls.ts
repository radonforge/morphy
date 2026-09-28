import { compileLevel } from "./compile";
import type { LevelDocument } from "./document";
import { type Rect2, rectFromExtent } from "./geometry";

const LAYOUT_SEED = 0;

interface CachedWalls {
  doors: LevelDocument["doors"];
  grid: LevelDocument["grid"];
  walls: readonly Rect2[];
}

const WALLS_BY_ROOMS = new WeakMap<LevelDocument["rooms"], CachedWalls>();

/**
 * The wall boxes the compiler emits for a document, as floor-plane rectangles; the
 * floor slab is not one. Walls follow only the grid, the rooms and the doors, never
 * the prop catalog, so no catalog is taken. Documents are immutable, so the result is
 * kept while those three references stay the same: an edit that only moves an object
 * or a light, such as a drag, reuses it instead of compiling the map again.
 */
export function wallRects(doc: LevelDocument): readonly Rect2[] {
  const cached = WALLS_BY_ROOMS.get(doc.rooms);
  if (cached !== undefined && cached.doors === doc.doors && cached.grid === doc.grid) {
    return cached.walls;
  }
  const walls = compileLevel(doc, { catalog: [], seed: LAYOUT_SEED })
    .colliders.filter((collider) => collider.position.y > 0)
    .map((collider) =>
      rectFromExtent({
        minX: collider.position.x - collider.size.x / 2,
        maxX: collider.position.x + collider.size.x / 2,
        minZ: collider.position.z - collider.size.z / 2,
        maxZ: collider.position.z + collider.size.z / 2,
      }),
    );
  WALLS_BY_ROOMS.set(doc.rooms, { doors: doc.doors, grid: doc.grid, walls });
  return walls;
}
