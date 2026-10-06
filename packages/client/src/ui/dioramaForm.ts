const PIECE_FORM_S = 0.35;
const STAGGER_WINDOW_S = 0.45;
const FORM_DELAY_S = 0.25;

/**
 * How long a world takes to form once its models have loaded, first piece to last. The stage
 * derives its shadow settle and its motion boost from this one number rather than keeping its
 * own: a boost that ends early drops the tail of the sweep to 30 fps, and a shadow map that
 * freezes early bakes a world that is half built.
 */
export const DIORAMA_FORM_S = FORM_DELAY_S + STAGGER_WINDOW_S + PIECE_FORM_S;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Scale of set piece `index` of `count`, `age` seconds after its world's models loaded, or null
 * while they are still loading. Staggered across the sweep so a world arrives as matter forming
 * rather than a block appearing.
 */
export function pieceScale(age: number | null, index: number, count: number): number {
  if (age === null) return 0;
  if (age >= DIORAMA_FORM_S) return 1;
  const stagger = count <= 1 ? 0 : (index / (count - 1)) * STAGGER_WINDOW_S;
  return clamp01((age - FORM_DELAY_S - stagger) / PIECE_FORM_S);
}
