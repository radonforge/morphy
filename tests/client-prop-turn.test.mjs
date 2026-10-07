import assert from "node:assert/strict";
import { test } from "node:test";
import { advancePropTurn, PROP_TURN_IDLE } from "../packages/client/src/game/propTurn.ts";
import {
  PROP_TURN_FINE_STEP,
  PROP_TURN_SNAP,
  PROP_TURN_SPEED,
  PROP_TURN_TAP_MS,
} from "../packages/shared/src/constants.ts";

const FRAME_S = 1 / 60;
const TAP_FRAMES = 6;
const HOLD_FRAMES = Math.ceil(PROP_TURN_TAP_MS / 1000 / FRAME_S) + 30;
const RIGHT = { dir: 1, coarse: false };
const LEFT = { dir: -1, coarse: false };
const RELEASED = { dir: 0, coarse: false };

function press(rot, input, frames) {
  let state = { press: PROP_TURN_IDLE, rot };
  for (let i = 0; i < frames; i += 1) {
    state = advancePropTurn(state.press, state.rot, input, FRAME_S);
  }
  return advancePropTurn(state.press, state.rot, RELEASED, FRAME_S).rot;
}

function assertAngle(actual, expected) {
  const diff = Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected));
  assert.ok(Math.abs(diff) < 1e-9, `expected ${expected}, got ${actual}`);
}

test("a tap of E turns the disguise one fine step right", () => {
  assertAngle(press(0, RIGHT, TAP_FRAMES), PROP_TURN_FINE_STEP);
});

test("a tap of Q turns the disguise one fine step left", () => {
  assertAngle(press(0, LEFT, TAP_FRAMES), -PROP_TURN_FINE_STEP);
});

test("a tap off the grid lands on the next fine step in its direction", () => {
  assertAngle(press(0.1, RIGHT, TAP_FRAMES), PROP_TURN_FINE_STEP);
  assertAngle(press(0.1, LEFT, TAP_FRAMES), 0);
});

test("a Shift tap snaps to the next quarter turn in its direction", () => {
  assertAngle(press(0, { dir: 1, coarse: true }, TAP_FRAMES), PROP_TURN_SNAP);
  assertAngle(press(0, { dir: -1, coarse: true }, TAP_FRAMES), -PROP_TURN_SNAP);
  assertAngle(press(PROP_TURN_FINE_STEP, { dir: 1, coarse: true }, TAP_FRAMES), PROP_TURN_SNAP);
});

test("Shift down for any frame of a tap makes it a quarter turn", () => {
  let state = advancePropTurn(PROP_TURN_IDLE, 0, { dir: 1, coarse: true }, FRAME_S);
  state = advancePropTurn(state.press, state.rot, RIGHT, FRAME_S);
  assertAngle(advancePropTurn(state.press, state.rot, RELEASED, FRAME_S).rot, PROP_TURN_SNAP);
});

test("a tap wraps across the back of the circle", () => {
  assertAngle(press(Math.PI, RIGHT, TAP_FRAMES), -Math.PI + PROP_TURN_FINE_STEP);
  assertAngle(press(-Math.PI, LEFT, TAP_FRAMES), Math.PI - PROP_TURN_FINE_STEP);
  assertAngle(press(Math.PI, { dir: 1, coarse: true }, TAP_FRAMES), -PROP_TURN_SNAP);
});

test("holding spins continuously and the release keeps the yaw where it is", () => {
  for (const coarse of [false, true]) {
    for (const dir of [1, -1]) {
      let state = { press: PROP_TURN_IDLE, rot: 0 };
      let previous = 0;
      for (let i = 0; i < HOLD_FRAMES; i += 1) {
        previous = state.rot;
        state = advancePropTurn(state.press, state.rot, { dir, coarse }, FRAME_S);
      }
      assertAngle(state.rot - previous, dir * PROP_TURN_SPEED * FRAME_S);
      assertAngle(advancePropTurn(state.press, state.rot, RELEASED, FRAME_S).rot, state.rot);
    }
  }
});

test("the yaw stays inside [-PI, PI] while spinning", () => {
  let state = { press: PROP_TURN_IDLE, rot: 0 };
  for (let i = 0; i < 600; i += 1) {
    state = advancePropTurn(state.press, state.rot, RIGHT, FRAME_S);
    assert.ok(Math.abs(state.rot) <= Math.PI);
  }
});

test("reversing without a release starts a new tap from the current yaw", () => {
  let state = advancePropTurn(PROP_TURN_IDLE, 0, RIGHT, FRAME_S);
  state = advancePropTurn(state.press, state.rot, LEFT, FRAME_S);
  assertAngle(advancePropTurn(state.press, state.rot, RELEASED, FRAME_S).rot, 0);
});

test("no key held leaves the yaw alone", () => {
  assertAngle(advancePropTurn(PROP_TURN_IDLE, 1.234, RELEASED, FRAME_S).rot, 1.234);
});

test("a tap never spins past its target or swings back against its direction", () => {
  for (const dir of [1, -1]) {
    let state = { press: PROP_TURN_IDLE, rot: 0 };
    let previous = 0;
    for (let i = 0; i < 11; i += 1) {
      state = advancePropTurn(state.press, state.rot, { dir, coarse: false }, FRAME_S);
      assert.ok(state.rot * dir >= previous * dir - 1e-12);
      assert.ok(state.rot * dir <= PROP_TURN_FINE_STEP + 1e-12);
      previous = state.rot;
    }
    const released = advancePropTurn(state.press, state.rot, RELEASED, FRAME_S).rot;
    assert.ok(released * dir >= previous * dir - 1e-12);
    assertAngle(released, dir * PROP_TURN_FINE_STEP);
  }
});

test("a press shorter than the tap window is a tap and one that reaches it is a hold", () => {
  const justUnder = (PROP_TURN_TAP_MS - 1) / 1000;
  const atWindow = PROP_TURN_TAP_MS / 1000;
  let state = advancePropTurn(PROP_TURN_IDLE, 0, RIGHT, justUnder);
  assertAngle(advancePropTurn(state.press, state.rot, RELEASED, FRAME_S).rot, PROP_TURN_FINE_STEP);
  state = advancePropTurn(PROP_TURN_IDLE, 0, RIGHT, atWindow);
  assertAngle(
    advancePropTurn(state.press, state.rot, RELEASED, FRAME_S).rot,
    PROP_TURN_SPEED * atWindow,
  );
});

test("Shift pressed partway through a tap still snaps to the quarter turn", () => {
  let state = advancePropTurn(PROP_TURN_IDLE, 0, RIGHT, FRAME_S);
  state = advancePropTurn(state.press, state.rot, { dir: 1, coarse: true }, FRAME_S);
  assertAngle(advancePropTurn(state.press, state.rot, RELEASED, FRAME_S).rot, PROP_TURN_SNAP);
});
