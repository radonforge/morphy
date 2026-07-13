import type { PropDefinition } from "@morphy/shared";
import { boxProp } from "./propDef";

const ex = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp("space/exterior", id, name, w, h, color);

const st = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp("space/station", id, name, w, h, color);

/**
 * Hideables for the open Martian apron: rocks, meteors, barrels, supply crates and
 * field machinery. A morphed player blends into the scatter of identical-looking
 * debris dressing the surface.
 */
export const MARS_CATALOG: PropDefinition[] = [
  ex("rock", "Rock", 1.1, 0.9, "#7a5240"),
  ex("rocks_smallA", "Pebbles", 0.9, 0.5, "#7a5240"),
  ex("rocks_smallB", "Debris", 0.9, 0.5, "#6e4c3a"),
  ex("meteor", "Meteor", 1.0, 0.85, "#6e6258"),
  ex("meteor_detailed", "Rocky meteor", 1.2, 0.95, "#6e6258"),
  ex("meteor_half", "Fragment", 1.1, 0.5, "#6e6258"),
  ex("barrel", "Barrel", 0.6, 0.9, "#b06a3a"),
  ex("barrels", "Barrels", 1.2, 0.95, "#b06a3a"),
  ex("barrels_rail", "Racked barrels", 1.5, 0.95, "#a8632f"),
  ex("bones", "Bones", 1.1, 0.4, "#d8d2c0"),
  ex("machine_barrel", "Tank", 1.0, 1.3, "#8a93a0"),
  ex("machine_generator", "Generator", 1.1, 0.9, "#8a93a0"),
  ex("machine_wireless", "Antenna", 0.9, 1.4, "#8a93a0"),
  ex("rover", "Rover", 1.7, 1.0, "#9a7b3d"),
  st("container", "Container", 1.0, 1.0, "#5f86a6"),
  st("container-flat", "Low crate", 1.1, 0.5, "#5f86a6"),
  st("skip", "Skip", 1.4, 1.1, "#9a7b3d"),
];
