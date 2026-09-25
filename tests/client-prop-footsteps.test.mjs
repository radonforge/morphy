import assert from "node:assert/strict";
import { test } from "node:test";
import { STEP_DISTANCE } from "../packages/client/src/game/movement.ts";
import { advanceStride } from "../packages/client/src/game/propRustle.ts";
import { MOVE_SPEED, RUN_MULTIPLIER_PROP } from "../packages/shared/src/index.ts";

const FRAME_S = 1 / 60;
const SYNC_EVERY_FRAMES = 3;
const SECONDS = 4;

/**
 * A remote prop walking down +x at `speed`, seen through a position that only
 * updates every few frames, the way the room's patches arrive. Returns every
 * rustle it made.
 */
function walk(speed) {
  let stride;
  let x = 0;
  const rustles = [];
  const frames = Math.round(SECONDS / FRAME_S);
  for (let frame = 0; frame < frames; frame++) {
    if (frame % SYNC_EVERY_FRAMES === 0) x = speed * frame * FRAME_S;
    const next = advanceStride(stride, x, 0, FRAME_S);
    stride = next.stride;
    if (next.rustle) rustles.push(next.rustle);
  }
  return { rustles, distance: x };
}

test("a prop standing still makes no sound", () => {
  assert.deepEqual(walk(0).rustles, []);
});

test("a walking prop rustles once per stride", () => {
  const { rustles, distance } = walk(MOVE_SPEED);
  assert.equal(rustles.length, Math.floor(distance / STEP_DISTANCE));
  assert.ok(rustles.every((r) => r === "walk"));
});

test("a running prop rustles at a run", () => {
  const { rustles } = walk(MOVE_SPEED * RUN_MULTIPLIER_PROP);
  assert.ok(rustles.length > 0);
  assert.equal(rustles.at(-1), "run");
});

test("a teleport is not a stride", () => {
  const first = advanceStride(undefined, 0, 0, FRAME_S).stride;
  const jumped = advanceStride(first, STEP_DISTANCE * 5, 0, FRAME_S);
  assert.equal(jumped.rustle, null);
  assert.equal(jumped.stride.travelled, 0);
});
