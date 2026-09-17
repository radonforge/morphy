import { storageGet, storageSet } from "../safeStorage";

/**
 * In-game HUD preferences, one localStorage key per flag, same pattern as the
 * audio flags in `game/audio.ts`. Lobby identity prefs (name, map, avatar)
 * live separately in `ui/prefs.ts`.
 */
const PERF_HUD_STORAGE_KEY = "morphy:perf-hud";

export function isPerfHudEnabled(): boolean {
  return storageGet(PERF_HUD_STORAGE_KEY) === "1";
}

export function setPerfHudEnabled(value: boolean): void {
  storageSet(PERF_HUD_STORAGE_KEY, value ? "1" : "0");
}
