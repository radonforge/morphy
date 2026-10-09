import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTROL_GROUPS, mainControls, pipStates } from "../packages/client/src/game/Controls.tsx";
import { lockPointer } from "../packages/client/src/game/pointerLock.ts";
import { movementFromHeld } from "../packages/client/src/game/useControls.ts";
import { DECOY_BUDGET, REROLL_BUDGET } from "../packages/shared/src/index.ts";

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

test("a refused pointer lock stays handled", async () => {
  const rejections = [];
  const capture = (reason) => rejections.push(reason);
  process.on("unhandledRejection", capture);
  lockPointer({ requestPointerLock: () => Promise.reject(new Error("SecurityError")) });
  await new Promise((resolve) => setImmediate(resolve));
  process.off("unhandledRejection", capture);
  assert.deepEqual(rejections, []);
});

test("a void-returning pointer lock is still requested", () => {
  let calls = 0;
  lockPointer({
    requestPointerLock: () => {
      calls += 1;
    },
  });
  assert.equal(calls, 1);
});

test("a missing canvas requests nothing", () => {
  assert.doesNotThrow(() => lockPointer(null));
});

const NOW = 1_000_000;
const BASE_BAR = {
  role: "prop",
  alive: true,
  canShoot: false,
  canTransform: false,
  phase: "starting",
  rerollsLeft: 0,
  decoysLeft: 0,
  tauntReadyAt: 0,
  sonarReadyAt: 0,
  turnMode: "free",
};

const barKeys = (state) => mainControls({ ...BASE_BAR, ...state }, NOW).items.map((c) => c.keys);
const barLabels = (state) => mainControls({ ...BASE_BAR, ...state }, NOW).items.map((c) => c.label);
const dialogKeys = CONTROL_GROUPS.flatMap((g) => g.items.map((c) => c.keys.join(" ")));

const BAR_STATES = {
  prop: { role: "prop", canTransform: true, phase: "hunting", rerollsLeft: 2, decoysLeft: 1 },
  hunter: { role: "hunter", canShoot: true, phase: "hunting" },
  preRound: { role: "prop", phase: "starting" },
};

test("a prop's bar holds only swap, turn, decoy and taunt", () => {
  assert.deepEqual(barKeys(BAR_STATES.prop), [["R"], ["Q", "E"], ["C"], ["F"]]);
  assert.deepEqual(barLabels(BAR_STATES.prop), ["Swap", "Turn", "Decoy", "Taunt"]);
});

test("swap and decoy carry their counts as pips of the budget, turn its mode as a value", () => {
  const [swap, turn, decoy] = mainControls({ ...BASE_BAR, ...BAR_STATES.prop }, NOW).items;
  assert.deepEqual(swap.pips, { left: 2, max: REROLL_BUDGET });
  assert.deepEqual(decoy.pips, { left: 1, max: DECOY_BUDGET });
  assert.equal(turn.value, "free");
});

test("pips light as many as are left and never more than the budget", () => {
  const lit = (pips) => pipStates(pips).map((p) => p.lit);
  assert.deepEqual(lit({ left: 1, max: 3 }), [true, false, false]);
  assert.deepEqual(lit({ left: 0, max: 2 }), [false, false]);
  assert.deepEqual(lit({ left: 5, max: 2 }), [true, true]);
  assert.deepEqual(lit({ left: -1, max: 2 }), [false, false]);
});

test("a hiding prop's bar has no taunt yet", () => {
  assert.deepEqual(barKeys({ ...BAR_STATES.prop, phase: "hiding" }), [["R"], ["Q", "E"], ["C"]]);
});

test("a hunter's bar holds only shoot and sonar", () => {
  assert.deepEqual(barKeys(BAR_STATES.hunter), [["LMB"], ["F"]]);
});

test("the turn entry names a stepped mode in degrees", () => {
  const turn = mainControls({ ...BASE_BAR, ...BAR_STATES.prop, turnMode: 45 }, NOW).items[1];
  assert.equal(turn.value, "45°");
});

test("the taunt and sonar labels count down their cooldown", () => {
  const prop = barLabels({ ...BAR_STATES.prop, tauntReadyAt: NOW + 4_200 });
  assert.equal(prop.at(-1), "Taunt (5s)");
  const hunter = barLabels({ ...BAR_STATES.hunter, sonarReadyAt: NOW + 900 });
  assert.equal(hunter.at(-1), "Sonar (1s)");
});

test("before the round the bar holds only movement", () => {
  assert.deepEqual(barKeys(BAR_STATES.preRound), [["WASD"]]);
});

test("a blinded or downed player's bar is a note, not keys", () => {
  const blinded = mainControls({ ...BASE_BAR, role: "hunter", phase: "hiding" }, NOW);
  assert.ok(blinded.note);
  assert.deepEqual(blinded.items, []);
  const downed = mainControls({ ...BASE_BAR, ...BAR_STATES.hunter, alive: false }, NOW);
  assert.ok(downed.note);
  assert.deepEqual(downed.items, []);
});

test("every key the bar shows is listed in the controls dialog", () => {
  for (const [name, state] of Object.entries(BAR_STATES)) {
    for (const keys of barKeys(state)) {
      assert.ok(
        dialogKeys.includes(keys.join(" ")),
        `${name} bar shows ${keys} missing from the dialog`,
      );
    }
  }
});

test("the keys dropped from the bar are still listed in the controls dialog", () => {
  for (const keys of ["Shift", "Space", "Q E", "V", "1 2 3", "?"]) {
    assert.ok(dialogKeys.includes(keys), `${keys} missing from the dialog`);
  }
});
