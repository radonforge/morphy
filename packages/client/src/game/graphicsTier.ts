import type { GpuInfo } from "./diagnostics";

export type GraphicsTier = "low" | "medium" | "high";

export type GraphicsPreference = "auto" | GraphicsTier;

export const GRAPHICS_PREFERENCES: readonly GraphicsPreference[] = [
  "auto",
  "low",
  "medium",
  "high",
];

export const GRAPHICS_LABEL: Record<GraphicsPreference, string> = {
  auto: "Auto",
  low: "Low",
  medium: "Medium",
  high: "High",
};

export interface ShadowSettings {
  mapSize: number;
  radius: number;
  refreshHz: number;
}

/** A theme's bloom over bright pixels, see `BloomEffect` in `postprocessing` for the three parameters. */
export interface BloomSettings {
  intensity: number;
  radius: number;
  threshold: number;
}

/** Screen-space ambient occlusion; `halfRes` traces it at half resolution and upsamples by depth. */
export interface AoSettings {
  halfRes: boolean;
}

export interface TierSettings {
  dpr: [number, number];
  antialias: boolean;
  shadows: ShadowSettings | null;
  glass: boolean;
  bloom: boolean;
  ao: AoSettings | null;
}

/** What the post chain draws over one map on one tier. */
export interface PostSettings {
  bloom: BloomSettings | null;
  ao: AoSettings | null;
}

/**
 * What each tier turns on. Low drops everything a weak integrated GPU pays for
 * per pixel or per frame (supersampling, MSAA, the shadow pass, every post pass,
 * backdrop blur on the HUD); Medium keeps the look at a quarter of the shadow texels
 * and half the refresh, with ambient occlusion traced at half resolution; High is the
 * full look with a wider, sharper shadow area and full-resolution occlusion.
 */
export const TIER_SETTINGS: Record<GraphicsTier, TierSettings> = {
  low: { dpr: [1, 1], antialias: false, shadows: null, glass: false, bloom: false, ao: null },
  medium: {
    dpr: [1, 1],
    antialias: true,
    shadows: { mapSize: 1024, radius: 25, refreshHz: 15 },
    glass: true,
    bloom: true,
    ao: { halfRes: true },
  },
  high: {
    dpr: [1, 1.25],
    antialias: true,
    shadows: { mapSize: 2048, radius: 40, refreshHz: 30 },
    glass: true,
    bloom: true,
    ao: { halfRes: false },
  },
};

/**
 * The post chain a tier draws a map's theme with, or null when the frame goes
 * straight to the canvas, which is always the case on Low.
 */
export function postSettings(tier: TierSettings, bloom: BloomSettings | null): PostSettings | null {
  const post = { bloom: tier.bloom ? bloom : null, ao: tier.ao };
  return post.bloom || post.ao ? post : null;
}

/** No tier renders faster than this: a 144 Hz monitor gains nothing a prop hunt needs. */
export const MAX_RENDER_FPS = 60;

/** A round averaging below this, in Auto, steps the next round down one tier. */
export const STEP_DOWN_FPS = 40;

/** Rounds shorter than this say too little about the machine to act on. */
export const STEP_DOWN_MIN_FRAMES = 600;

const LOW_CORES = 4;
const LOW_MEMORY_GB = 4;
const INTEGRATED_GPU =
  /\bintel\b(?!.*\barc\b)|\bradeon(\(tm\))? graphics\b|\bvega \d+ graphics\b|mali|adreno|powervr/i;
const MS_PER_S = 1000;

export interface DeviceHints {
  gpu: GpuInfo;
  cores: number | null;
  memoryGb: number | null;
}

/** Frames rendered while a round was in play, for the between-rounds Auto check. */
export interface RoundFrames {
  frames: number;
  totalMs: number;
}

export function isGraphicsPreference(value: string | null): value is GraphicsPreference {
  return GRAPHICS_PREFERENCES.some((pref) => pref === value);
}

/** Auto's starting tier: software rendering is Low, an integrated GPU or a small machine is Medium. */
export function autoTier(hints: DeviceHints): GraphicsTier {
  if (hints.gpu.software) return "low";
  if (INTEGRATED_GPU.test(hints.gpu.renderer)) return "medium";
  const smallCpu = hints.cores !== null && hints.cores <= LOW_CORES;
  const smallMemory = hints.memoryGb !== null && hints.memoryGb <= LOW_MEMORY_GB;
  return smallCpu || smallMemory ? "medium" : "high";
}

export function resolveTier(pref: GraphicsPreference, hints: DeviceHints): GraphicsTier {
  return pref === "auto" ? autoTier(hints) : pref;
}

/** The tier for the next round: one step down after a slow round, never back up within a match. */
export function nextRoundTier(current: GraphicsTier, round: RoundFrames): GraphicsTier {
  if (round.frames < STEP_DOWN_MIN_FRAMES || round.totalMs <= 0) return current;
  const fps = (round.frames * MS_PER_S) / round.totalMs;
  if (fps >= STEP_DOWN_FPS) return current;
  return current === "high" ? "medium" : "low";
}
