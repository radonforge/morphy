import assert from "node:assert/strict";
import { test } from "node:test";

const {
  CLOSED_FOCUS,
  clipPath,
  easeOpen,
  frameShift,
  isMoving,
  layoutAt,
  moveTo,
  mixLayouts,
  OPEN_FOCUS_IN_SLICE,
  SLICE_SLANT,
  settledMotion,
  sliceForKey,
  sliceShape,
  worldsLayout,
} = await import("../packages/client/src/ui/worldSlices.ts");

const WIDTH = 1440;
const HEIGHT = 900;
const EPSILON = 1e-6;
const AVATAR_FOCUS = 0.7;

const shapes = (layout) =>
  layout.openness.map((_, index) => sliceShape(layout, index, WIDTH, HEIGHT));
const midWidth = (shape) =>
  (shape.polygon[1][0] + shape.polygon[2][0]) / 2 - (shape.polygon[0][0] + shape.polygon[3][0]) / 2;
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message}: ${actual} != ${expected}`);

test("with two maps the open slice takes about 70% of the screen, either way round", () => {
  for (const open of [0, 1]) {
    const widths = shapes(worldsLayout(2, open, false)).map(midWidth);
    const share = widths[open] / WIDTH;
    assert.ok(share > 0.68 && share < 0.72, `open share ${share}`);
  }
});

test("three and four maps keep every slice on screen, the open one widest", () => {
  for (const count of [3, 4]) {
    for (let open = 0; open < count; open++) {
      const widths = shapes(worldsLayout(count, open, false)).map(midWidth);
      const closed = widths.filter((_, index) => index !== open);
      assert.ok(Math.min(...closed) > SLICE_SLANT * WIDTH * 2, `closed ${closed}`);
      assert.ok(widths[open] > Math.max(...closed) * 3, `open ${widths[open]}`);
      for (const width of closed) close(width, closed[0], "closed slices share the rest");
    }
  }
});

test("slices tile the screen: neighbours share an edge and the ends meet its sides", () => {
  for (const count of [1, 2, 3, 4]) {
    const all = shapes(worldsLayout(count, 0, false));
    assert.deepEqual(all[0].polygon[0], [0, 0]);
    assert.deepEqual(all[0].polygon[3], [0, HEIGHT]);
    assert.deepEqual(all[count - 1].polygon[1], [WIDTH, 0]);
    assert.deepEqual(all[count - 1].polygon[2], [WIDTH, HEIGHT]);
    for (let index = 0; index < count - 1; index++) {
      assert.deepEqual(all[index].polygon[1], all[index + 1].polygon[0]);
      assert.deepEqual(all[index].polygon[2], all[index + 1].polygon[3]);
    }
  }
});

test("every edge leans right toward the top by the slant", () => {
  const [first] = shapes(worldsLayout(2, 0, false));
  close(first.polygon[1][0] - first.polygon[2][0], SLICE_SLANT * WIDTH, "slant run");
});

test("focus gives the open slice the whole screen and takes every other off it", () => {
  const layout = worldsLayout(4, 2, true);
  const all = shapes(layout);
  assert.equal(all[2].left, 0);
  assert.equal(all[2].right, WIDTH);
  assert.ok(all[2].polygon[0][0] <= 0 && all[2].polygon[3][0] <= 0);
  assert.ok(all[2].polygon[1][0] >= WIDTH && all[2].polygon[2][0] >= WIDTH);
  for (const index of [0, 1, 3]) assert.ok(all[index].right <= all[index].left, `slice ${index}`);
});

test("a slice that covers the screen shows exactly today's frame", () => {
  const layout = worldsLayout(2, 1, true);
  assert.equal(frameShift(layout, 1, WIDTH, HEIGHT, AVATAR_FOCUS), 0);
});

test("the open slice puts the avatar at its focus point, the frame edges never inside it", () => {
  for (const count of [2, 3, 4]) {
    for (let open = 0; open < count; open++) {
      const layout = worldsLayout(count, open, false);
      const shape = sliceShape(layout, open, WIDTH, HEIGHT);
      const shift = frameShift(layout, open, WIDTH, HEIGHT, AVATAR_FOCUS);
      assert.ok(shift <= shape.left + EPSILON, "frame's left edge left of the slice");
      assert.ok(shift + WIDTH >= shape.right - EPSILON, "frame's right edge right of the slice");
      const leftMid = open === 0 ? 0 : layout.edges[open - 1] * WIDTH;
      const rightMid = open === count - 1 ? WIDTH : layout.edges[open] * WIDTH;
      const wanted = leftMid + (rightMid - leftMid) * OPEN_FOCUS_IN_SLICE;
      const landed = AVATAR_FOCUS * WIDTH + shift;
      const clamped = shift === shape.left || shift === shape.right - WIDTH;
      if (!clamped) close(landed, wanted, `avatar in slice ${open} of ${count}`);
    }
  }
});

test("a closed slice centres the middle of the frame when it can", () => {
  const layout = worldsLayout(3, 0, false);
  const shape = sliceShape(layout, 1, WIDTH, HEIGHT);
  const shift = frameShift(layout, 1, WIDTH, HEIGHT, AVATAR_FOCUS);
  close(CLOSED_FOCUS * WIDTH + shift, (layout.edges[0] + layout.edges[1]) * (WIDTH / 2), "centre");
  assert.ok(shift <= shape.left && shift + WIDTH >= shape.right);
});

test("the opening curve starts at 0, ends at 1 and never runs backwards", () => {
  close(easeOpen(0), 0, "start");
  close(easeOpen(1), 1, "end");
  let previous = 0;
  for (let step = 1; step <= 100; step++) {
    const value = easeOpen(step / 100);
    assert.ok(value >= previous - EPSILON, `step ${step}`);
    previous = value;
  }
  assert.ok(easeOpen(0.25) > 0.5, "most of the move lands early");
});

test("a move runs from its start layout to its target and then holds", () => {
  const from = worldsLayout(2, 0, false);
  const to = worldsLayout(2, 1, false);
  const motion = moveTo(settledMotion(from), to, 1000, 550);
  assert.deepEqual(layoutAt(motion, 1000), mixLayouts(from, to, 0));
  assert.deepEqual(layoutAt(motion, 1550), to);
  assert.deepEqual(layoutAt(motion, 9000), to);
  assert.equal(isMoving(motion, 1200), true);
  assert.equal(isMoving(motion, 1550), false);
  const mid = layoutAt(motion, 1275);
  assert.ok(mid.edges[0] < from.edges[0] && mid.edges[0] > to.edges[0]);
});

test("retargeting mid-move starts from where the slices are, never from the old start", () => {
  const first = moveTo(settledMotion(worldsLayout(3, 0, false)), worldsLayout(3, 2, false), 0, 550);
  const retarget = moveTo(first, worldsLayout(3, 1, false), 200, 550);
  assert.deepEqual(layoutAt(retarget, 200), layoutAt(first, 200));
});

test("a zero-length move lands at once, as reduced motion asks", () => {
  const to = worldsLayout(2, 1, false);
  const motion = moveTo(settledMotion(worldsLayout(2, 0, false)), to, 500, 0);
  assert.deepEqual(layoutAt(motion, 500), to);
  assert.equal(isMoving(motion, 500), false);
});

test("arrows step to a neighbour without wrapping and digits name a slice", () => {
  assert.equal(sliceForKey("ArrowRight", 0, 2), 1);
  assert.equal(sliceForKey("ArrowRight", 1, 2), null);
  assert.equal(sliceForKey("ArrowLeft", 1, 2), 0);
  assert.equal(sliceForKey("ArrowLeft", 0, 2), null);
  assert.equal(sliceForKey("2", 0, 4), 1);
  assert.equal(sliceForKey("4", 0, 4), 3);
  assert.equal(sliceForKey("3", 0, 2), null);
  assert.equal(sliceForKey("1", 0, 2), null);
  assert.equal(sliceForKey("0", 0, 2), null);
  assert.equal(sliceForKey("Enter", 0, 2), null);
});

test("a polygon becomes a clip path in pixels", () => {
  assert.equal(
    clipPath([
      [1, 0],
      [5, 0],
      [4, 9],
      [0, 9],
    ]),
    "polygon(1px 0px, 5px 0px, 4px 9px, 0px 9px)",
  );
});
