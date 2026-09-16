import assert from "node:assert/strict";
import { test } from "node:test";
import { PANIC_RADIUS } from "../packages/bot/src/config.ts";
import { ScriptedPolicy } from "../packages/bot/src/policy/scripted.ts";

const DIFFICULTY = 0.6;
const BOUNDS = { min: { x: -20, y: 0, z: -20 }, max: { x: 20, y: 10, z: 20 } };
const DECISIONS = 12;

/** A contact on the +x axis, in plain sight, disguised and standing still. */
const contact = (id, distance, over = {}) => ({
  id,
  x: distance,
  z: 0,
  distance,
  hasLineOfSight: true,
  disguised: true,
  movedRecently: false,
  facingMe: false,
  ...over,
});

/** A contact wearing no disguise: a character with a weapon, so a hunter. */
const character = (id, distance, over = {}) => contact(id, distance, { disguised: false, ...over });

/** A disguise that is on the move, so not yet worth a shot. */
const mover = (id, distance, over = {}) => contact(id, distance, { movedRecently: true, ...over });

/**
 * A contact known only by sound: moving, out of sight, and — like the footsteps
 * a player hears through a wall — carrying no shape at all. The reflex omits
 * `disguised` for these, so the fixture must too.
 */
const heard = (id, distance) => {
  const { disguised, ...rest } = contact(id, distance, {
    movedRecently: true,
    hasLineOfSight: false,
  });
  return rest;
};

const observation = (seq, entities, self = {}) => ({
  seq,
  visibility: "limited",
  phase: "hunting",
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
    ...self,
  },
  entities,
  map: { bounds: BOUNDS, doorways: [], nearbyProps: [] },
});

const asProp = { role: "prop", hp: 0, propType: "crate" };

/** Run `count` decision cycles, collecting every intent. */
async function run(policy, count, entitiesAt, self) {
  const intents = [];
  for (let i = 0; i < count; i++) {
    intents.push(await policy.decide(observation(i + 1, entitiesAt(i), self)));
  }
  return intents;
}

const kinds = (intents) => [...new Set(intents.map((intent) => intent.kind))];

/**
 * The regression that made a hunter follow another hunter around the map. A
 * teammate can never come to look like a prop, so as a suspect it is one the
 * hunter can never finish inspecting.
 *
 * The moving case is the one that mattered: a teammate standing still was
 * already distinguishable from the two signals perception used to carry, and a
 * teammate on the move was not — which is why the hunter that got followed
 * around the map was the one walking about.
 */
test("a hunter never walks up to a contact wearing no disguise", async () => {
  for (const distance of [0.8, 6, 15]) {
    for (const moving of [false, true]) {
      const policy = new ScriptedPolicy(DIFFICULTY);
      const intents = await run(policy, DECISIONS, () => [
        character("hunter-b", distance, { movedRecently: moving }),
      ]);
      assert.deepEqual(
        kinds(intents),
        ["patrol"],
        `a ${moving ? "moving" : "still"} teammate at ${distance}m is neither chased nor shot at`,
      );
    }
  }
});

test("a hunter keeps hunting past a teammate stood in the way", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intents = await run(policy, DECISIONS, () => [
    character("hunter-b", 0.8),
    contact("prop-a", 9),
  ]);
  assert.deepEqual(kinds(intents), ["shootTarget"]);
  assert.equal(intents[0].targetId, "prop-a", "the nearer teammate is not a target");
});

test("a hunter shoots a disguise standing still in range", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = (await run(policy, 1, () => [contact("prop-a", 9)]))[0];
  assert.equal(intent.kind, "shootTarget");
  assert.equal(intent.targetId, "prop-a");
});

test("a hunter chases a disguise it cannot shoot yet, however long it takes", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const pointBlank = await run(policy, DECISIONS, () => [mover("prop-a", 0.8)]);
  assert.deepEqual(kinds(pointBlank), ["inspect"], "a mover at arm's reach is not given up on");

  const bySound = await run(new ScriptedPolicy(DIFFICULTY), DECISIONS, () => [heard("prop-b", 4)]);
  assert.deepEqual(kinds(bySound), ["inspect"], "nor is a contact known only by sound");
});

/**
 * A walking hunter loses 2.5 m/s to a panicking prop, and a prop on the move is
 * never `shootable`, so the contact a hunter most needs to catch was the one it
 * could only ever walk after.
 */
test("a hunter runs down a disguise it can see running", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = (await run(policy, 1, () => [mover("prop-a", 6)]))[0];
  assert.equal(intent.kind, "inspect");
  assert.equal(intent.run, true);
});

/**
 * The gate that keeps the chase from becoming a sprint at everything. A contact
 * known only by sound carries no shape, so it could be a teammate — running at
 * every noise would rebuild the hunter pack, and faster than before.
 */
test("a hunter walks to a suspect it has not seen run", async () => {
  const bySound = (await run(new ScriptedPolicy(DIFFICULTY), 1, () => [heard("noise", 6)]))[0];
  assert.equal(bySound.kind, "inspect");
  assert.equal(bySound.run, false, "a contact known only by sound is approached at walking pace");

  const still = (await run(new ScriptedPolicy(DIFFICULTY), 1, () => [contact("prop-b", 40)]))[0];
  assert.equal(still.kind, "inspect");
  assert.equal(still.run, false, "a disguise standing still out of range is not run at");
});

/**
 * The fairness half of the shape signal: a player who only hears footsteps
 * cannot tell a teammate from a prop, so neither may a bot. A heard contact
 * carries no shape, and is investigated whoever it turns out to be.
 */
test("a hunter investigates a noise without knowing whose it is", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intents = await run(policy, DECISIONS, () => [heard("someone", 5)]);
  assert.deepEqual(kinds(intents), ["inspect"]);
  assert.equal(intents[0].targetId, "someone");
});

test("a hunter prefers a seen disguise to a noise, and a noise to a seen teammate", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = (
    await run(policy, 1, () => [character("hunter-b", 1), heard("noise", 9), mover("prop-a", 12)])
  )[0];
  assert.equal(intent.kind, "inspect");
  assert.equal(intent.targetId, "noise", "the nearest contact that is not a known teammate");
});

test("a hunter chases the nearest disguise, not the nearest contact", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = (
    await run(policy, 1, () => [
      character("hunter-b", 1),
      mover("prop-far", 12),
      mover("prop-near", 6),
    ])
  )[0];
  assert.equal(intent.kind, "inspect");
  assert.equal(intent.targetId, "prop-near");
});

test("a prop flees the nearest contact wearing no disguise", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = (await run(policy, 1, () => [character("hunter-b", PANIC_RADIUS - 3)], asProp))[0];
  assert.equal(intent.kind, "moveTo");
  assert.equal(intent.run, true);
  assert.ok(intent.x < 0, `the flee goes away from the hunter on +x, got x=${intent.x}`);
});

test("a prop freezes instead of running when the hunter is already watching", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = (
    await run(
      policy,
      1,
      () => [character("hunter-b", PANIC_RADIUS - 3, { facingMe: true })],
      asProp,
    )
  )[0];
  assert.equal(intent.kind, "idle");
});

/** A fellow prop is not a threat, whatever it is doing — it cannot shoot. */
test("a prop holds its hiding plan next to another disguise", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intents = await run(policy, DECISIONS, () => [mover("prop-b", 1)], asProp);
  assert.deepEqual(kinds(intents), ["hideAs"]);
});

/** Footsteps nearby could be the hunter's, and a prop that assumed otherwise
 * would be reading information a player does not have. */
test("a prop runs from a noise it cannot see", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = (await run(policy, 1, () => [heard("noise", PANIC_RADIUS - 3)], asProp))[0];
  assert.equal(intent.kind, "moveTo");
  assert.equal(intent.run, true);
});
