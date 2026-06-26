import type { PropDefinition } from "@webhunt/shared";
import { boxProp } from "./propDef";

const ch = (id: string, name: string): PropDefinition =>
  boxProp("characters", id, name, 0.9, 1.5, "#c9a27a");

const ur = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp("urban", id, name, w, h, color);

const rd = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp("urban/roads", id, name, w, h, color);

/**
 * Urban hideables: the crowd of pedestrians a morphed player melts into, plus the
 * street furniture (planters, trees, fences, roadworks) that dresses the sidewalks.
 */
export const URBAN_CATALOG: PropDefinition[] = [
  ch("character-male-a", "Passante"),
  ch("character-male-b", "Passante"),
  ch("character-male-c", "Passante"),
  ch("character-male-d", "Passante"),
  ch("character-male-e", "Passante"),
  ch("character-male-f", "Passante"),
  ch("character-female-a", "Passante"),
  ch("character-female-b", "Passante"),
  ch("character-female-c", "Passante"),
  ch("character-female-d", "Passante"),
  ch("character-female-e", "Passante"),
  ch("character-female-f", "Passante"),
  ur("planter", "Fioriera", 1.1, 0.85, "#6f7a5a"),
  ur("tree-small", "Alberello", 1.1, 2.1, "#3f6b3a"),
  ur("tree-large", "Albero", 1.3, 2.9, "#3f6b3a"),
  ur("fence-1x2", "Staccionata", 1.2, 1.0, "#9a7b4d"),
  rd("construction-cone", "Cono", 0.5, 0.7, "#e0712a"),
  rd("construction-barrier", "Transenna", 1.2, 0.9, "#d8d2c0"),
  rd("construction-light", "Faro cantiere", 0.5, 1.2, "#c8c2a8"),
];
