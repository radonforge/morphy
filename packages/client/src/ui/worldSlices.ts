import { MAP_CATALOG, type MapId } from "@morphy/shared";

/**
 * The lobby's worlds: one diagonal slice of the screen per map, the open one wide and the rest
 * narrow. Everything here is pure arithmetic on a unit-width screen, shared by the DOM slices
 * (their clip paths and labels) and the stage (its viewports and framing), so the two draw the
 * same shapes from the same numbers.
 */

/** The worlds in slice order, left to right: the map catalog's order. */
export const WORLD_IDS: readonly MapId[] = MAP_CATALOG.map((entry) => entry.id);

/** Horizontal run of every slanted edge, as a fraction of the screen width. */
export const SLICE_SLANT = 0.035;

/** How long a slice takes to open, and the framing inside it to follow. */
export const SLICE_OPEN_S = 0.55;

/** Where the open world's focus (the avatar) lands across its slice, 0 left to 1 right. */
export const OPEN_FOCUS_IN_SLICE = 0.64;

/**
 * How far left of a panel covering the right of the screen the open world's focus stays, as a
 * fraction of the width, so the avatar stands clear of the panel instead of under its edge.
 */
export const COVER_CLEARANCE = 0.08;

/** The point of the frame a closed slice is centred on, as a fraction of the frame's width. */
export const CLOSED_FOCUS = 0.5;

/**
 * How many closed slices' width the open one takes, by how many maps share the screen: about
 * 70% of it with two maps, and still room for every closed name to stand up with four.
 */
const OPEN_GROWTH: readonly number[] = [1, 1, 2.4, 3.2, 3.6];

const EASE_X1 = 0.2;
const EASE_Y1 = 0.7;
const EASE_X2 = 0.2;
const EASE_Y2 = 1;
const EASE_ITERATIONS = 24;

const DIGIT_KEY = /^[1-9]$/;

export interface WorldsLayout {
  /** Where each edge between neighbouring slices crosses mid-height, as a fraction of width. */
  edges: number[];
  /** How open each slice is, 0 closed to 1 open. */
  openness: number[];
  /**
   * Where a panel covering the right of the screen begins, as a fraction of width at mid-height:
   * 1 when nothing covers it. The worlds keep their shapes under it; only the framing moves.
   */
  cover: number;
}

export interface WorldsMotion {
  from: WorldsLayout;
  to: WorldsLayout;
  /** Start of the move, in `performance.now()` milliseconds. */
  start: number;
  durationMs: number;
}

export type Point = readonly [number, number];

export interface SliceShape {
  /** Corners clockwise from the top left, in pixels from the screen's top-left corner. */
  polygon: [Point, Point, Point, Point];
  /** The slice's horizontal extent on screen, clamped to it: empty when `right <= left`. */
  left: number;
  right: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function growth(count: number): number {
  return OPEN_GROWTH[Math.min(count, OPEN_GROWTH.length - 1)] ?? 1;
}

/**
 * The slices at rest with `open` open. With `focus` the open slice takes the whole screen and
 * every other edge leaves it, which is how the avatar picker gets today's full frame back. A
 * `cover` under 1 says a panel covers the screen right of it (the Options slice), which takes
 * the whole screen for the open world as `focus` does, so the world slides into the part left
 * free instead of being cut by the panel.
 */
export function worldsLayout(count: number, open: number, focus: boolean, cover = 1): WorldsLayout {
  const openness = Array.from({ length: count }, (_, index) => (index === open ? 1 : 0));
  const edges: number[] = [];
  if (focus || cover < 1) {
    for (let edge = 0; edge < count - 1; edge++) {
      edges.push(edge < open ? -SLICE_SLANT / 2 : 1 + SLICE_SLANT / 2);
    }
    return { edges, openness, cover };
  }
  const weights = openness.map((value) => (value === 1 ? growth(count) : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let run = 0;
  for (let edge = 0; edge < count - 1; edge++) {
    run += weights[edge] ?? 0;
    edges.push(run / total);
  }
  return { edges, openness, cover };
}

export function mixLayouts(a: WorldsLayout, b: WorldsLayout, t: number): WorldsLayout {
  return {
    edges: a.edges.map((edge, index) => lerp(edge, b.edges[index] ?? edge, t)),
    openness: a.openness.map((value, index) => lerp(value, b.openness[index] ?? value, t)),
    cover: lerp(a.cover, b.cover, t),
  };
}

function bezier(u: number, p1: number, p2: number): number {
  const v = 1 - u;
  return 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u;
}

/** The opening curve, CSS `cubic-bezier(0.2, 0.7, 0.2, 1)`: a quick start and a long settle. */
export function easeOpen(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let i = 0; i < EASE_ITERATIONS; i++) {
    const mid = (low + high) / 2;
    if (bezier(mid, EASE_X1, EASE_X2) < t) low = mid;
    else high = mid;
  }
  return bezier((low + high) / 2, EASE_Y1, EASE_Y2);
}

export function settledMotion(layout: WorldsLayout): WorldsMotion {
  return { from: layout, to: layout, start: 0, durationMs: 0 };
}

/** Where `motion` has the slices at `now`. */
export function layoutAt(motion: WorldsMotion, now: number): WorldsLayout {
  if (motion.durationMs <= 0 || now >= motion.start + motion.durationMs) return motion.to;
  return mixLayouts(motion.from, motion.to, easeOpen((now - motion.start) / motion.durationMs));
}

/** Whether `motion` is still moving at `now`. */
export function isMoving(motion: WorldsMotion, now: number): boolean {
  return motion.durationMs > 0 && now < motion.start + motion.durationMs;
}

/** A move from wherever the slices are at `now` to `target`, so a retarget never jumps. */
export function moveTo(
  motion: WorldsMotion,
  target: WorldsLayout,
  now: number,
  durationMs: number,
): WorldsMotion {
  return { from: layoutAt(motion, now), to: target, start: now, durationMs };
}

/**
 * Slice `index` in pixels. Neighbours share an edge, so the slices tile the screen with no gap
 * and no overlap; each edge leans right toward the top by `SLICE_SLANT` of the width.
 */
export function sliceShape(
  layout: WorldsLayout,
  index: number,
  width: number,
  height: number,
): SliceShape {
  const run = SLICE_SLANT * width;
  const count = layout.openness.length;
  const leftMid = index === 0 ? null : (layout.edges[index - 1] ?? 0) * width;
  const rightMid = index === count - 1 ? null : (layout.edges[index] ?? 1) * width;
  const leftTop = leftMid === null ? 0 : leftMid + run / 2;
  const leftBottom = leftMid === null ? 0 : leftMid - run / 2;
  const rightTop = rightMid === null ? width : rightMid + run / 2;
  const rightBottom = rightMid === null ? width : rightMid - run / 2;
  return {
    polygon: [
      [leftTop, 0],
      [rightTop, 0],
      [rightBottom, height],
      [leftBottom, height],
    ],
    left: clamp(Math.min(leftTop, leftBottom), 0, width),
    right: clamp(Math.max(rightTop, rightBottom), 0, width),
  };
}

/**
 * How far right the frame is slid under slice `index`, in pixels: the lens never changes, the
 * slice only chooses which part of today's frame it shows. A closed slice centres the middle of
 * the frame, the open one puts `focus` (where the avatar stands, as a fraction of the frame) at
 * `OPEN_FOCUS_IN_SLICE` across itself, and a slice part way open is part way between. The slide
 * is kept small enough that the frame's own edges never show inside the slice, so a slice that
 * covers the screen gets exactly today's frame. Under a `cover` the focus is held
 * `COVER_CLEARANCE` left of the panel's edge, and the frame may slide left as far as the panel's
 * edge, since what shows past it is behind the panel.
 */
export function frameShift(
  layout: WorldsLayout,
  index: number,
  width: number,
  height: number,
  focus: number,
): number {
  const shape = sliceShape(layout, index, width, height);
  const count = layout.openness.length;
  const leftMid = index === 0 ? 0 : (layout.edges[index - 1] ?? 0) * width;
  const rightMid = index === count - 1 ? width : (layout.edges[index] ?? 1) * width;
  const openness = layout.openness[index] ?? 0;
  const covered = layout.cover < 1;
  const coverMid = layout.cover * width;
  const framed = lerp(
    (leftMid + rightMid) / 2,
    leftMid + (rightMid - leftMid) * OPEN_FOCUS_IN_SLICE,
    openness,
  );
  const target = covered ? Math.min(framed, coverMid - COVER_CLEARANCE * width) : framed;
  const visibleRight = covered
    ? Math.min(shape.right, coverMid + (SLICE_SLANT * width) / 2)
    : shape.right;
  const anchor = lerp(CLOSED_FOCUS, focus, openness) * width;
  return clamp(target - anchor, visibleRight - width, shape.left);
}

/** A slice's horizontal extent in device pixels, snapped outward to cover every pixel of it. */
export interface DeviceBox {
  left: number;
  right: number;
}

/** The canvas in CSS pixels, and how many device pixels it draws per CSS pixel. */
export interface Viewport {
  width: number;
  height: number;
  pixelRatio: number;
}

export function deviceBox(shape: SliceShape, pixelRatio: number): DeviceBox {
  return {
    left: Math.floor(shape.left * pixelRatio),
    right: Math.ceil(shape.right * pixelRatio),
  };
}

/**
 * How the stage treats slice `index` this frame when it is not the open one. `visible` says
 * whether it is closed and on screen at all, so laid down from its copy; `key` is everything the
 * copy depends on, in device pixels so the box it is drawn in, the box it is cut by and the box
 * it is cached by are one and the same: the canvas size, the slice's box, how far its frame is
 * slid, and `world` (how far it has formed, and its look). A copy whose key still matches is
 * reused; any other is drawn again.
 */
export function closedSlice(
  layout: WorldsLayout,
  index: number,
  open: number,
  viewport: Viewport,
  shift: number,
  world: string,
): { visible: boolean; box: DeviceBox; key: string } {
  const { width, height, pixelRatio } = viewport;
  const shape = sliceShape(layout, index, width, height);
  const box = deviceBox(shape, pixelRatio);
  const key = [
    Math.round(width * pixelRatio),
    Math.round(height * pixelRatio),
    box.left,
    box.right,
    Math.round(shift * pixelRatio),
    world,
  ].join(":");
  return { visible: index !== open && shape.right > shape.left, box, key };
}

/**
 * The slice a key opens from `current`, or null when it opens none: the arrows step to a
 * neighbour without wrapping, since the slices sit side by side, and a digit names a slice.
 */
export function sliceForKey(key: string, current: number, count: number): number | null {
  if (key === "ArrowLeft") return current > 0 ? current - 1 : null;
  if (key === "ArrowRight") return current < count - 1 ? current + 1 : null;
  if (!DIGIT_KEY.test(key)) return null;
  const index = Number(key) - 1;
  return index < count && index !== current ? index : null;
}

/** A polygon as CSS `clip-path`. */
export function clipPath(polygon: readonly Point[]): string {
  return `polygon(${polygon.map(([x, y]) => `${x}px ${y}px`).join(", ")})`;
}
