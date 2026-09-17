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
    { url: mod("gate-door-window"), position: [0, 0, -11] },
    { url: mod("template-wall"), position: [-4, 0, -11.5] },
    { url: mod("template-wall"), position: [4, 0, -11.5] },
    { url: mod("template-wall-top"), position: [-8, 0, -11.39] },
    { url: mod("template-wall-top"), position: [8, 0, -11.39] },
    { url: mod("template-wall"), position: [-12, 0, -11.5] },
    { url: mod("template-wall"), position: [12, 0, -11.5] },
    { url: mod("template-wall"), position: [-16, 0, -11.5] },
    { url: mod("template-wall"), position: [16, 0, -11.5] },
    { url: mod("template-detail"), position: [-10, 0, -8] },
    { url: mod("template-detail"), position: [10, 0, -8] },
    { url: mod("cables"), position: [-6.59, 0, -9.78] },
    { url: mod("cables"), position: [5.52, 0, -9.81], rotationY: 1.6 },
    { url: sta("container-tall"), position: [-3.4, 0, -5.2], rotationY: 0.4, scale: 2.4 },
    { url: sta("container-wide"), position: [-4.6, 0, -6.4], rotationY: -0.2, scale: 2.4 },
    { url: sta("container"), position: [-2.5, 0, -6.8], rotationY: 0.9, scale: 2.4 },
    { url: sta("skip"), position: [-6.2, 0, -4.8], rotationY: 0.7, scale: 2.4 },
    { url: sta("computer-wide"), position: [3.56, 0, -5.93], rotationY: -0.55, scale: 2.6 },
    { url: sta("chair"), position: [4.8, 0, -5], rotationY: -2.4, scale: 2.6 },
    { url: sta("table-display-planet"), position: [6.47, 0, -9.42], rotationY: -0.8, scale: 3.2 },
    { url: sta("rocks"), position: [-7.44, 0, -0.78], rotationY: 0.8, scale: 2.4 },
    { url: sta("skip"), position: [-9.6, 0, -4.4], rotationY: 0.5, scale: 2.4 },
    { url: sta("container-wide"), position: [-9.2, 0, -6], rotationY: 0.25, scale: 2.4 },
    { url: sta("container"), position: [-11, 0, -7.4], rotationY: -0.3, scale: 2.4 },
    { url: sta("table-large"), position: [-12.8, 0, -9], rotationY: 0.2, scale: 2.6 },
    { url: sta("rail"), position: [1.8, 0, -7.9], rotationY: 1.57, scale: 2.4 },
    { url: sta("skip-rocks"), position: [8, 0, -3.4], rotationY: -0.6, scale: 2.4 },
    { url: sta("container-tall"), position: [9.8, 0, -5.8], rotationY: -0.4, scale: 2.4 },
    { url: sta("container-flat"), position: [11.47, 0, -7.6], rotationY: 0.2, scale: 2.4 },
    { url: sta("structure-barrier"), position: [13.4, 0, -9.2], rotationY: -0.15, scale: 2.4 },
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
    { url: urb("roads/road-straight"), position: [-8, -0.05, -1], scale: 4 },
    { url: urb("roads/road-straight"), position: [-4, -0.05, -1], scale: 4 },
    { url: urb("roads/road-crossing"), position: [0, -0.05, -1], scale: 4 },
    { url: urb("roads/road-straight"), position: [4, -0.05, -1], scale: 4 },
    { url: urb("roads/road-straight"), position: [8, -0.05, -1], scale: 4 },
    { url: urb("commercial/building-g"), position: [-11.1, 0, -10.3], scale: 6 },
    { url: urb("commercial/building-a"), position: [-5.5, 0, -10], scale: 6 },
    { url: urb("commercial/building-d"), position: [-0.4, 0, -10.2], scale: 6 },
    { url: urb("commercial/building-skyscraper-a"), position: [6.2, 0, -10], scale: 6 },
    { url: urb("commercial/building-h"), position: [12.9, 0, -10.3], scale: 6 },
    { url: urb("roads/light-curved"), position: [-8, 0, -3.67], rotationY: Math.PI, scale: 6 },
    { url: urb("roads/light-curved"), position: [6, 0, -3.67], rotationY: Math.PI, scale: 6 },
    { url: urb("tree-large"), position: [-11.5, 0, -4.6], scale: 6 },
    { url: urb("tree-small"), position: [10.5, 0, -4.6], rotationY: 0.8, scale: 6 },
    { url: urb("planter"), position: [2.5, 0, -4.4], rotationY: -0.2, scale: 6 },
    { url: urb("roads/construction-cone"), position: [-4.6, 0, -2.2], scale: 6 },
    { url: urb("roads/construction-cone"), position: [-5.3, 0, -2.7], scale: 6 },
  ],
};

export const LOBBY_DIORAMA_MODEL_PATHS = [
  ...new Set(Object.values(LOBBY_DIORAMAS).flatMap((pieces) => pieces.map((piece) => piece.url))),
];
