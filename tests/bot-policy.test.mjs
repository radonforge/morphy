import assert from "node:assert/strict";
import { test } from "node:test";
import { INSPECT_BUDGET_DECISIONS, INSPECT_PARK_DECISIONS } from "../packages/bot/src/config.ts";
import { ScriptedPolicy } from "../packages/bot/src/policy/scripted.ts";

const DIFFICULTY = 0.6;
const BOUNDS = { min: { x: -20, y: 0, z: -20 }, max: { x: 20, y: 10, z: 20 } };

/** A contact a hunter can never identify: in sight, and never reading as a prop. */
const unidentified = (id, distance) => ({
  id,
  x: distance,
  z: 0,
  distance,
  hasLineOfSight: true,
  looksLikeProp: false,
  movedRecently: false,
  facingMe: false,
});

const observation = (seq, entities, phase = "hunting") => ({
  seq,
  visibility: "limited",
  phase,
  pathBlocked: false,
  self: {
    role: "hunter",
    alive: true,
    hp: 100,
    x: 0,
    z: 0,
    rot: 0,
    propType: "",
    canShootNow: true,
  },
  entities,
  map: { bounds: BOUNDS, doorways: [], nearbyProps: [] },
});

/** Run `count` decision cycles from `seq`, collecting the intent kind of each. */
async function run(policy, count, entitiesAt, seq = 1) {
  const kinds = [];
  for (let i = 0; i < count; i++) {
    const intent = await policy.decide(observation(seq + i, entitiesAt(i)));
    kinds.push(intent.kind);
  }
  return kinds;
}

test("a hunter gives up on a contact it has stood next to without identifying", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const kinds = await run(policy, INSPECT_BUDGET_DECISIONS + 3, () => [
    unidentified("hunter-b", 0.8),
  ]);
  assert.equal(kinds[0], "inspect");
  assert.ok(kinds.includes("patrol"), `expected the lock to break, got ${kinds.join(",")}`);
});

test("a clump whose nearest member keeps changing still breaks apart", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const jitter = (i) => [
    unidentified("hunter-b", i % 2 === 0 ? 0.7 : 0.9),
    unidentified("hunter-c", i % 2 === 0 ? 0.9 : 0.7),
    unidentified("hunter-d", 1.1),
  ];
  const kinds = await run(policy, INSPECT_PARK_DECISIONS + 6, jitter);
  assert.ok(kinds.includes("patrol"), `expected the clump to break, got ${kinds.join(",")}`);
});

test("a contact still being approached is never given up on", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const kinds = await run(policy, INSPECT_BUDGET_DECISIONS * 3, () => [unidentified("prop-a", 15)]);
  assert.ok(
    kinds.every((kind) => kind === "inspect"),
    `expected an uninterrupted chase, got ${kinds.join(",")}`,
  );
});

test("a contact known only by sound is never given up on", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const heard = () => [{ ...unidentified("prop-a", 0.8), hasLineOfSight: false }];
  const kinds = await run(policy, INSPECT_BUDGET_DECISIONS * 3, heard);
  assert.ok(
    kinds.every((kind) => kind === "inspect"),
    `expected the search to continue, got ${kinds.join(",")}`,
  );
});

test("a given-up contact is shot the moment it reads as a prop", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const kinds = await run(policy, INSPECT_BUDGET_DECISIONS + 3, () => [
    unidentified("mystery", 0.8),
  ]);
  assert.ok(kinds.includes("patrol"), `expected the lock to break, got ${kinds.join(",")}`);

  const revealed = { ...unidentified("mystery", 0.8), looksLikeProp: true };
  const intent = await policy.decide(observation(INSPECT_BUDGET_DECISIONS + 4, [revealed]));
  assert.equal(intent.kind, "shootTarget");
  assert.equal(intent.targetId, "mystery");
});

test("a new round forgets which contacts were given up on", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const clump = () => [unidentified("hunter-b", 0.8)];
  const kinds = await run(policy, INSPECT_BUDGET_DECISIONS + 3, clump);
  assert.ok(kinds.includes("patrol"), `expected the lock to break, got ${kinds.join(",")}`);

  const seq = INSPECT_BUDGET_DECISIONS + 4;
  await policy.decide(observation(seq, clump(0), "hiding"));
  const intent = await policy.decide(observation(seq + 1, clump(0)));
  assert.equal(intent.kind, "inspect");
  assert.equal(intent.targetId, "hunter-b");
});
