import type { PropDefinition } from "@webhunt/shared";
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
  ex("rock", "Roccia", 1.1, 0.9, "#7a5240"),
  ex("rocks_smallA", "Sassi", 0.9, 0.5, "#7a5240"),
  ex("rocks_smallB", "Detriti", 0.9, 0.5, "#6e4c3a"),
  ex("meteor", "Meteorite", 1.0, 0.85, "#6e6258"),
  ex("meteor_detailed", "Meteorite roccioso", 1.2, 0.95, "#6e6258"),
  ex("meteor_half", "Frammento", 1.1, 0.5, "#6e6258"),
  ex("barrel", "Barile", 0.6, 0.9, "#b06a3a"),
  ex("barrels", "Barili", 1.2, 0.95, "#b06a3a"),
  ex("barrels_rail", "Barili su rastrelliera", 1.5, 0.95, "#a8632f"),
  ex("bones", "Ossa", 1.1, 0.4, "#d8d2c0"),
  ex("machine_barrel", "Cisterna", 1.0, 1.3, "#8a93a0"),
  ex("machine_generator", "Generatore", 1.1, 0.9, "#8a93a0"),
  ex("machine_wireless", "Antenna", 0.9, 1.4, "#8a93a0"),
  ex("rover", "Rover", 1.7, 1.0, "#9a7b3d"),
  st("container", "Container", 1.0, 1.0, "#5f86a6"),
  st("container-flat", "Cassa bassa", 1.1, 0.5, "#5f86a6"),
  st("skip", "Cassone", 1.4, 1.1, "#9a7b3d"),
];
