import { uniformFitScale } from "@morphy/shared";
import * as THREE from "three";

export { MODEL_MIN_SIZE } from "@morphy/shared";

/** Uniform scale plus offset that seats a model's bounding box inside a prop's bounding cylinder. */
export interface ModelFit {
  scale: number;
  offset: readonly [number, number, number];
}

/**
 * Fit a model, measured by `box` in its own root space, into a cylinder `width` across
 * and `height` tall whose base sits at `baseY`, centred on the axis.
 *
 * The one rule both a disguised player and a map prop of the same shape go through:
 * if the two computed their fit separately, the smallest drift would tell a hunter
 * which crate is a player.
 */
export function fitModel(
  box: THREE.Box3,
  width: number,
  height: number,
  baseY: number,
  scaleMul: number,
): ModelFit {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = uniformFitScale(size, width, height, scaleMul);
  return {
    scale,
    offset: [-center.x * scale, baseY - box.min.y * scale, -center.z * scale],
  };
}
