import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advancePropTurn,
  idlePropTurn,
  nextTurnStep,
  parseTurnStep,
  setTurnStep,
  turnStep,
} from "../packages/client/src/game/propTurn.ts";
import {
  PROP_TURN_SPEED,
  PROP_TURN_STEPS_DEG,
  PROP_TURN_TAP_MS,
} from "../packages/shared/src/constants.ts";

const FRAME_S = 1 / 60;
const TAP_FRAMES = 6;
const HOLD_FRAMES = Math.ceil(PROP_TURN_TAP_MS / 1000 / FRAME_S) + 30;
const RIGHT = 1;
const LEFT = -1;
const RELEASED = 0;

function idle(rot) {
  return { press: idlePropTurn(), rot };
}

function turn(state, dir, step, deltaSeconds) {
  const rot = advancePropTurn(state.press, state.rot, dir, step, deltaSeconds);
  return { press: state.press, rot };
}

function rad(degrees) {
  return (degrees * Math.PI) / 180;
}

function press(rot, dir, step, frames) {
  let state = idle(rot);
  for (let i = 0; i < frames; i += 1) {
    state = turn(state, dir, step, FRAME_S);
  }
  return turn(state, RELEASED, step, FRAME_S).rot;
}

function assertAngle(actual, expected) {
  const diff = Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected));
  assert.ok(Math.abs(diff) < 1e-9, `expected ${expected}, got ${actual}`);
}

test("a tap of E or Q turns the disguise by the current step", () => {
  for (const step of PROP_TURN_STEPS_DEG) {
    assertAngle(press(0, RIGHT, step, TAP_FRAMES), rad(step));
    assertAngle(press(0, LEFT, step, TAP_FRAMES), -rad(step));
  }
});

test("a tap off the grid lands on the next multiple of the step in its direction", () => {
  for (const step of PROP_TURN_STEPS_DEG) {
    assertAngle(press(0.1, RIGHT, step, TAP_FRAMES), rad(step));
    assertAngle(press(0.1, LEFT, step, TAP_FRAMES), 0);
  }
  assertAngle(press(rad(15), RIGHT, 90, TAP_FRAMES), rad(90));
  assertAngle(press(rad(60), LEFT, 45, TAP_FRAMES), rad(45));
});

test("a tap wraps across the back of the circle", () => {
  for (const step of PROP_TURN_STEPS_DEG) {
    assertAngle(press(Math.PI, RIGHT, step, TAP_FRAMES), -Math.PI + rad(step));
    assertAngle(press(-Math.PI, LEFT, step, TAP_FRAMES), Math.PI - rad(step));
  }
});

test("holding spins continuously and the release keeps the yaw where it is", () => {
  for (const step of PROP_TURN_STEPS_DEG) {
    for (const dir of [RIGHT, LEFT]) {
      let state = idle(0);
      let previous = 0;
      for (let i = 0; i < HOLD_FRAMES; i += 1) {
        previous = state.rot;
        state = turn(state, dir, step, FRAME_S);
      }
      assertAngle(state.rot - previous, dir * PROP_TURN_SPEED * FRAME_S);
      assertAngle(turn(state, RELEASED, step, FRAME_S).rot, state.rot);
    }
  }
});

test("the yaw stays inside [-PI, PI] while spinning", () => {
  let state = idle(0);
  for (let i = 0; i < 600; i += 1) {
    state = turn(state, RIGHT, 90, FRAME_S);
    assert.ok(Math.abs(state.rot) <= Math.PI);
  }
});

test("reversing without a release starts a new tap from the current yaw", () => {
  let state = turn(idle(0), RIGHT, 15, FRAME_S);
  state = turn(state, LEFT, 15, FRAME_S);
  assertAngle(turn(state, RELEASED, 15, FRAME_S).rot, 0);
});

test("no key held leaves the yaw and the press alone", () => {
  const state = idle(1.234);
  const before = { ...state.press };
  const after = turn(state, RELEASED, 90, FRAME_S);
  assertAngle(after.rot, 1.234);
  assert.equal(after.press, state.press);
  assert.deepEqual(after.press, before);
});

test("a tap never spins past its target or swings back against its direction", () => {
  for (const step of PROP_TURN_STEPS_DEG) {
    for (const dir of [RIGHT, LEFT]) {
      let state = idle(0);
      let previous = 0;
      for (let i = 0; i < 11; i += 1) {
        state = turn(state, dir, step, FRAME_S);
        assert.ok(state.rot * dir >= previous * dir - 1e-12);
        assert.ok(state.rot * dir <= rad(step) + 1e-12);
        previous = state.rot;
      }
      const released = turn(state, RELEASED, step, FRAME_S).rot;
      assert.ok(released * dir >= previous * dir - 1e-12);
      assertAngle(released, dir * rad(step));
    }
  }
});

test("a press shorter than the tap window is a tap and one that reaches it is a hold", () => {
  const justUnder = (PROP_TURN_TAP_MS - 1) / 1000;
  const atWindow = PROP_TURN_TAP_MS / 1000;
  let state = turn(idle(0), RIGHT, 45, justUnder);
  assertAngle(turn(state, RELEASED, 45, FRAME_S).rot, rad(45));
  state = turn(idle(0), RIGHT, 45, atWindow);
  assertAngle(turn(state, RELEASED, 45, FRAME_S).rot, PROP_TURN_SPEED * atWindow);
});

test("a step changed mid-tap leaves the press in progress on the step it began with", () => {
  let state = turn(idle(0), RIGHT, 15, FRAME_S);
  state = turn(state, RIGHT, 90, FRAME_S);
  assertAngle(turn(state, RELEASED, 90, FRAME_S).rot, rad(15));
});

test("the step cycles 90, 45, 15 and back to 90", () => {
  assert.deepEqual(PROP_TURN_STEPS_DEG, [90, 45, 15]);
  assert.equal(nextTurnStep(90), 45);
  assert.equal(nextTurnStep(45), 15);
  assert.equal(nextTurnStep(15), 90);
});

test("a missing or unknown stored step is the 90 degree default", () => {
  for (const raw of [null, "", "0", "30", "90.5", "abc", " 45x"]) {
    assert.equal(parseTurnStep(raw), 90, String(raw));
  }
});

test("a stored step is kept", () => {
  for (const step of PROP_TURN_STEPS_DEG) assert.equal(parseTurnStep(String(step)), step);
});

test("a set step is read back", () => {
  setTurnStep(15);
  assert.equal(turnStep(), 15);
  setTurnStep(90);
  assert.equal(turnStep(), 90);
});
