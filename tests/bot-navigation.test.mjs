import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_REPLANS_BEFORE_BLOCKED } from "../packages/bot/src/config.ts";
import { Reflex } from "../packages/bot/src/reflex.ts";

const DIFFICULTY = 0.6;
const TICK_SECONDS = 0.05;
const TICK_MS = 50;
const MAX_TICKS = 400;

/** A wall tall and long enough to cut the map in two, leaving no way around it. */
const PARTITION = { position: { x: 0, y: 2, z: 0 }, size: { x: 1, y: 4, z: 20 } };

const map = (colliders) => ({
  id: "navigation",
  bounds: { min: { x: -10, y: 0, z: -10 }, max: { x: 10, y: 10, z: 10 } },
  spawnPoints: { props: [{ x: 0, y: 0, z: 0 }] },
  colliders,
  tiles: [],
  scenery: [],
  props: [],
  propCatalog: [],
});

const hidingWorld = (x, z) => ({
  phase: "hiding",
  self: {
    id: "self",
    name: "self",
    x,
    y: 0,
    z,
    rot: 0,
    aim: 0,
    role: "prop",
    alive: true,
    hp: 0,
    kills: 0,
    propType: "crate",
    ready: true,
  },
  others: [],
  decoys: [],
});

function reflexAt(colliders, x, z) {
  const reflex = new Reflex(DIFFICULTY, "limited");
  reflex.setMap(map(colliders));
  reflex.syncPosition(x, z);
  return reflex;
}

/** Drive `hideAs` until the reflex reports arrival, or give up after `MAX_TICKS`. */
function runToArrival(reflex, goal, world) {
  for (let tick = 1; tick <= MAX_TICKS; tick++) {
    const now = tick * TICK_MS;
    reflex.executeIntent({ kind: "hideAs", seq: 1, ...goal }, world, TICK_SECONDS, now);
    world.self.x = reflex.x;
    world.self.z = reflex.z;
    if (reflex.consumeArrivalEvent()) return { arrived: true, ticks: tick };
  }
  return { arrived: false, ticks: MAX_TICKS };
}

test("a goal behind an unbroken wall is never reported as reached", () => {
  const reflex = reflexAt([PARTITION], -5, 0);
  const world = hidingWorld(-5, 0);
  const outcome = runToArrival(reflex, { x: 5, z: 0 }, world);

  assert.equal(outcome.arrived, false);
  assert.ok(reflex.x < 0, `bot crossed the partition to x=${reflex.x}`);
});

test("a goal that cannot be planned raises pathBlocked for the policy", () => {
  const reflex = reflexAt([PARTITION], -5, 0);
  const world = hidingWorld(-5, 0);
  const intent = { kind: "hideAs", seq: 1, x: 5, z: 0 };

  for (let attempt = 1; attempt <= MAX_REPLANS_BEFORE_BLOCKED; attempt++) {
    reflex.executeIntent(intent, world, TICK_SECONDS, TICK_MS * attempt);
  }

  const now = TICK_MS * MAX_REPLANS_BEFORE_BLOCKED;
  assert.equal(reflex.buildObservation(world, 1, now).pathBlocked, true);
});

test("a reachable goal still settles once its path has been walked", () => {
  const reflex = reflexAt([], 0, 0);
  const world = hidingWorld(0, 0);
  const outcome = runToArrival(reflex, { x: 4, z: 3 }, world);

  assert.equal(outcome.arrived, true);
  assert.equal(reflex.buildObservation(world, 1, outcome.ticks * TICK_MS).pathBlocked, false);
});
