import { DEFAULT_MAP_ID, isMapId, type MapId, MAX_NAME_LENGTH } from "@webhunt/shared";

/**
 * Client-side lobby preferences persisted to localStorage so a returning player
 * keeps their name and last map. The audio mute flag lives separately in
 * `game/audio.ts` under its own key. New pickers (avatar, …) extend `LobbyPrefs`.
 */
export interface LobbyPrefs {
  name: string;
  map: MapId;
}

const PREFS_KEY = "webhunt:prefs";

const DEFAULTS: LobbyPrefs = { name: "", map: DEFAULT_MAP_ID };

/** Read and validate stored prefs; unknown/corrupt values fall back to defaults. */
export function loadPrefs(): LobbyPrefs {
  if (typeof localStorage === "undefined") return { ...DEFAULTS };
  const raw = localStorage.getItem(PREFS_KEY);
  if (raw === null) return { ...DEFAULTS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULTS };
    const record = parsed as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.slice(0, MAX_NAME_LENGTH) : DEFAULTS.name;
    const map = isMapId(record.map) ? record.map : DEFAULTS.map;
    return { name, map };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Merge a patch into stored prefs. No-ops where localStorage is unavailable. */
export function savePrefs(patch: Partial<LobbyPrefs>): void {
  if (typeof localStorage === "undefined") return;
  const next: LobbyPrefs = { ...loadPrefs(), ...patch };
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
}
