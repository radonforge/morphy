import { SLICE_SLANT, type SliceShape, sliceShape } from "./worldSlices";

/**
 * The Options slice: a panel cut from the right of the screen whose left edge is a world slice
 * edge, the same lean and the same arithmetic, so it reads as one more slice over the worlds
 * rather than a card with its own angle.
 */

/** How much of the screen's width the slice covers, measured at mid-height. */
export const OPTIONS_SLICE_WIDTH = 0.58;

/** The narrowest the slice gets, in CSS pixels; a screen narrower than this is covered whole. */
export const OPTIONS_SLICE_MIN_PX = 600;

export interface OptionsSliceGeometry {
  shape: SliceShape;
  /** Where the slanted edge crosses mid-height, in pixels from the screen's left. */
  edgeMid: number;
  /** How far the edge leans right toward the top, in degrees from vertical. */
  leanDeg: number;
}

const RADIANS_TO_DEGREES = 180 / Math.PI;

/** The fraction of the width the slice covers on a screen `width` pixels wide. */
export function optionsSliceFraction(width: number): number {
  if (width <= 0) return 1;
  return Math.min(1, Math.max(OPTIONS_SLICE_WIDTH, OPTIONS_SLICE_MIN_PX / width));
}

/**
 * The slice on a `width` by `height` screen: the last of two world slices whose shared edge sits
 * where the slice begins, so its polygon, clip path and lean all come from `sliceShape`. A slice
 * covering the whole width has no edge on screen and no lean.
 */
export function optionsSliceGeometry(width: number, height: number): OptionsSliceGeometry {
  const fraction = optionsSliceFraction(width);
  if (fraction >= 1) {
    return {
      shape: sliceShape({ edges: [], openness: [1] }, 0, width, height),
      edgeMid: 0,
      leanDeg: 0,
    };
  }
  const edge = 1 - fraction;
  const shape = sliceShape({ edges: [edge], openness: [0, 1] }, 1, width, height);
  const leanDeg = height > 0 ? Math.atan((SLICE_SLANT * width) / height) * RADIANS_TO_DEGREES : 0;
  return { shape, edgeMid: edge * width, leanDeg };
}
