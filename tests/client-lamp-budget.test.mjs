import assert from "node:assert/strict";
import { test } from "node:test";
import { lampWeights } from "../packages/client/src/game/lampBudget.ts";

const FADE = 4;

test("the lamps well inside the budget are fully lit and the rest are dark", () => {
  assert.deepEqual(lampWeights([1, 30, 2, 40], 2, FADE), [1, 0, 1, 0]);
});

test("a light dims to zero as the first lamp left out draws level with it", () => {
  assert.deepEqual(lampWeights([5, 7, 9], 2, FADE), [1, 0.5, 0]);
  assert.deepEqual(lampWeights([5, 8, 9], 2, FADE), [1, 0.15625, 0]);
  assert.deepEqual(lampWeights([5, 9, 9], 2, FADE), [1, 0, 0]);
});

test("with fewer lamps than the budget every lamp is fully lit", () => {
  assert.deepEqual(lampWeights([3, 50], 8, FADE), [1, 1]);
});

test("no lamp's weight jumps while the focus walks past a row of lamps", () => {
  const lamps = Array.from({ length: 12 }, (_, i) => ({ x: i * 9, z: i % 2 === 0 ? -3 : 3 }));
  const step = 0.05;
  let previous;
  for (let x = -20; x <= 120; x += step) {
    const weights = lampWeights(
      lamps.map((lamp) => Math.hypot(lamp.x - x, lamp.z)),
      4,
      FADE,
    );
    if (previous) {
      const jump = Math.max(...weights.map((w, i) => Math.abs(w - previous[i])));
      assert.ok(jump <= (1.5 * 2 * step) / FADE + 1e-9, `jump ${jump} at x=${x.toFixed(2)}`);
    }
    previous = weights;
  }
});
