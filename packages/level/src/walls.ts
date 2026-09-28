import type { PropDefinition } from "@morphy/shared";
import { compileLevel } from "./compile";
import type { LevelDocument } from "./document";
import { type Rect2, rectFromExtent } from "./geometry";

const LAYOUT_SEED = 0;

/** The wall boxes the compiler emits for a document, as floor-plane rectangles; the floor slab is not one. */
export function wallRects(doc: LevelDocument, catalog: readonly PropDefinition[]): Rect2[] {
  return compileLevel(doc, { catalog, seed: LAYOUT_SEED })
    .colliders.filter((collider) => collider.position.y > 0)
    .map((collider) =>
      rectFromExtent({
        minX: collider.position.x - collider.size.x / 2,
        maxX: collider.position.x + collider.size.x / 2,
        minZ: collider.position.z - collider.size.z / 2,
        maxZ: collider.position.z + collider.size.z / 2,
      }),
    );
}
