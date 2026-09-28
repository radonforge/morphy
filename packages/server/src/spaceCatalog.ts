import type { PropDefinition } from "@morphy/shared";
import { boxProp } from "./propDef";

const obj = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp("space/station", id, name, w, h, color);

const sk = (id: string, name: string, w: number, h: number, color: string): PropDefinition =>
  boxProp("space/exterior", id, name, w, h, color);

export const SPACE_CATALOG: PropDefinition[] = [
  obj("chair", "Chair", 0.9, 1.0, "#9aa3b0"),
  obj("bed-single", "Cot", 1.9, 0.6, "#c2c7d0"),
  obj("computer", "Computer", 0.9, 1.1, "#7f8a99"),
  obj("container", "Container", 1.0, 1.0, "#5f86a6"),
  obj("container-tall", "Tall container", 0.9, 1.7, "#5f86a6"),
  obj("container-wide", "Wide container", 1.7, 0.9, "#5f86a6"),
  obj("table", "Table", 1.2, 0.85, "#b5895a"),
  obj("table-large", "Large table", 2.0, 0.9, "#b5895a"),
  obj("structure", "Structure", 1.0, 1.4, "#8a93a0"),
  obj("skip", "Skip", 1.4, 1.1, "#9a7b3d"),
  obj("bed-double", "Double bed", 2.0, 0.6, "#c2c7d0"),
  obj("computer-wide", "Workstation", 1.4, 1.1, "#7f8a99"),
  obj("computer-system", "Server", 0.9, 1.6, "#6f7a89"),
  obj("table-display", "Display stand", 1.0, 1.1, "#b5895a"),
  obj("table-inset", "Counter", 1.3, 0.85, "#b5895a"),
  obj("container-flat", "Low crate", 1.1, 0.5, "#5f86a6"),
  obj("chair-armrest", "Armchair", 0.95, 1.0, "#9aa3b0"),
  obj("structure-barrier", "Barrier", 1.4, 1.1, "#8a93a0"),
  sk("barrel", "Barrel", 0.6, 0.9, "#b06a3a"),
  sk("barrels", "Barrels", 1.2, 0.95, "#b06a3a"),
  sk("machine_barrel", "Tank", 1.0, 1.3, "#8a93a0"),
  sk("machine_generator", "Generator", 1.1, 0.9, "#8a93a0"),
  sk("machine_wireless", "Antenna", 0.9, 1.4, "#8a93a0"),
  sk("desk_chair", "Stool", 0.7, 0.9, "#9aa3b0"),
  sk("desk_computer", "Terminal", 0.9, 1.0, "#7f8a99"),
  sk("desk_computerCorner", "Corner desk", 1.2, 1.0, "#7f8a99"),
];
