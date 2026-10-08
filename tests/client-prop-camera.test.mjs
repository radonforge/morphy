import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cappedVerticalFov,
  clampPropZoom,
  PROP_ZOOM_DEFAULT,
  PROP_ZOOM_MAX,
  PROP_ZOOM_MIN,
  propCameraDistance,
  propCameraTargetY,
  zoomByWheel,
} from "../packages/client/src/game/propCamera.ts";

const EPSILON = 1e-9;
const RAD = Math.PI / 180;

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message}: ${actual} != ${expected}`);
}

function horizontalFov(verticalDeg, aspect) {
  return (2 * Math.atan(Math.tan((verticalDeg * RAD) / 2) * aspect)) / RAD;
}

test("an undisguised prop sits at the base distance and aims at 1.2 m", () => {
  assert.equal(propCameraDistance(null), 4.5);
  assert.equal(propCameraTargetY(null), 1.2);
});

test("a person-height disguise sits at the base distance", () => {
  near(propCameraDistance(1.2), 4.5, "1.2 m disguise");
});

test("the distance follows the square root of the disguise height", () => {
  near(propCameraDistance(1.5), 4.5 * Math.sqrt(1.5 / 1.2), "1.5 m disguise");
  assert.ok(propCameraDistance(0.8) < propCameraDistance(1.0));
});

test("the distance scale is held between 0.7 and 1.4", () => {
  near(propCameraDistance(0.1), 4.5 * 0.7, "tiny disguise");
  near(propCameraDistance(0), 4.5 * 0.7, "flat disguise");
  near(propCameraDistance(5), 4.5 * 1.4, "huge disguise");
});

test("the camera aims just under the top of the disguise", () => {
  near(propCameraTargetY(0.7), 0.63, "cone");
  near(propCameraTargetY(2), 1.8, "dumpster");
});

test("zoom is held within its range", () => {
  assert.equal(clampPropZoom(0.1), PROP_ZOOM_MIN);
  assert.equal(clampPropZoom(3), PROP_ZOOM_MAX);
  assert.equal(clampPropZoom(PROP_ZOOM_DEFAULT), PROP_ZOOM_DEFAULT);
  assert.equal(PROP_ZOOM_MIN, 0.65);
  assert.equal(PROP_ZOOM_MAX, 1.35);
});

test("wheel down pulls the camera back and wheel up brings it in", () => {
  assert.ok(zoomByWheel(PROP_ZOOM_DEFAULT, 100) > PROP_ZOOM_DEFAULT);
  assert.ok(zoomByWheel(PROP_ZOOM_DEFAULT, -100) < PROP_ZOOM_DEFAULT);
  assert.equal(zoomByWheel(PROP_ZOOM_DEFAULT, 0), PROP_ZOOM_DEFAULT);
});

test("wheel travel in and back out returns to the same zoom", () => {
  near(zoomByWheel(zoomByWheel(PROP_ZOOM_DEFAULT, -120), 120), PROP_ZOOM_DEFAULT, "round trip");
});

test("a long wheel run stops at the range ends", () => {
  assert.equal(zoomByWheel(PROP_ZOOM_DEFAULT, 100_000), PROP_ZOOM_MAX);
  assert.equal(zoomByWheel(PROP_ZOOM_DEFAULT, -100_000), PROP_ZOOM_MIN);
});

test("the field of view is unchanged up to 16:9", () => {
  for (const aspect of [4 / 3, 16 / 10, 16 / 9, 0.5]) {
    assert.equal(cappedVerticalFov(55, aspect), 55, String(aspect));
  }
});

test("a viewport wider than 16:9 keeps the 16:9 horizontal view", () => {
  for (const fov of [50, 55, 90]) {
    const wanted = horizontalFov(fov, 16 / 9);
    for (const aspect of [21 / 9, 32 / 9, 2]) {
      const vertical = cappedVerticalFov(fov, aspect);
      assert.ok(vertical < fov, `${fov} at ${aspect}`);
      near(horizontalFov(vertical, aspect), wanted, `${fov} at ${aspect}`);
    }
  }
});

test("a degenerate aspect leaves the field of view alone", () => {
  assert.equal(cappedVerticalFov(55, Number.NaN), 55);
  assert.equal(cappedVerticalFov(55, 0), 55);
});
