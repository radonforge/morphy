import type { MapId } from "@morphy/shared";

/** Shared palette anchors; lobby and game add intentional lighting/atmosphere overrides. */
export interface MapThemeBase {
  ground: string;
  background: string;
  hemiSky: string;
  hemiGround: string;
  directional: number;
}

export const MAP_THEME_BASE: Record<MapId, MapThemeBase> = {
  station: {
    ground: "#3a414e",
    background: "#0e131b",
    hemiSky: "#b8c8de",
    hemiGround: "#42474f",
    directional: 1.15,
  },
  mars: {
    ground: "#9c5a40",
    background: "#c89a78",
    hemiSky: "#e8b48f",
    hemiGround: "#5a3a2c",
    directional: 1.5,
  },
  urban: {
    ground: "#5b5f66",
    background: "#acc6e0",
    hemiSky: "#d4e3f6",
    hemiGround: "#6a6f78",
    directional: 1.45,
  },
};
