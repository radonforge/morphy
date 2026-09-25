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
  urban: {
    ground: "#5b5f66",
    background: "#acc6e0",
    hemiSky: "#d4e3f6",
    hemiGround: "#6a6f78",
    directional: 1.45,
  },
};

/**
 * Per-map tint for the lobby glass. Urban is a bright sky: a neutral tint over
 * it leaves panel text short of contrast, so each map carries its own density.
 */
export const MAP_GLASS: Record<MapId, string> = {
  station: "rgba(11, 18, 31, 0.55)",
  urban: "rgba(11, 19, 31, 0.82)",
};

/** Per-map lobby chrome: the accent every picker surface tints itself with, and its map glyph. */
export interface MapChrome {
  accent: string;
  glyph: string;
}

export const MAP_CHROME: Record<MapId, MapChrome> = {
  station: { accent: "var(--cyan)", glyph: "▣" },
  urban: { accent: "var(--steel)", glyph: "▦" },
};

/** Cyan of the materialize effect, shared by the in-game morph burst and the lobby carousel. */
export const MORPH_COLOR = "#7de8ff";
