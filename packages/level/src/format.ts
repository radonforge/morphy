import type { LevelPoint } from "./document";

const DECIMALS = 2;

/** A number rounded to centimetres, without trailing zeros. */
export function num(value: number): string {
  const rounded = Number(value.toFixed(DECIMALS));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** A floor point as `(x, z)`. */
export function point(p: LevelPoint): string {
  return `(${num(p.x)}, ${num(p.z)})`;
}

/** A yaw in radians as whole degrees. */
export function degrees(yaw: number): string {
  return num((yaw * 180) / Math.PI);
}
