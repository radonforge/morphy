import assert from "node:assert/strict";
import { test } from "node:test";
import {
  capUnderCeiling,
  ceilingBetween,
  ceilingHeightAt,
  glassRibs,
} from "../packages/client/src/game/ceiling.ts";

const SIZE = 4;
const HEIGHT = 4.25;
const MARGIN = 0.3;
const MIN_DISTANCE = 0.2;

function panel(x, z, kind = "glass", y = HEIGHT) {
  return { x, z, y, size: SIZE, kind };
}

test("the ceiling height is the panel over the spot, the lowest where panels meet, none outside", () => {
  const panels = [panel(2, 2), panel(6, 2, "solid", 8.5)];
  assert.equal(ceilingHeightAt(panels, 1, 3), HEIGHT);
  assert.equal(ceilingHeightAt(panels, 4, 2), HEIGHT);
  assert.equal(ceilingHeightAt(panels, 7, 1), 8.5);
  assert.equal(ceilingHeightAt(panels, 9, 2), null);
  assert.equal(ceilingHeightAt([], 0, 0), null);
});

test("the ceiling over a camera's reach is the lower of the pivot's and the far end's", () => {
  const panels = [panel(2, 2, "glass", 8.5), panel(6, 2, "solid")];
  assert.equal(ceilingBetween(panels, 2, 2, 6, 2), HEIGHT);
  assert.equal(ceilingBetween(panels, 6, 2, 2, 2), HEIGHT);
  assert.equal(ceilingBetween(panels, 2, 2, 20, 2), 8.5);
  assert.equal(ceilingBetween(panels, 20, 2, 30, 2), null);
});

test("a camera rising toward a ceiling stops a margin under it", () => {
  const pivotY = 1.2;
  const dirY = Math.sin(1.2);
  const capped = capUnderCeiling(8, pivotY, dirY, HEIGHT, MARGIN, MIN_DISTANCE);
  assert.ok(Math.abs(pivotY + dirY * capped - (HEIGHT - MARGIN)) < 1e-9);
  assert.ok(capped < 8);
});

test("a camera under open sky, looking level or from below a low ceiling keeps its reach or the minimum", () => {
  assert.equal(capUnderCeiling(8, 1.2, 0.9, null, MARGIN, MIN_DISTANCE), 8);
  assert.equal(capUnderCeiling(8, 1.2, 0, HEIGHT, MARGIN, MIN_DISTANCE), 8);
  assert.equal(capUnderCeiling(8, 1.2, -0.1, HEIGHT, MARGIN, MIN_DISTANCE), 8);
  assert.equal(capUnderCeiling(2, 1.2, 0.1, HEIGHT, MARGIN, MIN_DISTANCE), 2);
  assert.equal(capUnderCeiling(8, 4.2, 0.5, HEIGHT, MARGIN, MIN_DISTANCE), MIN_DISTANCE);
});

test("glass panels get a beam on every edge, a shared edge once, and solid panels none", () => {
  const ribs = glassRibs([panel(2, 2), panel(6, 2), panel(10, 2, "solid")]);
  assert.equal(ribs.length, 7);
  assert.equal(ribs.filter((rib) => rib.axis === "z" && rib.x === 4).length, 1);
  assert.equal(ribs.filter((rib) => rib.x === 10).length, 0);
  assert.ok(ribs.every((rib) => rib.length === SIZE && rib.y === HEIGHT));
});
