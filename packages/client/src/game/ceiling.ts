import type { CeilingPanel } from "@morphy/shared";

/** A beam along one edge of a glass panel: centred on `x`/`z`, `length` long along `axis`, its underside at `y`. */
export interface CeilingRib {
  x: number;
  z: number;
  y: number;
  length: number;
  axis: "x" | "z";
}

/** The underside of the lowest panel covering `x`/`z`, or `null` under open sky. */
export function ceilingHeightAt(
  panels: readonly CeilingPanel[],
  x: number,
  z: number,
): number | null {
  let lowest: number | null = null;
  for (const panel of panels) {
    const half = panel.size / 2;
    if (Math.abs(x - panel.x) > half || Math.abs(z - panel.z) > half) continue;
    if (lowest === null || panel.y < lowest) lowest = panel.y;
  }
  return lowest;
}

/**
 * The lower ceiling over either end of a camera's reach, from its pivot at
 * `fromX`/`fromZ` to where it would sit at `toX`/`toZ`; `null` when both ends
 * are under open sky.
 */
export function ceilingBetween(
  panels: readonly CeilingPanel[],
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): number | null {
  const near = ceilingHeightAt(panels, fromX, fromZ);
  const far = ceilingHeightAt(panels, toX, toZ);
  if (near === null) return far;
  if (far === null) return near;
  return Math.min(near, far);
}

/**
 * How far a third-person camera may sit from its pivot along a direction that
 * rises by `dirY` per metre, so it stays `margin` under a ceiling at `ceilingY`
 * but never closer than `minDistance`. Unchanged under open sky or looking up.
 */
export function capUnderCeiling(
  distance: number,
  pivotY: number,
  dirY: number,
  ceilingY: number | null,
  margin: number,
  minDistance: number,
): number {
  if (ceilingY === null || dirY <= 0) return distance;
  const room = (ceilingY - margin - pivotY) / dirY;
  return Math.max(minDistance, Math.min(distance, room));
}

/** One beam per edge of every glass panel, an edge two panels share drawn once. */
export function glassRibs(panels: readonly CeilingPanel[]): CeilingRib[] {
  const ribs = new Map<string, CeilingRib>();
  for (const panel of panels) {
    if (panel.kind !== "glass") continue;
    const half = panel.size / 2;
    const edges: CeilingRib[] = [
      { x: panel.x, z: panel.z - half, y: panel.y, length: panel.size, axis: "x" },
      { x: panel.x, z: panel.z + half, y: panel.y, length: panel.size, axis: "x" },
      { x: panel.x - half, z: panel.z, y: panel.y, length: panel.size, axis: "z" },
      { x: panel.x + half, z: panel.z, y: panel.y, length: panel.size, axis: "z" },
    ];
    for (const rib of edges) {
      ribs.set(`${rib.axis}:${rib.x}:${rib.z}:${rib.y}`, rib);
    }
  }
  return [...ribs.values()];
}
