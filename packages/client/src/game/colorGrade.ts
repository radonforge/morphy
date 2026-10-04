/** An RGB triple in display (sRGB-encoded) units, each channel in [0, 1]. */
export type Rgb = readonly [number, number, number];

/**
 * A map's colour grade, applied to the tone-mapped frame in display units:
 * `lift` raises the shadows towards a tint, `gain` scales the highlights,
 * `contrast` pivots around mid grey and `saturation` scales the distance from
 * the pixel's luma. The identity grade is lift 0, gain 1, contrast 1, saturation 1.
 */
export interface ColorGrade {
  lift: Rgb;
  gain: Rgb;
  contrast: number;
  saturation: number;
}

const MID_GREY = 0.5;
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;
const RGBA = 4;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** One colour through the grade, the per-texel function the lookup table bakes. */
export function gradeColor(rgb: Rgb, grade: ColorGrade): Rgb {
  const channel = (c: number, lift: number, gain: number) =>
    (c * gain + lift * (1 - c) - MID_GREY) * grade.contrast + MID_GREY;
  const r = channel(rgb[0], grade.lift[0], grade.gain[0]);
  const g = channel(rgb[1], grade.lift[1], grade.gain[1]);
  const b = channel(rgb[2], grade.lift[2], grade.gain[2]);
  const luma = r * LUMA_R + g * LUMA_G + b * LUMA_B;
  const saturate = (c: number) => clamp01(luma + (c - luma) * grade.saturation);
  return [saturate(r), saturate(g), saturate(b)];
}

/**
 * RGBA texels of a `size`-cubed lookup table for the grade, red fastest and blue
 * slowest, the layout `LookupTexture` in `postprocessing` samples.
 */
export function gradeLutData(size: number, grade: ColorGrade): Float32Array {
  const data = new Float32Array(size ** 3 * RGBA);
  const step = 1 / (size - 1);
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const at = (r + g * size + b * size * size) * RGBA;
        const [gr, gg, gb] = gradeColor([r * step, g * step, b * step], grade);
        data[at] = gr;
        data[at + 1] = gg;
        data[at + 2] = gb;
        data[at + 3] = 1;
      }
    }
  }
  return data;
}
