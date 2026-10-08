import type { AssetCard } from "./assetCards";
import { computePropBounds, type PropDefinition, type Vec3 } from "./map";

/** Floor under a model's measured extent, so a flat or degenerate mesh never divides by zero. */
export const MODEL_MIN_SIZE = 0.001;

/**
 * Uniform scale that seats a model measuring `size` in its own units inside a cylinder
 * `width` across and `height` tall, times the catalog's `scaleMul`. The one rule the
 * renderer, the level checks and the editor share, so a fitted model is the same size
 * wherever it is measured.
 */
export function uniformFitScale(
  size: Vec3,
  width: number,
  height: number,
  scaleMul: number,
): number {
  return (
    Math.min(
      width / Math.max(size.x, MODEL_MIN_SIZE),
      height / Math.max(size.y, MODEL_MIN_SIZE),
      width / Math.max(size.z, MODEL_MIN_SIZE),
    ) * scaleMul
  );
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
 * The extent a catalog shape renders at: its GLB scaled by {@link uniformFitScale}
 * into the shape's bounding cylinder (the client's `fitModel`), centred on the axis
 * and seated on the cylinder's base. A shape without a model renders its primitive
 * parts. Null when the model has no asset card, so there is nothing to measure.
 */
export function fittedExtent(
  def: PropDefinition,
  cards: Readonly<Record<string, AssetCard>>,
): ShapeExtent | null {
  if (def.model === undefined) return partsExtent(def);
  const card = cards[def.model];
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
