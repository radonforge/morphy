import { storageGet, storageSet } from "../safeStorage";

/**
 * Whether a prop watches itself from behind (third person, the default) or
 * looks out from its disguise (first person). Hunters are always first person:
 * a third-person hunter could peek round corners and aims along the camera ray.
 */
export type PropView = "third" | "first";

const PROP_VIEW_STORAGE_KEY = "morphy:prop-view";
const PROP_EYE_FRACTION = 0.9;
const PROP_EYE_MIN_HEIGHT = 0.3;

/** A stored prop view; anything but `"first"` is the third-person default. */
export function parsePropView(raw: string | null): PropView {
  return raw === "first" ? "first" : "third";
}

export function propView(): PropView {
  return parsePropView(storageGet(PROP_VIEW_STORAGE_KEY));
}

export function setPropView(view: PropView): void {
  storageSet(PROP_VIEW_STORAGE_KEY, view);
}

/**
 * How high above its feet a first-person prop's eye sits: just under the top
 * of the disguise's bounding cylinder (`yMax`), so it looks out over its own
 * lid, but never at floor level for a flat disguise.
 */
export function propEyeHeight(yMax: number): number {
  return Math.max(PROP_EYE_MIN_HEIGHT, yMax * PROP_EYE_FRACTION);
}
