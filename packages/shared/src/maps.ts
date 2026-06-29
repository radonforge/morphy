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
    name: "Stazione Kepler-9",
    theme: "station",
    blurb: "Moduli pressurizzati e corridoi stretti: mimetizzati tra arredi e container.",
  },
  {
    id: "mars",
    name: "Avamposto Ares",
    theme: "mars",
    blurb:
      "Apron marziano a cielo aperto attorno a una piccola base: poche coperture, lunghe linee di tiro.",
  },
  {
    id: "urban",
    name: "Distretto Nord",
    theme: "urban",
    blurb: "Isolati e strade: confonditi tra i passanti del quartiere.",
  },
] as const satisfies readonly MapInfo[];

export type MapId = (typeof MAP_CATALOG)[number]["id"];

export const DEFAULT_MAP_ID: MapId = "station";

/** Narrow an untrusted join option to a known map id (boundary validation). */
export function isMapId(value: unknown): value is MapId {
  return typeof value === "string" && MAP_CATALOG.some((entry) => entry.id === value);
}
