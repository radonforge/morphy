import type { PropDefinition } from "@morphy/shared";
import { boxProp } from "./propDef";

const ur = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp("urban", id, name, w, h, color);

const rd = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp("urban/roads", id, name, w, h, color);

const ind = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp("urban/industrial", id, name, w, h, color);

const com = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp("urban/commercial", id, name, w, h, color);

/**
 * Urban hideables: the street furniture (planters, trees, fences, roadworks, yard
 * clutter) that dresses the sidewalks.
 *
 * Each width and height is derived from the GLB's own proportions, because the
 * client fits the model uniformly inside them while the server resolves hits
 * against the bounding cylinder they imply: a height that does not match the
 * model's aspect leaves air above it that a hunter can still hit.
 */
export const URBAN_CATALOG: PropDefinition[] = [
  ur("planter", "Planter", 1.1, 0.85, "#6f7a5a"),
  ur("tree-small", "Sapling", 1.1, 2.1, "#3f6b3a"),
  ur("tree-large", "Tree", 1.3, 2.9, "#3f6b3a"),
  ur("fence-1x2", "Fence", 1.2, 0.37, "#9a7b4d"),
  ur("fence-2x2", "Fence corner", 1.3, 0.4, "#9a7b4d"),
  rd("construction-cone", "Cone", 0.5, 0.7, "#e0712a"),
  rd("construction-barrier", "Barrier", 1.2, 0.9, "#d8d2c0"),
  rd("construction-light", "Work light", 0.5, 1.2, "#c8c2a8"),
  rd("bridge-pillar", "Pillar", 0.45, 2.25, "#a8a49a"),
  rd("bridge-pillar-wide", "Wide pillar", 0.6, 2.15, "#a8a49a"),
  ind("chimney-basic", "Chimney", 0.4, 2.0, "#8f6551"),
  ind("chimney-small", "Vent stack", 0.7, 1.75, "#8f6551"),
  ind("detail-tank", "Tank", 1.3, 0.65, "#8a93a0"),
  com("detail-parasol-a", "Parasol", 1.3, 1.45, "#b5503f"),
  com("detail-parasol-b", "Patio parasol", 1.3, 1.45, "#3f6f8a"),
];
