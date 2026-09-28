import {
  type AssetCard,
  computePropBounds,
  type PropDefinition,
  uniformFitScale,
} from "@morphy/shared";
import type { LevelObject } from "./document";
import { type Rect2, rotateOffset } from "./geometry";

/** What the checks, the operations and the views measure objects against. */
export interface LevelContext {
  catalog: readonly PropDefinition[];
  cards: Readonly<Record<string, AssetCard>>;
}

/** The shape an object occupies: its rotated XZ rectangle and its vertical span. */
export interface Footprint {
  rect: Rect2;
  yMin: number;
  yMax: number;
}

/** A catalog shape's extent in its own frame, before it is placed. */
export interface ShapeExtent {
  halfX: number;
  halfZ: number;
  yMin: number;
  yMax: number;
}

function partsExtent(def: PropDefinition): ShapeExtent {
  const bounds = computePropBounds(def);
  let halfX = 0;
  let halfZ = 0;
  for (const part of def.parts) {
    halfX = Math.max(halfX, Math.abs(part.position.x) + part.size.x / 2);
    halfZ = Math.max(halfZ, Math.abs(part.position.z) + part.size.z / 2);
  }
  return { halfX, halfZ, yMin: bounds.yMin, yMax: bounds.yMax };
}

/**
 * The extent a catalog shape renders at: its GLB scaled by the renderer's uniform fit
 * into the shape's bounding cylinder (the client's `fitModel`), centred on the axis
 * and seated on the cylinder's base. A shape without a model renders its primitive
 * parts. Null when the model has no asset card, so there is nothing to measure.
 */
export function shapeExtent(def: PropDefinition, context: LevelContext): ShapeExtent | null {
  if (def.model === undefined) return partsExtent(def);
  const card = context.cards[def.model];
  if (card === undefined) return null;
  const bounds = computePropBounds(def);
  const height = bounds.yMax - bounds.yMin;
  const scale = uniformFitScale(card.size, 2 * bounds.radius, height, def.modelScale ?? 1);
  return {
    halfX: (card.size.x * scale) / 2,
    halfZ: (card.size.z * scale) / 2,
    yMin: bounds.yMin,
    yMax: bounds.yMin + card.size.y * scale,
  };
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
 * The boxes a player's body collides with around a placed object: one per primitive
 * part, rotated with the object, exactly as the client builds its movement colliders.
 * The uniform fit keeps the rendered model inside them.
 */
export function objectHitboxes(object: LevelObject, context: LevelContext): Rect2[] {
  const def = context.catalog.find((entry) => entry.id === object.type);
  if (def === undefined) return [];
  return def.parts.map((part) => {
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
