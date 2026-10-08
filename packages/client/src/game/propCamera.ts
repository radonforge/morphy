/**
 * The third-person prop camera's framing: how far it sits behind the disguise,
 * where it aims, how the wheel zooms it, and the vertical field of view every
 * gameplay camera is drawn with. Pure, so the arithmetic is under test.
 */

const PROP_CAMERA_BASE_DISTANCE = 4.5;
const PROP_CAMERA_REFERENCE_HEIGHT = 1.2;
const PROP_CAMERA_SCALE_MIN = 0.7;
const PROP_CAMERA_SCALE_MAX = 1.4;
const PROP_CAMERA_TARGET_FRACTION = 0.9;
const PROP_CAMERA_UNDISGUISED_TARGET_Y = 1.2;

export const PROP_ZOOM_DEFAULT = 1;
export const PROP_ZOOM_MIN = 0.65;
export const PROP_ZOOM_MAX = 1.35;
const PROP_ZOOM_PER_PX = 0.0012;

const WIDEST_ASPECT = 16 / 9;
const DEG_TO_RAD = Math.PI / 180;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * How far behind the prop the camera sits before zoom: the base distance scaled
 * by the square root of the disguise's height (its bounding cylinder's `yMax`)
 * against a person-sized one, held within bounds so a cone and a dumpster both
 * stay framed. An undisguised prop (`null`) is at the base distance.
 */
export function propCameraDistance(height: number | null): number {
  if (height === null) return PROP_CAMERA_BASE_DISTANCE;
  const scale = clamp(
    Math.sqrt(Math.max(0, height) / PROP_CAMERA_REFERENCE_HEIGHT),
    PROP_CAMERA_SCALE_MIN,
    PROP_CAMERA_SCALE_MAX,
  );
  return PROP_CAMERA_BASE_DISTANCE * scale;
}

/** The height above its feet the camera aims at: just under the top of the disguise. */
export function propCameraTargetY(height: number | null): number {
  if (height === null) return PROP_CAMERA_UNDISGUISED_TARGET_Y;
  return height * PROP_CAMERA_TARGET_FRACTION;
}

/** A zoom multiplier on the camera distance, held within the wheel's range. */
export function clampPropZoom(zoom: number): number {
  return clamp(zoom, PROP_ZOOM_MIN, PROP_ZOOM_MAX);
}

/**
 * The zoom after `deltaPx` of vertical wheel travel: down pulls the camera
 * back, up brings it in, by the same ratio for the same travel at any zoom.
 */
export function zoomByWheel(zoom: number, deltaPx: number): number {
  return clampPropZoom(zoom * Math.exp(deltaPx * PROP_ZOOM_PER_PX));
}

/**
 * The vertical field of view in degrees to draw `fovDeg` with on a viewport of
 * `aspect`: unchanged up to 16:9, and on anything wider narrowed so the
 * horizontal view stays what it would be at 16:9 instead of stretching.
 */
export function cappedVerticalFov(fovDeg: number, aspect: number): number {
  if (!(aspect > WIDEST_ASPECT)) return fovDeg;
  const halfTan = Math.tan((fovDeg * DEG_TO_RAD) / 2);
  return (2 * Math.atan((halfTan * WIDEST_ASPECT) / aspect)) / DEG_TO_RAD;
}
