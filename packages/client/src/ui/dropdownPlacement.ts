const LIST_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

/** The trigger's box in viewport pixels. */
export interface TriggerBox {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
}

/** Where the open list goes, in viewport pixels, and the height it may take there. */
export interface ListPlacement {
  readonly top: number;
  readonly left: number;
  readonly maxHeight: number;
  readonly minWidth: number;
}

/**
 * Lays the open list under its trigger, or over it when the viewport has less room below than
 * above and the list does not fit below. The list may be as tall as the room on the side it
 * opens to, so it scrolls rather than leaving the viewport, and it never starts above the
 * viewport's top margin nor left of its side margins.
 */
export function placeDropdownList(
  trigger: TriggerBox,
  list: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
): ListPlacement {
  const below = viewport.height - trigger.bottom - LIST_GAP_PX - VIEWPORT_MARGIN_PX;
  const above = trigger.top - LIST_GAP_PX - VIEWPORT_MARGIN_PX;
  const opensAbove = list.height > below && above > below;
  const maxHeight = Math.max(0, opensAbove ? above : below);
  const height = Math.min(list.height, maxHeight);
  const top = opensAbove
    ? Math.max(VIEWPORT_MARGIN_PX, trigger.top - LIST_GAP_PX - height)
    : trigger.bottom + LIST_GAP_PX;
  const left = Math.max(
    VIEWPORT_MARGIN_PX,
    Math.min(trigger.left, viewport.width - list.width - VIEWPORT_MARGIN_PX),
  );
  return { top, left, maxHeight, minWidth: trigger.width };
}
