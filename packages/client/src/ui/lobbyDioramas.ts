import type { MapId } from "@morphy/shared";

export interface SetPiece {
  url: string;
  position: [number, number, number];
  rotationY?: number;
  scale?: number;
}

const mod = (name: string): string => `/models/space/modular/${name}.glb`;
const sta = (name: string): string => `/models/space/station/${name}.glb`;
const ext = (name: string): string => `/models/space/exterior/${name}.glb`;
const urb = (name: string): string => `/models/urban/${name}.glb`;

/** Model set pieces rendered behind the lobby for each selected map. */
export const LOBBY_DIORAMAS: Record<MapId, SetPiece[]> = {
  station: [
    { url: mod("gate-door-window"), position: [0, 0, -12.75], scale: 1.25 },
    { url: mod("template-wall"), position: [-5.125, 0, -13], scale: 1.25 },
    { url: mod("template-wall"), position: [5.125, 0, -13], scale: 1.25 },
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
  mars: [
    { url: ext("hangar_roundA"), position: [-7, 0, -16], scale: 3 },
    { url: ext("chimney_detailed"), position: [0.1, 0, -17.5], scale: 2.2 },
    { url: ext("satelliteDish_large"), position: [-9.5, 0, -9.5], scale: 2 },
    { url: ext("machine_wireless"), position: [-10, 0, -7.5], scale: 2.2 },
    { url: ext("barrels"), position: [-4.5, 0, -9], scale: 2.2 },
    { url: ext("rocket_baseA"), position: [6, 0, -13], scale: 2.4 },
    { url: ext("rocket_sidesA"), position: [6, 3.84, -13], scale: 2.4 },
    { url: ext("rocket_topA"), position: [6, 6.24, -13], scale: 2.4 },
    { url: ext("rocket_fuelA"), position: [9.8, 0, -14], scale: 2.4 },
    { url: ext("barrel"), position: [4.3, 0, -10.2], scale: 2.2 },
    { url: ext("rover"), position: [3.3, 0, -9], scale: 2 },
    { url: ext("astronautA"), position: [2.2, 0, -8.8], scale: 1.6 },
    { url: ext("meteor_half"), position: [-7, 0, -6], rotationY: 1.1, scale: 1.8 },
    { url: ext("rock_largeA"), position: [-10.5, 0, -4.5], rotationY: 1.2, scale: 2.5 },
    { url: ext("rocks_smallB"), position: [8.5, 0, -4.2], rotationY: 0.4, scale: 2.5 },
    { url: ext("rocks_smallA"), position: [1, 0, -3.5], rotationY: 0.7, scale: 2.5 },
    { url: ext("craterLarge"), position: [-5, 0, -2.5], rotationY: 0.5, scale: 3.5 },
    { url: ext("crater"), position: [7, 0, -3.5], rotationY: 1.8, scale: 3 },
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

export const LOBBY_DIORAMA_MODEL_PATHS = [
  ...new Set(Object.values(LOBBY_DIORAMAS).flatMap((pieces) => pieces.map((piece) => piece.url))),
];
