import { storageGet, storageSet } from "../safeStorage";
import { type GraphicsPreference, isGraphicsPreference } from "./graphicsTier";

/**
 * In-game HUD preferences, one localStorage key per flag, same pattern as the
 * audio flags in `game/audio.ts`. Lobby identity prefs (name, map, avatar)
 * live separately in `ui/prefs.ts`.
 */
const PERF_HUD_STORAGE_KEY = "morphy:perf-hud";
const GRAPHICS_STORAGE_KEY = "morphy:gfx";

export function isPerfHudEnabled(): boolean {
  return storageGet(PERF_HUD_STORAGE_KEY) === "1";
}

export function setPerfHudEnabled(value: boolean): void {
  storageSet(PERF_HUD_STORAGE_KEY, value ? "1" : "0");
}

export function graphicsPreference(): GraphicsPreference {
  const stored = storageGet(GRAPHICS_STORAGE_KEY);
  return isGraphicsPreference(stored) ? stored : "auto";
}

export function setGraphicsPreference(value: GraphicsPreference): void {
  storageSet(GRAPHICS_STORAGE_KEY, value);
}
