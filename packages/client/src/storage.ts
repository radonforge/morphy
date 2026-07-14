const LEGACY_PREFIX = "webhunt:";
const CURRENT_PREFIX = "morphy:";

/**
 * One-time rebrand migration: rename any leftover `webhunt:*` localStorage keys
 * to the `morphy:*` namespace so returning players keep their name, avatar, and
 * audio prefs after the webhunt.lol → morphy.lol rename. Idempotent — once the
 * legacy keys are gone it is a no-op.
 *
 * Runs as a side effect at import time and must be imported before any module
 * that reads these keys during evaluation (see `game/audio.ts`), hence the
 * side-effect import ordered first in `main.tsx`.
 */
function migrateLegacyStorage(): void {
  if (typeof localStorage === "undefined") return;

  const legacyKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(LEGACY_PREFIX)) legacyKeys.push(key);
  }

  for (const oldKey of legacyKeys) {
    const newKey = CURRENT_PREFIX + oldKey.slice(LEGACY_PREFIX.length);
    const value = localStorage.getItem(oldKey);
    if (value !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, value);
    }
    localStorage.removeItem(oldKey);
  }
}

migrateLegacyStorage();

const DEVICE_ID_KEY = `${CURRENT_PREFIX}deviceId`;

let ephemeralDeviceId: string | null = null;

/**
 * Stable opaque identity for this browser, minted on first call and persisted so
 * lifetime stats survive reloads. Sent with every room join; the server maps it
 * to the player's stats record. When storage is unavailable it falls back to a
 * single id kept stable for the page's lifetime (stats won't survive a reload).
 */
export function getDeviceId(): string {
  if (typeof localStorage === "undefined") {
    if (ephemeralDeviceId === null) ephemeralDeviceId = crypto.randomUUID();
    return ephemeralDeviceId;
  }
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}
