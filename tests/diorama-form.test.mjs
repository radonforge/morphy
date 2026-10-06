import assert from "node:assert/strict";
import { test } from "node:test";

const { DIORAMA_FORM_S, pieceScale } = await import("../packages/client/src/ui/dioramaForm.ts");

const PIECES = 8;
const scales = (age) =>
  Array.from({ length: PIECES }, (_, index) => pieceScale(age, index, PIECES));

test("nothing shows while the world's models are still loading", () => {
  assert.deepEqual(scales(null), Array(PIECES).fill(0));
});

test("a world has not started forming the instant it loads", () => {
  assert.deepEqual(scales(0), Array(PIECES).fill(0));
});

test("the whole world has formed once the sweep is over", () => {
  assert.deepEqual(scales(DIORAMA_FORM_S), Array(PIECES).fill(1));
  assert.deepEqual(scales(DIORAMA_FORM_S * 4), Array(PIECES).fill(1));
});

test("pieces form in order, the first ahead of the last", () => {
  const mid = scales(DIORAMA_FORM_S / 2);
  for (let index = 1; index < PIECES; index++) assert.ok(mid[index] <= mid[index - 1]);
  assert.ok(mid[0] > mid[PIECES - 1]);
});

test("a piece only ever grows as the world forms", () => {
  const steps = 60;
  for (let index = 0; index < PIECES; index++) {
    let previous = 0;
    for (let step = 0; step <= steps; step++) {
      const scale = pieceScale((step / steps) * DIORAMA_FORM_S, index, PIECES);
      assert.ok(scale >= previous);
      previous = scale;
    }
  }
});

test("a world of one piece forms it without a stagger", () => {
  assert.equal(pieceScale(DIORAMA_FORM_S, 0, 1), 1);
  assert.equal(pieceScale(0, 0, 1), 0);
});
