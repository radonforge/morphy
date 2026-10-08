import assert from "node:assert/strict";
import { test } from "node:test";

const {
  CLOSED_FOCUS,
  COVER_CLEARANCE,
  clipPath,
  closedSlice,
  deviceBox,
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

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 2560, height: 1080 },
];
const [{ width: WIDTH, height: HEIGHT }] = VIEWPORTS;
const EPSILON = 1e-6;
const AVATAR_FOCUS = 0.7;
const PIXEL_RATIO = 1.25;
const FORMED = "formed:day";

const shapes = (layout, width, height) =>
  layout.openness.map((_, index) => sliceShape(layout, index, width, height));
const midWidth = (shape) =>
  (shape.polygon[1][0] + shape.polygon[2][0]) / 2 - (shape.polygon[0][0] + shape.polygon[3][0]) / 2;
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message}: ${actual} != ${expected}`);
const closePoint = (actual, expected, message) => {
  close(actual[0], expected[0], `${message} x`);
  close(actual[1], expected[1], `${message} y`);
};
const midEdges = (layout, index, width) => ({
  left: index === 0 ? 0 : layout.edges[index - 1] * width,
  right: index === layout.openness.length - 1 ? width : layout.edges[index] * width,
});

test("with two maps the open slice takes about 70% of the screen, either way round", () => {
  for (const { width, height } of VIEWPORTS) {
    for (const open of [0, 1]) {
      const widths = shapes(worldsLayout(2, open, false), width, height).map(midWidth);
      const share = widths[open] / width;
      assert.ok(share > 0.68 && share < 0.72, `open share ${share} at ${width}`);
    }
  }
});

test("three and four maps keep every slice on screen, the open one widest", () => {
  for (const { width, height } of VIEWPORTS) {
    for (const count of [3, 4]) {
      for (let open = 0; open < count; open++) {
        const widths = shapes(worldsLayout(count, open, false), width, height).map(midWidth);
        const closed = widths.filter((_, index) => index !== open);
        assert.ok(Math.min(...closed) > SLICE_SLANT * width * 2, `closed ${closed}`);
        assert.ok(widths[open] > Math.max(...closed) * 3, `open ${widths[open]}`);
        for (const value of closed) close(value, closed[0], "closed slices share the rest");
      }
    }
  }
});

test("slices tile the screen: neighbours share an edge and the ends meet its sides", () => {
  for (const { width, height } of VIEWPORTS) {
    for (const count of [1, 2, 3, 4]) {
      const all = shapes(worldsLayout(count, 0, false), width, height);
      closePoint(all[0].polygon[0], [0, 0], "top left");
      closePoint(all[0].polygon[3], [0, height], "bottom left");
      closePoint(all[count - 1].polygon[1], [width, 0], "top right");
      closePoint(all[count - 1].polygon[2], [width, height], "bottom right");
      for (let index = 0; index < count - 1; index++) {
        closePoint(all[index].polygon[1], all[index + 1].polygon[0], `top edge ${index}`);
        closePoint(all[index].polygon[2], all[index + 1].polygon[3], `bottom edge ${index}`);
      }
    }
  }
});

test("every edge leans right toward the top by the slant", () => {
  for (const { width, height } of VIEWPORTS) {
    const [first] = shapes(worldsLayout(2, 0, false), width, height);
    close(first.polygon[1][0] - first.polygon[2][0], SLICE_SLANT * width, "slant run");
  }
});

test("focus gives the open slice the whole screen and takes every other off it", () => {
  for (const { width, height } of VIEWPORTS) {
    const all = shapes(worldsLayout(4, 2, true), width, height);
    assert.equal(all[2].left, 0);
    assert.equal(all[2].right, width);
    assert.ok(all[2].polygon[0][0] <= 0 && all[2].polygon[3][0] <= 0);
    assert.ok(all[2].polygon[1][0] >= width && all[2].polygon[2][0] >= width);
    for (const index of [0, 1, 3]) assert.ok(all[index].right <= all[index].left, `${index}`);
  }
});

test("a slice that covers the screen shows exactly today's frame", () => {
  for (const { width, height } of VIEWPORTS) {
    const layout = worldsLayout(2, 1, true);
    close(frameShift(layout, 1, width, height, AVATAR_FOCUS), 0, "shift");
  }
});

test("the open slice puts the avatar at its focus point when the frame allows it", () => {
  for (const { width, height } of VIEWPORTS) {
    const layout = worldsLayout(2, 0, false);
    const { left, right } = midEdges(layout, 0, width);
    const shift = frameShift(layout, 0, width, height, AVATAR_FOCUS);
    const shape = sliceShape(layout, 0, width, height);
    assert.ok(shift > shape.right - width + EPSILON && shift < shape.left - EPSILON, "unclamped");
    close(AVATAR_FOCUS * width + shift, left + (right - left) * OPEN_FOCUS_IN_SLICE, "avatar");
  }
});

test("a focus the frame cannot reach is held at the frame's edge, never inside the slice", () => {
  for (const { width, height } of VIEWPORTS) {
    const layout = worldsLayout(2, 0, false);
    const shape = sliceShape(layout, 0, width, height);
    close(frameShift(layout, 0, width, height, 0.05), shape.left, "held at the left edge");
    close(frameShift(layout, 0, width, height, 0.99), shape.right - width, "held at the right");
  }
});

test("a cover gives the open world the whole screen, as focus does, and keeps the cover", () => {
  const covered = worldsLayout(2, 1, false, 0.42);
  assert.deepEqual(covered.edges, worldsLayout(2, 1, true).edges);
  assert.equal(covered.cover, 0.42);
  assert.equal(worldsLayout(2, 1, false).cover, 1);
});

test("under a cover the avatar slides left to stand clear of the panel's edge", () => {
  for (const { width, height } of VIEWPORTS) {
    for (const open of [0, 1]) {
      const cover = 0.42;
      const shift = frameShift(
        worldsLayout(2, open, false, cover),
        open,
        width,
        height,
        AVATAR_FOCUS,
      );
      assert.ok(shift < 0, "the world moves left");
      close(AVATAR_FOCUS * width + shift, (cover - COVER_CLEARANCE) * width, "avatar");
    }
  }
});

test("a cover easing in moves the framing continuously from where it was", () => {
  const { width, height } = VIEWPORTS[0];
  const from = worldsLayout(2, 0, false);
  const to = worldsLayout(2, 0, false, 0.42);
  let last = frameShift(from, 0, width, height, AVATAR_FOCUS);
  const step = 0.02;
  for (let t = step; t <= 1 + EPSILON; t += step) {
    const shift = frameShift(mixLayouts(from, to, t), 0, width, height, AVATAR_FOCUS);
    assert.ok(Math.abs(shift - last) < width * 0.05, `jump at ${t.toFixed(2)}`);
    last = shift;
  }
  close(last, frameShift(to, 0, width, height, AVATAR_FOCUS), "lands on the target");
});

test("every open slice keeps the frame's edges outside it", () => {
  for (const { width, height } of VIEWPORTS) {
    for (const count of [2, 3, 4]) {
      for (let open = 0; open < count; open++) {
        const layout = worldsLayout(count, open, false);
        const shape = sliceShape(layout, open, width, height);
        const shift = frameShift(layout, open, width, height, AVATAR_FOCUS);
        assert.ok(shift <= shape.left + EPSILON, `left edge, ${open} of ${count}`);
        assert.ok(shift + width >= shape.right - EPSILON, `right edge, ${open} of ${count}`);
      }
    }
  }
});

test("a closed slice centres the middle of the frame when it can", () => {
  for (const { width, height } of VIEWPORTS) {
    const layout = worldsLayout(3, 0, false);
    const shape = sliceShape(layout, 1, width, height);
    const shift = frameShift(layout, 1, width, height, AVATAR_FOCUS);
    const { left, right } = midEdges(layout, 1, width);
    close(CLOSED_FOCUS * width + shift, (left + right) / 2, "centre");
    assert.ok(shift <= shape.left && shift + width >= shape.right);
  }
});

test("a slice's device box covers every device pixel of its shape", () => {
  const box = deviceBox({ polygon: [], left: 10.3, right: 99.1 }, PIXEL_RATIO);
  assert.deepEqual(box, { left: 12, right: 124 });
  assert.ok(box.left <= 10.3 * PIXEL_RATIO && box.right >= 99.1 * PIXEL_RATIO);
});

test("only a closed slice on screen is laid down from its copy", () => {
  const viewport = { width: WIDTH, height: HEIGHT, pixelRatio: PIXEL_RATIO };
  const layout = worldsLayout(3, 1, false);
  assert.equal(closedSlice(layout, 1, 1, viewport, 0, FORMED).visible, false);
  assert.equal(closedSlice(layout, 0, 1, viewport, 0, FORMED).visible, true);
  const focused = worldsLayout(3, 1, true);
  for (const index of [0, 2]) {
    assert.equal(closedSlice(focused, index, 1, viewport, 0, FORMED).visible, false);
  }
});

test("a closed slice's copy is kept until its box, framing, canvas or world changes", () => {
  const viewport = { width: WIDTH, height: HEIGHT, pixelRatio: PIXEL_RATIO };
  const layout = worldsLayout(2, 0, false);
  const key = (overrides = {}) =>
    closedSlice(
      overrides.layout ?? layout,
      1,
      0,
      overrides.viewport ?? viewport,
      overrides.shift ?? -300,
      overrides.world ?? FORMED,
    ).key;
  assert.equal(key(), key());
  assert.equal(key({ shift: -300.1 }), key(), "a sub-pixel slide is not a change");
  assert.notEqual(key({ shift: -310 }), key());
  assert.notEqual(key({ world: "formed:night" }), key());
  assert.notEqual(key({ world: "0.400:day" }), key());
  assert.notEqual(key({ viewport: { ...viewport, width: WIDTH + 40 } }), key());
  assert.notEqual(key({ viewport: { ...viewport, pixelRatio: 1 } }), key());
  assert.notEqual(key({ layout: mixLayouts(layout, worldsLayout(2, 1, false), 0.5) }), key());
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
