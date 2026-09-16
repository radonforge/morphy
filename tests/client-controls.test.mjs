import assert from "node:assert/strict";
import { test } from "node:test";
import { movementFromHeld } from "../packages/client/src/game/useControls.ts";

test("no held key drives no action", () => {
  const keys = movementFromHeld(new Set());
  assert.deepEqual(keys, {
    forward: false,
    back: false,
    left: false,
    right: false,
    run: false,
    jump: false,
    turnLeft: false,
    turnRight: false,
  });
});

test("an action stays held while any of its keys is down", () => {
  const held = new Set(["KeyW", "ArrowUp"]);
  assert.equal(movementFromHeld(held).forward, true);
  held.delete("KeyW");
  assert.equal(movementFromHeld(held).forward, true, "ArrowUp is still down");
  held.delete("ArrowUp");
  assert.equal(movementFromHeld(held).forward, false);
});

test("either shift runs, and releasing one does not stop the other", () => {
  const held = new Set(["ShiftLeft", "ShiftRight"]);
  held.delete("ShiftRight");
  assert.equal(movementFromHeld(held).run, true);
});

test("opposing keys are both reported, leaving the caller to cancel them", () => {
  const keys = movementFromHeld(new Set(["KeyW", "KeyS"]));
  assert.equal(keys.forward, true);
  assert.equal(keys.back, true);
});

test("unmapped keys drive nothing", () => {
  const keys = movementFromHeld(new Set(["KeyZ", "F5", "Tab"]));
  assert.equal(Object.values(keys).some(Boolean), false);
});
