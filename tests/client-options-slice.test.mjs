import assert from "node:assert/strict";
import { test } from "node:test";

const { OPTIONS_SLICE_MIN_PX, OPTIONS_SLICE_WIDTH, optionsSliceFraction, optionsSliceGeometry } =
  await import("../packages/client/src/ui/optionsGeometry.ts");
const { SLICE_SLANT, sliceShape, worldsLayout } = await import(
  "../packages/client/src/ui/worldSlices.ts"
);

const EPSILON = 1e-9;
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 2560, height: 1080 },
];

const slope = ([top, bottom], height) => (top[0] - bottom[0]) / height;

test("the slice covers its share of a wide screen and at least its minimum on a narrow one", () => {
  assert.equal(optionsSliceFraction(1440), OPTIONS_SLICE_WIDTH);
  assert.equal(optionsSliceFraction(800), OPTIONS_SLICE_MIN_PX / 800);
  assert.equal(optionsSliceFraction(OPTIONS_SLICE_MIN_PX - 1), 1);
  assert.equal(optionsSliceFraction(0), 1);
});

test("the slice's edge leans exactly like a world slice's edge", () => {
  for (const { width, height } of VIEWPORTS) {
    const { shape } = optionsSliceGeometry(width, height);
    const world = sliceShape(worldsLayout(2, 0, false), 1, width, height);
    const [topLeft, , , bottomLeft] = shape.polygon;
    const [worldTop, , , worldBottom] = world.polygon;
    assert.ok(
      Math.abs(slope([topLeft, bottomLeft], height) - slope([worldTop, worldBottom], height)) <
        EPSILON,
    );
    assert.ok(Math.abs(topLeft[0] - bottomLeft[0] - SLICE_SLANT * width) < EPSILON);
  }
});

test("the edge crosses mid-height where the slice's share begins, and the right side is the screen's", () => {
  const { width, height } = VIEWPORTS[0];
  const { shape, edgeMid } = optionsSliceGeometry(width, height);
  assert.ok(Math.abs(edgeMid - (1 - OPTIONS_SLICE_WIDTH) * width) < EPSILON);
  const [topLeft, topRight, bottomRight, bottomLeft] = shape.polygon;
  assert.ok(Math.abs((topLeft[0] + bottomLeft[0]) / 2 - edgeMid) < EPSILON);
  assert.deepEqual(
    [topRight, bottomRight],
    [
      [width, 0],
      [width, height],
    ],
  );
  assert.equal(shape.right, width);
});

test("the lean in degrees is the edge's own angle from vertical", () => {
  for (const { width, height } of VIEWPORTS) {
    const { leanDeg } = optionsSliceGeometry(width, height);
    const expected = (Math.atan((SLICE_SLANT * width) / height) * 180) / Math.PI;
    assert.ok(Math.abs(leanDeg - expected) < EPSILON);
    assert.ok(leanDeg > 0 && leanDeg < 10);
  }
});

test("a slice covering the whole screen has no edge and no lean", () => {
  const { shape, edgeMid, leanDeg } = optionsSliceGeometry(480, 800);
  assert.equal(edgeMid, 0);
  assert.equal(leanDeg, 0);
  assert.deepEqual(shape.polygon, [
    [0, 0],
    [480, 0],
    [480, 800],
    [0, 800],
  ]);
});
