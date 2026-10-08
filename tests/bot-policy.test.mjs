import assert from "node:assert/strict";
import { test } from "node:test";
import { ENGAGE_RANGE_MAX, SONAR_PATIENCE_DECISIONS } from "../packages/bot/src/config.ts";
import { ScriptedPolicy } from "../packages/bot/src/policy/scripted.ts";

const DIFFICULTY = 0.6;
const BOUNDS = { min: { x: -20, y: 0, z: -20 }, max: { x: 20, y: 10, z: 20 } };
const DECISIONS = 12;
/** Past the engage range at any difficulty, so a suspect there can only be closed on. */
const OUT_OF_REACH = ENGAGE_RANGE_MAX + 2;

/**
 * A contact on the +x axis, in plain sight, disguised and standing still, that
 * has given nothing away: to a hunter, one more object in the room.
 */
const contact = (id, distance, over = {}) => ({
  id,
  x: distance,
  z: 0,
  distance,
  hasLineOfSight: true,
  disguised: true,
  movedRecently: false,
  facingMe: false,
  tellRecently: false,
  ...over,
});

/** A disguise standing still that gave itself away a moment ago: a suspect. */
const suspect = (id, distance, over = {}) => contact(id, distance, { tellRecently: true, ...over });

/** A contact wearing no disguise: a character with a weapon, so a hunter. */
const character = (id, distance, over = {}) => contact(id, distance, { disguised: false, ...over });

/** A disguise seen on the move, so a suspect. */
const mover = (id, distance, over = {}) =>
  contact(id, distance, { movedRecently: true, tellRecently: true, ...over });

/**
 * A contact known only by sound: moving, out of sight, and (like the footsteps
 * a player hears through a wall) carrying no shape at all. The reflex omits
 * `disguised` for these, so the fixture must too.
 */
const heard = (id, distance) => {
  const { disguised, tellRecently, ...rest } = contact(id, distance, {
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
  arrived: false,
  self: {
    role: "hunter",
    alive: true,
    hp: 100,
    x: 0,
    z: 0,
    rot: 0,
    propType: "",
    canShootNow: true,
    canTauntNow: false,
    ...self,
  },
  entities,
  sounds: [],
  map: { bounds: BOUNDS, doorways: [] },
});

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
 * teammate on the move was not, which is why the hunter that got followed
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
    suspect("prop-a", 9),
  ]);
  assert.deepEqual(kinds(intents), ["shootTarget"]);
  assert.equal(intents[0].targetId, "prop-a", "the nearer teammate is not a target");
});

test("a hunter shoots a suspect standing still in range", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = (await run(policy, 1, () => [suspect("prop-a", 9)]))[0];
  assert.equal(intent.kind, "shootTarget");
  assert.equal(intent.targetId, "prop-a");
});

/**
 * The shape leak this closes: a hunter used to be shown players only, so every
 * disguise in sight was a prop by construction and was shot on sight. A
 * disguise that gave nothing away is now one more object in the room.
 */
test("a hunter leaves a disguise that gave nothing away alone between probes", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intents = await run(policy, DECISIONS, () => [contact("crate-a", 6)]);
  assert.deepEqual(kinds(intents), ["patrol"]);
});

test("a hunter due a probe shoots the nearest object in reach", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = await policy.decide(
    observation(1, [contact("crate-far", 12), contact("crate-near", 5)], { canProbeNow: true }),
  );
  assert.equal(intent.kind, "shootTarget");
  assert.equal(intent.targetId, "crate-near");
});

test("a hunter never probes the same object twice", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const room = [contact("crate-far", 12), contact("crate-near", 5)];
  await policy.decide(observation(1, room, { canProbeNow: true }));
  await policy.decide(observation(2, room, { canProbeNow: false, lastShotTargetId: "crate-near" }));
  const next = await policy.decide(
    observation(3, room, { canProbeNow: true, lastShotTargetId: "crate-near" }),
  );
  assert.equal(next.kind, "shootTarget");
  assert.equal(next.targetId, "crate-far", "the one that survived a shot is furniture");
});

test("a probe cut short by a shot at a suspect is still owed", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const room = [contact("crate-far", 12), contact("crate-near", 5)];
  await policy.decide(observation(1, room, { canProbeNow: true }));
  await policy.decide(observation(2, [...room, suspect("prop-a", 8)], { canProbeNow: true }));
  await policy.decide(observation(3, room, { canProbeNow: false, lastShotTargetId: "prop-a" }));
  const next = await policy.decide(
    observation(4, room, { canProbeNow: true, lastShotTargetId: "prop-a" }),
  );
  assert.equal(next.kind, "shootTarget");
  assert.equal(next.targetId, "crate-near", "the crate it never shot is not written off");
});

test("a hunter probes nothing out of reach", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = await policy.decide(
    observation(1, [contact("crate-far", 40)], { canProbeNow: true }),
  );
  assert.equal(intent.kind, "patrol");
});

test("a hunter goes after a suspect before it spends a probe", async () => {
  const inReach = await new ScriptedPolicy(DIFFICULTY).decide(
    observation(1, [contact("crate", 3), mover("prop-a", 8)], { canProbeNow: true }),
  );
  assert.equal(inReach.kind, "shootTarget");
  assert.equal(inReach.targetId, "prop-a");

  const outOfReach = await new ScriptedPolicy(DIFFICULTY).decide(
    observation(1, [contact("crate", 3), mover("prop-a", OUT_OF_REACH)], { canProbeNow: true }),
  );
  assert.equal(outOfReach.kind, "inspect");
  assert.equal(outOfReach.targetId, "prop-a");
});

test("a hunter chases a disguise it cannot shoot yet, however long it takes", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const farOff = await run(policy, DECISIONS, () => [mover("prop-a", OUT_OF_REACH)]);
  assert.deepEqual(kinds(farOff), ["inspect"], "a mover out of reach is not given up on");

  const bySound = await run(new ScriptedPolicy(DIFFICULTY), DECISIONS, () => [heard("prop-b", 4)]);
  assert.deepEqual(kinds(bySound), ["inspect"], "nor is a contact known only by sound");
});

/**
 * A prop that runs gives itself away, and a player shoots at it rather than
 * waiting for it to stop. Until the reflex's aim made a runner the harder shot,
 * a moving disguise was never `shootable`: the hunter chased it and fired a
 * second or two after it stopped, which read as mechanical.
 */
test("a hunter shoots at a disguise it can see running, in reach", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  for (const distance of [0.8, 6, 12]) {
    const intent = (await run(policy, 1, () => [mover("prop-a", distance)]))[0];
    assert.equal(intent.kind, "shootTarget", `a runner ${distance} m off is fired at`);
    assert.equal(intent.targetId, "prop-a");
  }
});

/**
 * A walking hunter loses 2.5 m/s to a panicking prop, so the contact a hunter
 * most needs to catch once it is out of reach was the one it could only ever
 * walk after.
 */
test("a hunter runs down a disguise it can see running, out of reach", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = (await run(policy, 1, () => [mover("prop-a", OUT_OF_REACH)]))[0];
  assert.equal(intent.kind, "inspect");
  assert.equal(intent.run, true);
});

/**
 * The gate that keeps the chase from becoming a sprint at everything. A contact
 * known only by sound carries no shape, so it could be a teammate: running at
 * every noise would rebuild the hunter pack, and faster than before.
 */
test("a hunter walks to a suspect it has not seen run", async () => {
  const bySound = (await run(new ScriptedPolicy(DIFFICULTY), 1, () => [heard("noise", 6)]))[0];
  assert.equal(bySound.kind, "inspect");
  assert.equal(bySound.run, false, "a contact known only by sound is approached at walking pace");

  const still = (await run(new ScriptedPolicy(DIFFICULTY), 1, () => [suspect("prop-b", 40)]))[0];
  assert.equal(still.kind, "inspect");
  assert.equal(still.run, false, "a suspect standing still out of range is not run at");
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
    await run(policy, 1, () => [
      character("hunter-b", 1),
      heard("noise", 9),
      mover("prop-a", OUT_OF_REACH),
    ])
  )[0];
  assert.equal(intent.kind, "inspect");
  assert.equal(intent.targetId, "noise", "the nearest contact that is not a known teammate");
});

test("a hunter chases the nearest disguise, not the nearest contact", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = (
    await run(policy, 1, () => [
      character("hunter-b", 1),
      mover("prop-far", OUT_OF_REACH + 6),
      mover("prop-near", OUT_OF_REACH),
    ])
  )[0];
  assert.equal(intent.kind, "inspect");
  assert.equal(intent.targetId, "prop-near");
});

/** A honk heard `distance` metres off on +x, `ageMs` ago, out of sight. */
const taunt = (id, distance, ageMs = 100) => ({
  id,
  kind: "taunt",
  x: distance,
  z: 0,
  distance,
  hasLineOfSight: false,
  ageMs,
});

const hearing = (seq, entities, sounds, over = {}) => ({
  ...observation(seq, entities),
  sounds,
  ...over,
});

test("a hunter runs to a taunt it heard", async () => {
  const intent = await new ScriptedPolicy(DIFFICULTY).decide(hearing(1, [], [taunt("s1", 20)]));
  assert.equal(intent.kind, "moveTo");
  assert.deepEqual({ x: intent.x, z: intent.z }, { x: 20, z: 0 });
  assert.equal(intent.run, true, "only a prop honks, so there is no teammate to mistake");
});

test("a hunter goes after a disguise in sight before a taunt", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = await policy.decide(hearing(1, [mover("prop-a", OUT_OF_REACH)], [taunt("s1", 8)]));
  assert.equal(intent.kind, "inspect");
  assert.equal(intent.targetId, "prop-a");
});

test("a hunter follows a taunt before footsteps that could be a teammate's", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = await policy.decide(hearing(1, [heard("noise", 5)], [taunt("s1", 20)]));
  assert.equal(intent.kind, "moveTo");
  assert.equal(intent.x, 20);
});

test("a hunter drops a taunt once it has got there", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  await policy.decide(hearing(1, [], [taunt("s1", 20)]));
  const there = await policy.decide(hearing(2, [], [taunt("s1", 0, 1_500)], { arrived: true }));
  assert.equal(there.kind, "patrol", "the same honk is not chased twice");
});

test("a newer taunt takes the lead over an older one", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  await policy.decide(hearing(1, [], [taunt("s1", 20)]));
  const next = await policy.decide(
    hearing(2, [], [taunt("s1", 20, 900), { ...taunt("s2", 10), z: 6 }]),
  );
  assert.equal(next.kind, "moveTo");
  assert.deepEqual({ x: next.x, z: next.z }, { x: 10, z: 6 });
});

/** Decide `count` times with nothing to follow, collecting every intent. */
async function searchQuietly(policy, count, self = {}, sounds = []) {
  const intents = [];
  for (let i = 0; i < count; i++) {
    intents.push(
      await policy.decide(
        hearing(i + 1, [], sounds, { self: { ...observation(0, []).self, ...self } }),
      ),
    );
  }
  return intents;
}

test("a hunter with nothing to follow for a while sounds its sonar, once", async () => {
  const intents = await searchQuietly(
    new ScriptedPolicy(DIFFICULTY),
    SONAR_PATIENCE_DECISIONS * 2,
    {
      canSonarNow: true,
    },
  );
  const pulses = intents.filter((intent) => intent.act === "sonar");
  assert.equal(pulses.length, 2, "one per stretch of quiet, not one per decision");
  assert.equal(intents.indexOf(pulses[0]), SONAR_PATIENCE_DECISIONS - 1);
  assert.deepEqual(kinds(pulses), ["patrol"], "it keeps searching while it listens");
});

test("a hunter does not sound a sonar that is cooling down", async () => {
  const intents = await searchQuietly(
    new ScriptedPolicy(DIFFICULTY),
    SONAR_PATIENCE_DECISIONS * 2,
    {
      canSonarNow: false,
    },
  );
  assert.equal(intents.filter((intent) => intent.act === "sonar").length, 0);
});

test("a hunter with a taunt to follow has no need of a sonar", async () => {
  const intents = await searchQuietly(
    new ScriptedPolicy(DIFFICULTY),
    SONAR_PATIENCE_DECISIONS * 2,
    { canSonarNow: true },
    [taunt("s1", 20)],
  );
  assert.equal(intents.filter((intent) => intent.act === "sonar").length, 0);
});
