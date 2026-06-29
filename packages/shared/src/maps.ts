/** Metadata for a selectable map, shown in the lobby picker. */
export interface MapInfo {
  /** Stable identifier sent as the `map` join option and matched server-side. */
  id: string;
  /** Display name shown on the lobby card and in the HUD. */
  name: string;
  /** Theme key driving optional per-map lighting/sky presets on the client. */
  theme: string;
  /** One-line pitch for the lobby card. */
  blurb: string;
}

/**
 * The hand-authored maps a player can pick from in the lobby. The client reads
 * this directly to render the picker (no server round-trip); the server keys its
 * builder registry on these ids. Adding an entry forces a matching builder in
 * `MAP_BUILDERS` (typed `Record<MapId, …>`).
 */
export const MAP_CATALOG = [
  {
    id: "station",
    name: "Kepler-9 Station",
    theme: "station",
    blurb: "Pressurized modules and tight corridors: blend in among furniture and containers.",
  },
  {
    id: "mars",
    name: "Ares Outpost",
    theme: "mars",
    blurb: "Open-air Martian apron around a small base: little cover, long sightlines.",
  },
  {
    id: "urban",
    name: "North District",
    theme: "urban",
    blurb: "Blocks and streets: blend in with the neighborhood's pedestrians.",
  },
] as const satisfies readonly MapInfo[];

export type MapId = (typeof MAP_CATALOG)[number]["id"];

export const DEFAULT_MAP_ID: MapId = "station";

/** Narrow an untrusted join option to a known map id (boundary validation). */
export function isMapId(value: unknown): value is MapId {
  return typeof value === "string" && MAP_CATALOG.some((entry) => entry.id === value);
}
