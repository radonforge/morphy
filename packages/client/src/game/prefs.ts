import { storageGet, storageSet } from "../safeStorage";
import { type GraphicsPreference, isGraphicsPreference } from "./graphicsTier";

/**
 * In-game HUD preferences, one localStorage key per flag, same pattern as the
 * audio flags in `game/audio.ts`. Lobby identity prefs (name, map, avatar)
 * live separately in `ui/prefs.ts`.
 */
const PERF_HUD_STORAGE_KEY = "morphy:perf-hud";
const GRAPHICS_STORAGE_KEY = "morphy:gfx";
const LOOK_SENSITIVITY_STORAGE_KEY = "morphy:look-sensitivity";
const FIELD_OF_VIEW_STORAGE_KEY = "morphy:fov";

export const LOOK_SENSITIVITY_MIN = 0.25;
export const LOOK_SENSITIVITY_MAX = 2;
export const LOOK_SENSITIVITY_STEP = 0.05;
export const LOOK_SENSITIVITY_DEFAULT = 1;

export const FIELD_OF_VIEW_MIN = 50;
export const FIELD_OF_VIEW_MAX = 90;
export const FIELD_OF_VIEW_STEP = 1;
export const FIELD_OF_VIEW_DEFAULT = 55;

let lookSensitivityCache: number | null = null;
let fieldOfViewCache: number | null = null;

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

/** A stored look multiplier clamped into range; anything that is not a finite number is the default. */
export function parseLookSensitivity(raw: string | null): number {
  if (raw === null || raw.trim() === "") return LOOK_SENSITIVITY_DEFAULT;
  const value = Number(raw);
  if (!Number.isFinite(value)) return LOOK_SENSITIVITY_DEFAULT;
  return Math.min(LOOK_SENSITIVITY_MAX, Math.max(LOOK_SENSITIVITY_MIN, value));
}

/**
 * The mouse-look multiplier. Storage is read once and the value then served
 * from memory, because mouse look asks for it on every pointer move.
 */
export function lookSensitivity(): number {
  lookSensitivityCache ??= parseLookSensitivity(storageGet(LOOK_SENSITIVITY_STORAGE_KEY));
  return lookSensitivityCache;
}

/** Store a look multiplier, clamped like a stored one; mouse look picks it up on its next move. */
export function setLookSensitivity(value: number): void {
  lookSensitivityCache = parseLookSensitivity(String(value));
  storageSet(LOOK_SENSITIVITY_STORAGE_KEY, String(lookSensitivityCache));
}

/** A stored vertical field of view in degrees, clamped into range; anything that is not a finite number is the default. */
export function parseFieldOfView(raw: string | null): number {
  if (raw === null || raw.trim() === "") return FIELD_OF_VIEW_DEFAULT;
  const value = Number(raw);
  if (!Number.isFinite(value)) return FIELD_OF_VIEW_DEFAULT;
  return Math.min(FIELD_OF_VIEW_MAX, Math.max(FIELD_OF_VIEW_MIN, value));
}

/**
 * The match camera's vertical field of view in degrees, before sprint widens
 * it. Read once from storage and then served from memory, because the camera
 * asks for it every frame.
 */
export function fieldOfView(): number {
  fieldOfViewCache ??= parseFieldOfView(storageGet(FIELD_OF_VIEW_STORAGE_KEY));
  return fieldOfViewCache;
}

/** Store a field of view, clamped like a stored one; the camera eases to it on the next frame. */
export function setFieldOfView(value: number): void {
  fieldOfViewCache = parseFieldOfView(String(value));
  storageSet(FIELD_OF_VIEW_STORAGE_KEY, String(fieldOfViewCache));
}
