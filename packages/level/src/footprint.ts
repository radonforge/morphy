import {
  type AssetCard,
  type AssetTags,
  fittedExtent,
  LEVEL_STEP_HEIGHT,
  type PropDefinition,
  type ShapeExtent,
} from "@morphy/shared";
import type { LevelObject } from "./document";
import { type Rect2, rotateOffset } from "./geometry";

export type { ShapeExtent };

/** What the checks, the operations and the views measure objects against. */
export interface LevelContext {
  catalog: readonly PropDefinition[];
  cards: Readonly<Record<string, AssetCard>>;
  tags: Readonly<Record<string, AssetTags>>;
}

/** The shape an object occupies: its rotated XZ rectangle and its vertical span. */
export interface Footprint {
  rect: Rect2;
  yMin: number;
  yMax: number;
}

/**
 * The extent a catalog shape renders at, measured against the context's asset
 * cards; see {@link fittedExtent}.
 */
export function shapeExtent(def: PropDefinition, context: LevelContext): ShapeExtent | null {
  return fittedExtent(def, context.cards);
}

/** The real rotated footprint and height of a placed object, or null when it cannot be measured. */
export function objectFootprint(object: LevelObject, context: LevelContext): Footprint | null {
  const def = context.catalog.find((entry) => entry.id === object.type);
  if (def === undefined) return null;
  const extent = shapeExtent(def, context);
  if (extent === null) return null;
  const { halfX, halfZ, yMin, yMax } = extent;
  return { rect: { x: object.x, z: object.z, yaw: object.yaw, halfX, halfZ }, yMin, yMax };
}

/**
 * The boxes that stop a player's body around a placed object: one per primitive part,
 * rotated with the object, exactly as the client builds its movement colliders, less
 * the parts whose top is at most {@link LEVEL_STEP_HEIGHT}, which a body steps onto.
 * The uniform fit keeps the rendered model inside them.
 */
export function objectHitboxes(object: LevelObject, context: LevelContext): Rect2[] {
  const def = context.catalog.find((entry) => entry.id === object.type);
  if (def === undefined) return [];
  const blocking = def.parts.filter(
    (part) => part.position.y + part.size.y / 2 > LEVEL_STEP_HEIGHT,
  );
  return blocking.map((part) => {
    const offset = rotateOffset(part.position.x, part.position.z, object.yaw);
    return {
      x: object.x + offset.x,
      z: object.z + offset.z,
      yaw: object.yaw,
      halfX: part.size.x / 2,
      halfZ: part.size.z / 2,
    };
  });
}
