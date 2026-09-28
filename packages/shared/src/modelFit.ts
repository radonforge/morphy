import type { Vec3 } from "./map";

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
