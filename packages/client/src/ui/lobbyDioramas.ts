import { DECK_LIGHT_HEIGHT, type StreetLamp, streetLamp, TILE, WALL_HEIGHT } from "@morphy/level";
import type { CeilingPanel, MapDefinition, MapId } from "@morphy/shared";

/**
 * Where the avatar stands across the stage: right of centre, so the open slice's name and Play
 * have the left of the frame to themselves. The stage stands it here and each world hangs its
 * fill light over it.
 */
export const AVATAR_SLOT_X = 1.35;

export interface SetPiece {
  url: string;
  position: [number, number, number];
  rotationY?: number;
  scale?: number;
}

const mod = (name: string): string => `/models/space/modular/${name}.glb`;
const sta = (name: string): string => `/models/space/station/${name}.glb`;
const urb = (name: string): string => `/models/urban/${name}.glb`;

const NORTH_LAMP_SCALE = 6;

/** The street lamps of the North District stage, by pole, arm turned out over the pavement. */
const NORTH_LAMPS: StreetLamp[] = [
  streetLamp("curved", 1.4, -3.5, Math.PI, NORTH_LAMP_SCALE),
  streetLamp("curved", 6.6, -3.5, Math.PI, NORTH_LAMP_SCALE),
];

/** A lamp's set piece: `position` is the footprint centre, which the arm pulls off the pole. */
function lampPiece({ scenery, centre }: StreetLamp): SetPiece {
  return {
    url: scenery.model,
    position: [centre.x, 0, centre.z],
    rotationY: scenery.rotationY,
    scale: scenery.scale,
  };
}

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
    { url: urb("roads/road-straight"), position: [4, -0.05, -5], rotationY: Math.PI / 2, scale: 4 },
    { url: urb("roads/road-straight"), position: [4, -0.05, -9], rotationY: Math.PI / 2, scale: 4 },
    {
      url: urb("roads/road-straight"),
      position: [4, -0.05, -13],
      rotationY: Math.PI / 2,
      scale: 4,
    },
    {
      url: urb("roads/road-straight"),
      position: [4, -0.05, -17],
      rotationY: Math.PI / 2,
      scale: 4,
    },
    {
      url: urb("roads/road-straight"),
      position: [4, -0.05, -21],
      rotationY: Math.PI / 2,
      scale: 4,
    },
    { url: urb("commercial/building-g"), position: [-13, 0, -6.87], scale: 6 },
    { url: urb("commercial/building-a"), position: [-7.6, 0, -7.4], scale: 6 },
    { url: urb("commercial/building-d"), position: [-2.4, 0, -6.8], scale: 6 },
    { url: urb("commercial/building-l"), position: [-2.6, 0, -15], scale: 6 },
    { url: urb("commercial/building-h"), position: [9.4, 0, -7.13], scale: 6 },
    { url: urb("commercial/building-c"), position: [14.6, 0, -7.37], scale: 6 },
    { url: urb("commercial/building-f"), position: [9.4, 0, -13.4], scale: 6 },
    { url: urb("commercial/building-skyscraper-a"), position: [4, 0, -28], scale: 6 },
    { url: urb("tree-large"), position: [-13, 0, -3], scale: 6 },
    { url: urb("tree-large"), position: [-9, 0, -3], scale: 6 },
    { url: urb("tree-large"), position: [-5, 0, -3], scale: 6 },
    { url: urb("tree-small"), position: [1.1, 0, -5.5], scale: 6 },
    { url: urb("tree-small"), position: [6.1, 0, -7.5], scale: 6 },
    { url: urb("tree-small"), position: [6.1, 0, -11.5], scale: 6 },
    ...NORTH_LAMPS.map(lampPiece),
    { url: urb("tree-large"), position: [10, 0, -3], scale: 6 },
    { url: urb("tree-large"), position: [14, 0, -3], scale: 6 },
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

/**
 * What hangs over a diorama besides its set pieces: deck lights and the fill on the actors,
 * a ceiling, and the street lamps a night stage lights. A day/night map hangs `nightLights`
 * instead of `lights` when the lobby drew night; any other map has none.
 */
export interface StageDressing {
  lights: StageLight[];
  nightLights: StageLight[] | null;
  ceiling: CeilingPanel[];
  street: Pick<MapDefinition, "scenery" | "lights"> | null;
}

const STATION_SCALE = 1.25;
const STATION_PANEL = TILE * STATION_SCALE;
const STATION_CEILING_Y = WALL_HEIGHT * STATION_SCALE;
/**
 * The match's deck light height at the stage's scale, with every lamp clear of the set pieces:
 * the nearest surface gets about 5 times the floor's light, as the match's beams do.
 */
const STATION_LAMP_Y = DECK_LIGHT_HEIGHT * STATION_SCALE;
const STATION_PANEL_XS = [-15, -10, -5, 0, 5, 10, 15];
const STATION_PANEL_ZS = [-10.5, -5.5, -0.5];
const WARM = "#ffc27a";
const COOL = "#8ad8ff";

export const LOBBY_DRESSING: Record<MapId, StageDressing> = {
  station: {
    lights: [
      { position: [-8.5, STATION_LAMP_Y, -6], color: WARM, intensity: 25, distance: 16 },
      {
        position: [7.5, STATION_LAMP_Y, -5],
        color: WARM,
        intensity: 25,
        distance: 16,
        flicker: true,
      },
      { position: [0, STATION_LAMP_Y, -8.5], color: COOL, intensity: 7, distance: 10 },
      { position: [2.6, 3.2, -9.4], color: COOL, intensity: 5, distance: 7, bare: true },
      {
        position: [AVATAR_SLOT_X, 3, 3.5],
        color: "#fff1e0",
        intensity: 14,
        distance: 9,
        bare: true,
      },
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
    nightLights: null,
    street: null,
  },
  urban: {
    lights: [
      {
        position: [AVATAR_SLOT_X, 3, 3.5],
        color: "#ffe8cc",
        intensity: 10,
        distance: 9,
        bare: true,
      },
    ],
    nightLights: [
      {
        position: [AVATAR_SLOT_X, 3, 3.5],
        color: "#ffd9b0",
        intensity: 24,
        distance: 6,
        bare: true,
      },
    ],
    ceiling: [],
    street: {
      scenery: NORTH_LAMPS.map((lamp) => lamp.scenery),
      lights: NORTH_LAMPS.map((lamp, index) => ({
        id: `lamp-${index}`,
        kind: "corridor",
        ...lamp.head,
      })),
    },
  },
};

export const LOBBY_DIORAMA_MODEL_PATHS = [
  ...new Set(Object.values(LOBBY_DIORAMAS).flatMap((pieces) => pieces.map((piece) => piece.url))),
];
