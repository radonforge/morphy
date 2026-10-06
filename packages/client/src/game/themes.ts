import { DECK_LIGHT_HEIGHT, DEFAULT_ROOM_LIGHT_COUNT } from "@morphy/level";
import { MAP_CATALOG } from "@morphy/shared";
import { MAP_THEME_BASE } from "../theme";
import type { ColorGrade } from "./colorGrade";
import type { BloomSettings, PostLook } from "./graphicsTier";
import type { SkyGlowPreset, StreetLampPreset } from "./StreetLamps";

const STARS_COUNT = 2400;
const STARS_FACTOR = 4;

interface FogPreset {
  color: string;
  near: number;
  far: number;
}

/** The few point lights a night map hangs over its deck, see {@link deckLightsFor}. */
export interface DeckLightPreset {
  roomCount: number;
  roomColor: string;
  corridorColor: string;
  roomIntensity: number;
  corridorIntensity: number;
  distance: number;
  /**
   * How high the lights hang. Kepler-9's 3 m sits 1.25 m under its 4.25 m ceiling, so
   * the beams over a light get about 6 times the floor's light rather than 30.
   */
  height: number;
}

/** Per-theme sky/light/ground preset, keyed by `MapInfo.theme`; falls back to {@link DEFAULT_THEME}. */
export interface ThemePreset {
  ground: string;
  background: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  ambient: number;
  dir: number;
  dirColor: string;
  sky: "day" | "stars";
  /** How many stars a night sky shows and how big; a city's own light hides most of them. */
  stars: { count: number; factor: number };
  skyGlow: SkyGlowPreset | null;
  streetLamps: StreetLampPreset | null;
  turbidity: number;
  rayleigh: number;
  fog: FogPreset | null;
  deckLights: DeckLightPreset | null;
  bloom: BloomSettings | null;
  grade: ColorGrade | null;
}

const DEFAULT_THEME: ThemePreset = {
  ground: "#9c5a40",
  background: "#adcdec",
  hemiSky: "#cfe2f7",
  hemiGround: "#7a6e5c",
  hemiIntensity: 1.0,
  ambient: 0.7,
  dir: 1.4,
  dirColor: "#ffffff",
  sky: "day",
  stars: { count: STARS_COUNT, factor: STARS_FACTOR },
  skyGlow: null,
  streetLamps: null,
  turbidity: 6,
  rayleigh: 1.2,
  fog: null,
  deckLights: null,
  bloom: null,
  grade: null,
};

const THEMES: Record<string, ThemePreset> = {
  station: {
    ground: MAP_THEME_BASE.station.ground,
    background: MAP_THEME_BASE.station.background,
    hemiSky: MAP_THEME_BASE.station.hemiSky,
    hemiGround: MAP_THEME_BASE.station.hemiGround,
    hemiIntensity: 0.3,
    ambient: 0.18,
    dir: 0.22,
    dirColor: "#8fa6e0",
    sky: "stars",
    stars: { count: STARS_COUNT, factor: STARS_FACTOR },
    skyGlow: null,
    streetLamps: null,
    turbidity: 9,
    rayleigh: 0.5,
    fog: { color: MAP_THEME_BASE.station.background, near: 16, far: 62 },
    deckLights: {
      roomCount: DEFAULT_ROOM_LIGHT_COUNT,
      roomColor: "#ffc27a",
      corridorColor: "#8ad8ff",
      roomIntensity: 32,
      corridorIntensity: 16,
      distance: 20,
      height: DECK_LIGHT_HEIGHT,
    },
    bloom: { intensity: 7, radius: 0.75, threshold: 0.85 },
    grade: { lift: [0, 0.01, 0.03], gain: [1.02, 1, 0.97], contrast: 1, saturation: 1.05 },
  },
  urban: {
    ground: MAP_THEME_BASE.urban.ground,
    background: MAP_THEME_BASE.urban.background,
    hemiSky: MAP_THEME_BASE.urban.hemiSky,
    hemiGround: MAP_THEME_BASE.urban.hemiGround,
    hemiIntensity: 1.0,
    ambient: 0.8,
    dir: MAP_THEME_BASE.urban.directional,
    dirColor: "#ffffff",
    sky: "day",
    stars: { count: STARS_COUNT, factor: STARS_FACTOR },
    skyGlow: null,
    streetLamps: null,
    turbidity: 4,
    rayleigh: 1.4,
    fog: null,
    deckLights: null,
    bloom: null,
    grade: { lift: [0.01, 0.005, 0], gain: [1.02, 1.01, 0.98], contrast: 1.04, saturation: 1.08 },
  },
};

const SODIUM = "#ffa448";
const LED = "#dfe9ff";

/**
 * The night a day/night theme turns into when the server draws one: few faint stars
 * over a sky glowing warm at the skyline, the station's low globals and bloom, and
 * sodium street lamps with every fifth one a cold LED.
 */
const NIGHT_THEMES: Record<string, ThemePreset> = {
  urban: {
    ...THEMES.urban!,
    background: "#0d1030",
    hemiSky: "#6c78b8",
    hemiGround: "#2b2935",
    hemiIntensity: 0.3,
    ambient: 0.18,
    dir: 0.22,
    dirColor: "#8fa6e0",
    sky: "stars",
    stars: { count: 500, factor: 2 },
    skyGlow: { top: "#0d1030", horizon: "#3d2c4a", fade: 0.35 },
    fog: { color: "#221e3c", near: 35, far: 150 },
    streetLamps: {
      color: SODIUM,
      altColor: LED,
      altEvery: 5,
      altPole: "/light-curved.glb",
      intensity: 6.6,
      altIntensity: 4,
      distance: 20,
      decay: 1,
      lightDrop: 0.5,
      lightPull: 0.8,
      bulbGlow: 5,
      poleTint: 0.25,
      backdropTint: 0.4,
      windowGlow: "#ffb768",
      budget: 8,
      fade: 4,
    },
    bloom: { intensity: 7, radius: 0.75, threshold: 0.85 },
    grade: { lift: [0, 0.01, 0.03], gain: [1.02, 1, 0.97], contrast: 1, saturation: 1.05 },
  },
};

/** The post effects a map's theme asks for, by day or by night; the graphics tier decides which are drawn. */
export function themeLook(mapId: string, night = false): PostLook {
  const { bloom, grade } = themeFor(mapId, night);
  return { bloom, grade };
}

/** The sky, light and ground preset a map renders with, and its night when the round is drawn at night. */
export function themeFor(mapId: string, night = false): ThemePreset {
  const theme = MAP_CATALOG.find((m) => m.id === mapId)?.theme;
  if (!theme) return DEFAULT_THEME;
  return (night && NIGHT_THEMES[theme]) || THEMES[theme] || DEFAULT_THEME;
}
