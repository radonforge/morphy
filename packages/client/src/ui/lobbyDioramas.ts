import { TILE, WALL_HEIGHT } from "@morphy/level";
import type { CeilingPanel, MapId } from "@morphy/shared";

export interface SetPiece {
  url: string;
  position: [number, number, number];
  rotationY?: number;
  scale?: number;
}

const mod = (name: string): string => `/models/space/modular/${name}.glb`;
const sta = (name: string): string => `/models/space/station/${name}.glb`;
const urb = (name: string): string => `/models/urban/${name}.glb`;

/** Model set pieces rendered behind the lobby for each selected map. */
const STATION_FLOOR_XS = [-15, -10, -5, 0, 5, 10, 15];
const STATION_FLOOR_ZS = [-10.5, -5.5, -0.5, 4.5];
const STATION_FLOOR_Y = 0.02;

export const LOBBY_DIORAMAS: Record<MapId, SetPiece[]> = {
  station: [
    ...STATION_FLOOR_XS.flatMap((x) =>
      STATION_FLOOR_ZS.map((z) => ({
        url: mod("template-floor"),
        position: [x, STATION_FLOOR_Y, z] as [number, number, number],
        scale: 1.25,
      })),
    ),
    { url: mod("gate-door-window"), position: [0, 0, -12.75], scale: 1.25 },
    { url: sta("wall-window"), position: [-5.125, 0, -13.6], scale: 5.3 },
    { url: sta("wall-window"), position: [5.125, 0, -13.6], scale: 5.3 },
    { url: sta("table-display-planet"), position: [2.6, 0, -9.4], scale: 4.5 },
    { url: mod("template-wall"), position: [-10.125, 0, -13], scale: 1.25 },
    { url: mod("template-wall"), position: [10.125, 0, -13], scale: 1.25 },
    { url: mod("template-wall"), position: [-15.125, 0, -13], scale: 1.25 },
    { url: mod("template-wall"), position: [15.125, 0, -13], scale: 1.25 },
    { url: sta("rail"), position: [-4.2, 0, -7.2], rotationY: Math.PI / 2, scale: 2.8 },
    { url: sta("rail"), position: [-4.2, 0, -10.1], rotationY: Math.PI / 2, scale: 2.8 },
    { url: sta("rail"), position: [4.2, 0, -7.2], rotationY: Math.PI / 2, scale: 2.8 },
    { url: sta("rail"), position: [4.2, 0, -10.1], rotationY: Math.PI / 2, scale: 2.8 },
    { url: sta("container-tall"), position: [-9.6, 0, -10.6], scale: 2.8 },
    { url: sta("container-wide"), position: [-9.6, 2.52, -10.6], scale: 2.8 },
    { url: sta("container-tall"), position: [-7.8, 0, -10.6], scale: 2.8 },
    { url: sta("container-flat"), position: [-11.4, 0, -9], scale: 2.8 },
    { url: sta("skip"), position: [-6.4, 0, -7.4], scale: 2.8 },
    { url: sta("container-tall"), position: [12, 0, -10.8], scale: 2.8 },
    { url: sta("container-wide"), position: [12, 2.52, -10.8], scale: 2.8 },
    { url: sta("computer-wide"), position: [7.4, 0, -10], scale: 2.8 },
    { url: sta("chair"), position: [7.4, 0, -8.4], rotationY: Math.PI, scale: 2.8 },
    { url: sta("structure-barrier"), position: [9.8, 0, -7.4], scale: 2.8 },
  ],
  urban: [
    { url: urb("roads/road-side"), position: [-12, -0.05, -1], scale: 4 },
    { url: urb("roads/road-side"), position: [-8, -0.05, -1], scale: 4 },
    { url: urb("roads/road-side"), position: [-4, -0.05, -1], scale: 4 },
    { url: urb("roads/road-side"), position: [0, -0.05, -1], scale: 4 },
    { url: urb("roads/road-side"), position: [4, -0.05, -1], scale: 4 },
    { url: urb("roads/road-side"), position: [8, -0.05, -1], scale: 4 },
    { url: urb("roads/road-side"), position: [12, -0.05, -1], scale: 4 },
    { url: urb("commercial/building-g"), position: [-12.99, 0, -6.87], scale: 6 },
    { url: urb("commercial/building-a"), position: [-7.43, 0, -6.92], scale: 6 },
    { url: urb("commercial/building-d"), position: [-2.26, 0, -6.8], scale: 6 },
    { url: urb("commercial/building-c"), position: [2.91, 0, -7.37], scale: 6 },
    { url: urb("commercial/building-f"), position: [8.08, 0, -7.19], scale: 6 },
    { url: urb("commercial/building-h"), position: [13.25, 0, -7.13], scale: 6 },
    { url: urb("commercial/building-l"), position: [2.5, 0, -16], scale: 6 },
    { url: urb("roads/light-curved"), position: [-10, 0, -3], rotationY: Math.PI, scale: 6 },
    { url: urb("tree-large"), position: [-7.6, 0, -3], scale: 6 },
    { url: urb("planter"), position: [-5.9, 0, -3], scale: 4 },
    { url: urb("commercial/detail-parasol-a"), position: [-4.2, 0, -4], scale: 4 },
    { url: urb("fence-1x2"), position: [-3.4, 0, -3.2], scale: 3 },
    { url: urb("industrial/detail-tank"), position: [1.7, 0, -3.4], rotationY: 0.5, scale: 2 },
    { url: urb("commercial/detail-parasol-b"), position: [4.2, 0, -4], scale: 4 },
    { url: urb("tree-small"), position: [5.3, 0, -3], scale: 6 },
    { url: urb("roads/construction-cone"), position: [6.6, 0, -2.3], scale: 6 },
    { url: urb("roads/construction-light"), position: [7.4, 0, -3], scale: 6 },
    {
      url: urb("roads/construction-barrier"),
      position: [7.4, 0, -2.1],
      rotationY: Math.PI / 2,
      scale: 6,
    },
    { url: urb("roads/construction-cone"), position: [8.2, 0, -2.3], scale: 6 },
    { url: urb("roads/light-curved"), position: [9.9, 0, -3], rotationY: Math.PI, scale: 6 },
  ],
};

export interface StageLight {
  position: [number, number, number];
  color: string;
  intensity: number;
  distance: number;
  flicker?: boolean;
  /** No lamp panel: a glow from a hologram, or fill light on the actors. */
  bare?: boolean;
}

/** What hangs over a diorama besides its set pieces: deck lights and a ceiling. */
export interface StageDressing {
  lights: StageLight[];
  ceiling: CeilingPanel[];
}

const STATION_SCALE = 1.25;
const STATION_PANEL = TILE * STATION_SCALE;
const STATION_CEILING_Y = WALL_HEIGHT * STATION_SCALE;
const STATION_LAMP_Y = STATION_CEILING_Y - 0.9;
const STATION_PANEL_XS = [-15, -10, -5, 0, 5, 10, 15];
const STATION_PANEL_ZS = [-10.5, -5.5, -0.5];
const WARM = "#ffc27a";
const COOL = "#8ad8ff";

export const LOBBY_DRESSING: Record<MapId, StageDressing> = {
  station: {
    lights: [
      { position: [-8.5, STATION_LAMP_Y, -8], color: WARM, intensity: 34, distance: 16 },
      {
        position: [9, STATION_LAMP_Y, -8],
        color: WARM,
        intensity: 34,
        distance: 16,
        flicker: true,
      },
      { position: [0, STATION_LAMP_Y, -10.5], color: COOL, intensity: 10, distance: 10 },
      { position: [2.6, 2.6, -9.4], color: COOL, intensity: 12, distance: 7, bare: true },
      { position: [-1.35, 3, 3.5], color: "#fff1e0", intensity: 14, distance: 9, bare: true },
    ],
    ceiling: STATION_PANEL_XS.flatMap((x) =>
      STATION_PANEL_ZS.map((z) => ({
        x,
        z,
        y: STATION_CEILING_Y,
        size: STATION_PANEL,
        kind: "glass" as const,
      })),
    ),
  },
  urban: { lights: [], ceiling: [] },
};

export const LOBBY_DIORAMA_MODEL_PATHS = [
  ...new Set(Object.values(LOBBY_DIORAMAS).flatMap((pieces) => pieces.map((piece) => piece.url))),
];
