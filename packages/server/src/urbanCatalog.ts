import type { PropDefinition } from "@morphy/shared";
import { boxProp } from "./propDef";

const ur = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp("urban", id, name, w, h, color);

const rd = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp("urban/roads", id, name, w, h, color);

/**
 * Urban hideables: the street furniture (planters, trees, fences, roadworks) that
 * dresses the sidewalks.
 */
export const URBAN_CATALOG: PropDefinition[] = [
  ur("planter", "Planter", 1.1, 0.85, "#6f7a5a"),
  ur("tree-small", "Sapling", 1.1, 2.1, "#3f6b3a"),
  ur("tree-large", "Tree", 1.3, 2.9, "#3f6b3a"),
  ur("fence-1x2", "Fence", 1.2, 1.0, "#9a7b4d"),
  rd("construction-cone", "Cone", 0.5, 0.7, "#e0712a"),
  rd("construction-barrier", "Barrier", 1.2, 0.9, "#d8d2c0"),
  rd("construction-light", "Work light", 0.5, 1.2, "#c8c2a8"),
];
