import type { PropDefinition } from "@webhunt/shared";

function obj(
  id: string,
  name: string,
  width: number,
  height: number,
  color: string,
): PropDefinition {
  return {
    id,
    name,
    model: `/models/space-station/${id}.glb`,
    parts: [
      {
        kind: "box",
        position: { x: 0, y: height / 2, z: 0 },
        size: { x: width, y: height, z: width },
        color,
      },
    ],
  };
}

export const SPACE_CATALOG: PropDefinition[] = [
  obj("chair", "Sedia", 0.9, 1.0, "#9aa3b0"),
  obj("bed-single", "Branda", 1.9, 0.6, "#c2c7d0"),
  obj("computer", "Computer", 0.9, 1.1, "#7f8a99"),
  obj("container", "Container", 1.0, 1.0, "#5f86a6"),
  obj("container-tall", "Container alto", 0.9, 1.7, "#5f86a6"),
  obj("container-wide", "Container largo", 1.7, 0.9, "#5f86a6"),
  obj("table", "Tavolo", 1.2, 0.85, "#b5895a"),
  obj("table-large", "Tavolo grande", 2.0, 0.9, "#b5895a"),
  obj("structure", "Struttura", 1.0, 1.4, "#8a93a0"),
  obj("rocks", "Rocce", 1.3, 0.7, "#7d7264"),
  obj("skip", "Cassone", 1.4, 1.1, "#9a7b3d"),
  obj("bed-double", "Letto doppio", 2.0, 0.6, "#c2c7d0"),
  obj("computer-wide", "Postazione", 1.4, 1.1, "#7f8a99"),
  obj("computer-system", "Server", 0.9, 1.6, "#6f7a89"),
  obj("table-display", "Espositore", 1.0, 1.1, "#b5895a"),
  obj("table-inset", "Banco", 1.3, 0.85, "#b5895a"),
  obj("container-flat", "Cassa bassa", 1.1, 0.5, "#5f86a6"),
  obj("chair-armrest", "Poltrona", 0.95, 1.0, "#9aa3b0"),
  obj("structure-barrier", "Barriera", 1.4, 1.1, "#8a93a0"),
];
