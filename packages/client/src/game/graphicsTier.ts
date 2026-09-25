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

export interface TierSettings {
  dpr: [number, number];
  antialias: boolean;
  shadows: ShadowSettings | null;
  glass: boolean;
}

/**
 * What each tier turns on. Low drops everything a weak integrated GPU pays for
 * per pixel or per frame (supersampling, MSAA, the shadow pass, backdrop blur on
 * the HUD); Medium keeps the look at a quarter of the shadow texels and half the
 * refresh; High is the full look with a wider, sharper shadow area.
 */
export const TIER_SETTINGS: Record<GraphicsTier, TierSettings> = {
  low: { dpr: [1, 1], antialias: false, shadows: null, glass: false },
  medium: {
    dpr: [1, 1],
    antialias: true,
    shadows: { mapSize: 1024, radius: 25, refreshHz: 15 },
    glass: true,
  },
  high: {
    dpr: [1, 1.25],
    antialias: true,
    shadows: { mapSize: 2048, radius: 40, refreshHz: 30 },
    glass: true,
  },
};

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
