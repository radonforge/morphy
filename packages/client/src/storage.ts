import { storageGet, storageKeys, storageRemove, storageSet } from "./safeStorage";

const LEGACY_PREFIX = "webhunt:";
const CURRENT_PREFIX = "morphy:";

/**
 * One-time rebrand migration: rename any leftover `webhunt:*` localStorage keys
 * to the `morphy:*` namespace so returning players keep their name, avatar, and
 * audio prefs after the webhunt.lol → morphy.lol rename. Idempotent: once the
 * legacy keys are gone it is a no-op.
 *
 * Runs as a side effect at import time and must be imported before any module
 * that reads these keys during evaluation (see `game/audio.ts`), hence the
 * side-effect import ordered first in `main.tsx`.
 */
function migrateLegacyStorage(): void {
  const legacyKeys = storageKeys().filter((key) => key.startsWith(LEGACY_PREFIX));

  for (const oldKey of legacyKeys) {
    const newKey = CURRENT_PREFIX + oldKey.slice(LEGACY_PREFIX.length);
    const value = storageGet(oldKey);
    if (value !== null && storageGet(newKey) === null) {
      storageSet(newKey, value);
    }
    storageRemove(oldKey);
  }
}

migrateLegacyStorage();

const DEVICE_ID_KEY = `${CURRENT_PREFIX}deviceId`;

let ephemeralDeviceId: string | null = null;

interface RandomSource {
  randomUUID?(): string;
  getRandomValues?(array: Uint8Array): Uint8Array;
}

/** UUID v4 generation that also works on an insecure LAN origin. */
export function createDeviceId(source: RandomSource | undefined = globalThis.crypto): string {
  try {
    if (source?.randomUUID) return source.randomUUID();
  } catch {
    // Some browsers expose the method but reject it outside a secure context.
  }
  const bytes = new Uint8Array(16);
  if (source?.getRandomValues) {
    source.getRandomValues(bytes);
  } else {
    // Identity is not an authentication secret; this only supports very old browsers.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Stable opaque identity for this browser, minted on first call and persisted so
 * lifetime stats survive reloads. Sent with every room join; the server maps it
 * to the player's stats record. When storage is unavailable it falls back to a
 * single id kept stable for the page's lifetime (stats won't survive a reload).
 */
export function getDeviceId(): string {
  const existing = storageGet(DEVICE_ID_KEY);
  if (existing) return existing;
  if (ephemeralDeviceId === null) ephemeralDeviceId = createDeviceId();
  storageSet(DEVICE_ID_KEY, ephemeralDeviceId);
  return ephemeralDeviceId;
}
