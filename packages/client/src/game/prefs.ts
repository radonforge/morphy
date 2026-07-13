/**
 * In-game HUD preferences, one localStorage key per flag — same pattern as the
 * audio flags in `game/audio.ts`. Lobby identity prefs (name, map, avatar)
 * live separately in `ui/prefs.ts`.
 */
const PERF_HUD_STORAGE_KEY = "morphy:perf-hud";

export function isPerfHudEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(PERF_HUD_STORAGE_KEY) === "1";
}

export function setPerfHudEnabled(value: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PERF_HUD_STORAGE_KEY, value ? "1" : "0");
}
