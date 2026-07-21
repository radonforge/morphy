import {
  type AvatarId,
  DEFAULT_AVATAR_ID,
  DEFAULT_MAP_ID,
  isAvatarId,
  isMapId,
  MAX_NAME_LENGTH,
  type MapId,
} from "@morphy/shared";
import { storageGet, storageSet } from "../safeStorage";

/**
 * Client-side lobby preferences persisted to localStorage so a returning player
 * keeps their name, last map and avatar. The audio mute flag lives separately in
 * `game/audio.ts` under its own key.
 */
export interface LobbyPrefs {
  name: string;
  map: MapId;
  avatar: AvatarId;
}

const PREFS_KEY = "morphy:prefs";

const DEFAULTS: LobbyPrefs = { name: "", map: DEFAULT_MAP_ID, avatar: DEFAULT_AVATAR_ID };

/** Read and validate stored prefs; unknown/corrupt values fall back to defaults. */
export function loadPrefs(): LobbyPrefs {
  const raw = storageGet(PREFS_KEY);
  if (raw === null) return { ...DEFAULTS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULTS };
    const record = parsed as Record<string, unknown>;
    const name =
      typeof record.name === "string" ? record.name.slice(0, MAX_NAME_LENGTH) : DEFAULTS.name;
    const map = isMapId(record.map) ? record.map : DEFAULTS.map;
    const avatar = isAvatarId(record.avatar) ? record.avatar : DEFAULTS.avatar;
    return { name, map, avatar };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Merge a patch into stored prefs, using the page-lifetime fallback if persistence is unavailable. */
export function savePrefs(patch: Partial<LobbyPrefs>): void {
  const next: LobbyPrefs = { ...loadPrefs(), ...patch };
  storageSet(PREFS_KEY, JSON.stringify(next));
}
