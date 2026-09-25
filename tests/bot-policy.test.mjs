import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_FLEE_DEFLECTIONS,
  MAX_HIDE_REPICKS,
  PANIC_RADIUS,
  PANIC_SEEN_RADIUS,
  SONAR_PATIENCE_DECISIONS,
  TAUNT_CHANCE_MAX,
  TAUNT_CHANCE_MIN,
  TAUNT_DARING_CHANCE_MAX,
  TAUNT_DARING_CHANCE_MIN,
} from "../packages/bot/src/config.ts";
import { ScriptedPolicy } from "../packages/bot/src/policy/scripted.ts";

const DIFFICULTY = 0.6;
const BOUNDS = { min: { x: -20, y: 0, z: -20 }, max: { x: 20, y: 10, z: 20 } };
const DECISIONS = 12;

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

/** A disguise seen on the move, so a suspect, but not yet worth a shot. */
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
  await policy.decide(observation(2, room, { canProbeNow: false }));
  const next = await policy.decide(observation(3, room, { canProbeNow: true }));
  assert.equal(next.kind, "shootTarget");
  assert.equal(next.targetId, "crate-far", "the one that survived a shot is furniture");
});

test("a hunter probes nothing out of reach", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = await policy.decide(
    observation(1, [contact("crate-far", 40)], { canProbeNow: true }),
  );
  assert.equal(intent.kind, "patrol");
});

test("a hunter chases a suspect before it spends a probe", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = await policy.decide(
    observation(1, [contact("crate", 3), mover("prop-a", 8)], { canProbeNow: true }),
  );
  assert.equal(intent.kind, "inspect");
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

/** Close enough that a prop in plain sight of the hunter still bolts. */
const POINT_BLANK = PANIC_SEEN_RADIUS / 2;

test("a prop flees a contact wearing no disguise that is on top of it", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intent = (await run(policy, 1, () => [character("hunter-b", POINT_BLANK)], asProp))[0];
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

/**
 * With fair hunters, moving in view is the tell that gets a prop shot; the
 * flee-on-sight reflex dated from bot hunters that shot any disguise they saw.
 */
test("a prop in plain sight of a hunter holds still rather than give itself away", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const intents = await run(
    policy,
    DECISIONS,
    () => [character("hunter-b", PANIC_RADIUS - 3)],
    asProp,
  );
  assert.deepEqual(kinds(intents), ["idle"]);
});

/** A fellow prop is not a threat, whatever it is doing: it cannot shoot. */
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

/** A prop's view of a map offering several distinct spots to hide among. */
const hidingObservation = (seq, pathBlocked) => ({
  seq,
  visibility: "limited",
  phase: "hiding",
  pathBlocked,
  arrived: false,
  self: {
    role: "prop",
    alive: true,
    hp: 0,
    x: 0,
    z: 0,
    rot: 0,
    propType: "crate",
    canShootNow: true,
    canTauntNow: false,
  },
  entities: [],
  sounds: [],
  map: {
    bounds: BOUNDS,
    doorways: [],
    nearbyProps: [
      { type: "crate", x: 6, z: 6 },
      { type: "crate", x: -6, z: 6 },
      { type: "crate", x: 6, z: -6 },
      { type: "crate", x: -6, z: -6 },
    ],
  },
});

async function hideSpots(pathBlocked) {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const spots = [];
  for (let i = 0; i < DECISIONS; i++) {
    const intent = await policy.decide(hidingObservation(i + 1, pathBlocked));
    assert.equal(intent.kind, "hideAs");
    spots.push(`${intent.x},${intent.z}`);
  }
  return spots;
}

test("a prop keeps the hide spot it picked while the path to it holds", async () => {
  const spots = await hideSpots(false);
  assert.equal(new Set(spots).size, 1);
});

test("a prop picks a new hide spot once its path is reported blocked", async () => {
  const spots = await hideSpots(true);
  assert.ok(new Set(spots).size > 1, `expected the prop to re-pick, got ${spots[0]} every time`);
});

test("a prop stops re-picking hide spots it can never reach", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  let last = null;
  for (let i = 0; i < MAX_HIDE_REPICKS + 2; i++) {
    last = await policy.decide(hidingObservation(i + 1, true));
  }
  assert.equal(last.kind, "hideAs");
  assert.deepEqual({ x: last.x, z: last.z }, { x: 0, z: 0 }, "it hides where it stands");
});

const THREAT_GAP = POINT_BLANK;

/**
 * A prop panicking at a hunter that keeps drifting sideways. The hunter trails
 * the prop at a fixed gap, so placing the prop somewhere else carries the threat
 * along with it and the panic holds wherever the escape has got to.
 */
const fleeingObservation = (seq, pathBlocked, threatZ, over = {}) => {
  const { arrived = false, x = 0, z = 0 } = over;
  return {
    seq,
    visibility: "limited",
    phase: "hunting",
    pathBlocked,
    arrived,
    self: {
      role: "prop",
      alive: true,
      hp: 0,
      x,
      z,
      rot: 0,
      propType: "crate",
      canShootNow: true,
      canTauntNow: false,
    },
    entities: [character("hunter-b", THREAT_GAP, { x: x + THREAT_GAP, z: z + threatZ })],
    sounds: [],
    map: { bounds: BOUNDS, doorways: [], nearbyProps: [{ type: "crate", x: 6, z: 6 }] },
  };
};

test("a prop holds its escape point while the hunter drifts", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const spots = [];
  for (let i = 0; i < DECISIONS; i++) {
    const intent = await policy.decide(fleeingObservation(i + 1, false, i * 0.4));
    assert.equal(intent.kind, "moveTo");
    spots.push(`${intent.x},${intent.z}`);
  }
  assert.equal(
    new Set(spots).size,
    1,
    "a drifting hunter must not re-aim the escape every decision",
  );
});

test("a prop swings to a new escape angle when its path is blocked", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const first = await policy.decide(fleeingObservation(1, false, 0));
  const second = await policy.decide(fleeingObservation(2, true, 0));
  assert.notDeepEqual(
    { x: first.x, z: first.z },
    { x: second.x, z: second.z },
    "a blocked escape must try a different direction",
  );
});

test("a cornered prop stops running once every escape angle is blocked", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  let last = null;
  for (let i = 0; i < MAX_FLEE_DEFLECTIONS + 2; i++) {
    last = await policy.decide(fleeingObservation(i + 1, true, 0));
  }
  assert.deepEqual({ x: last.x, z: last.z }, { x: 0, z: 0 }, "it stands where it is");
});

/**
 * Reaching the escape point must release it. The reflex parks on a goal it has
 * arrived at and only wakes on an intent it reads as different, so a prop that
 * re-issues the spot it is standing on stops dead with the hunter still on it.
 */
test("a prop picks a new escape point once it reaches the last one", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const first = await policy.decide(fleeingObservation(1, false, 0));
  const second = await policy.decide(
    fleeingObservation(2, false, 0, { arrived: true, x: first.x, z: first.z }),
  );
  assert.notDeepEqual(
    { x: second.x, z: second.z },
    { x: first.x, z: first.z },
    "arriving must not re-issue the point the prop is already standing on",
  );
});

test("a cornered prop that has spent its escapes stays put after arriving", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  for (let i = 0; i < MAX_FLEE_DEFLECTIONS + 2; i++) {
    await policy.decide(fleeingObservation(i + 1, true, 0));
  }
  const arrived = await policy.decide(fleeingObservation(99, false, 0, { arrived: true }));
  assert.deepEqual(
    { x: arrived.x, z: arrived.z },
    { x: 0, z: 0 },
    "an arrival must not hand a cornered prop a fresh set of escape angles",
  );
});

/** A prop in the hunt with a crate nearby to hide by, sensing `entities`. */
const hiddenProp = (seq, entities, phase = "hunting") => ({
  ...observation(seq, entities, asProp),
  phase,
  map: { bounds: BOUNDS, doorways: [], nearbyProps: [{ type: "crate", x: 6, z: 6 }] },
});

test("a prop that breaks cover drops a decoy, once", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const hunterClose = [character("hunter-b", POINT_BLANK)];
  const hidden = await policy.decide(hiddenProp(1, []));
  const breaks = await policy.decide(hiddenProp(2, hunterClose));
  const flees = await policy.decide(hiddenProp(3, hunterClose));
  assert.equal(hidden.kind, "hideAs");
  assert.equal(hidden.act, undefined);
  assert.equal(breaks.kind, "moveTo");
  assert.equal(breaks.act, "decoy", "the double stays behind where the prop stood");
  assert.equal(flees.kind, "moveTo");
  assert.equal(flees.act, undefined, "one decoy per break, not one per decision");
});

test("a prop running while the hunters are still blind drops nothing", async () => {
  const policy = new ScriptedPolicy(DIFFICULTY);
  const hunterClose = [character("hunter-b", PANIC_RADIUS - 3)];
  const breaks = await policy.decide(hiddenProp(1, hunterClose, "hiding"));
  assert.equal(breaks.kind, "moveTo");
  assert.equal(breaks.act, undefined);
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
  const intent = await policy.decide(hearing(1, [mover("prop-a", 12)], [taunt("s1", 8)]));
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

/** A prop settled in its hiding spot during the hunt, able to taunt unless told otherwise. */
const settledProp = (seq, entities, self = {}, over = {}) => ({
  ...observation(seq, entities, { ...asProp, canTauntNow: true, ...self }),
  arrived: true,
  map: { bounds: BOUNDS, doorways: [], nearbyProps: [{ type: "crate", x: 6, z: 6 }] },
  ...over,
});

/** Decide with `Math.random` pinned, so a per-decision chance becomes a yes or a no. */
async function decideWithRoll(policy, obs, roll) {
  const random = Math.random;
  Math.random = () => roll;
  try {
    return await policy.decide(obs);
  } finally {
    Math.random = random;
  }
}

const safeChance = TAUNT_CHANCE_MIN + (TAUNT_CHANCE_MAX - TAUNT_CHANCE_MIN) * DIFFICULTY;
const daringChance =
  TAUNT_DARING_CHANCE_MIN + (TAUNT_DARING_CHANCE_MAX - TAUNT_DARING_CHANCE_MIN) * DIFFICULTY;

test("a hidden prop taunts once it can", async () => {
  const intent = await decideWithRoll(new ScriptedPolicy(DIFFICULTY), settledProp(1, []), 0);
  assert.equal(intent.kind, "hideAs", "a taunt is made from the hiding spot, not on the move");
  assert.equal(intent.act, "taunt");
});

test("a prop does not taunt while its taunt is cooling down", async () => {
  const obs = settledProp(1, [], { canTauntNow: false });
  const intent = await decideWithRoll(new ScriptedPolicy(DIFFICULTY), obs, 0);
  assert.equal(intent.act, undefined);
});

test("a prop never taunts with a possible hunter in sight", async () => {
  const obs = settledProp(1, [character("hunter-b", 15)]);
  const intent = await decideWithRoll(new ScriptedPolicy(DIFFICULTY), obs, 0);
  assert.equal(intent.kind, "idle", "it holds still in view");
  assert.equal(intent.act, undefined, "the honk would point straight at it");
});

test("a prop does not taunt while the hunters are still blind", async () => {
  const obs = settledProp(1, [], {}, { phase: "hiding" });
  const intent = await decideWithRoll(new ScriptedPolicy(DIFFICULTY), obs, 0);
  assert.equal(intent.act, undefined);
});

test("a daring taunt, with a hunter close but blind, is taken more rarely", async () => {
  assert.ok(daringChance < safeChance, "the risk is weighed against the reward");
  const roll = (daringChance + safeChance) / 2;
  const alone = await decideWithRoll(new ScriptedPolicy(DIFFICULTY), settledProp(1, []), roll);
  assert.equal(alone.act, "taunt");
  const closeBy = settledProp(1, [heard("steps", PANIC_RADIUS + 1)]);
  const dared = await decideWithRoll(new ScriptedPolicy(DIFFICULTY), closeBy, roll);
  assert.equal(dared.kind, "hideAs");
  assert.equal(dared.act, undefined);
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

/** A sonar pulse heard `distance` metres off on +x. */
const pulse = (distance) => ({ ...taunt("p1", distance), kind: "sonar" });

test("a prop runs from a sonar sounded right next to it", async () => {
  const obs = { ...settledProp(1, []), sounds: [pulse(PANIC_RADIUS - 2)] };
  const intent = await decideWithRoll(new ScriptedPolicy(DIFFICULTY), obs, 0);
  assert.equal(intent.kind, "moveTo");
  assert.equal(intent.run, true);
  assert.ok(intent.x < 0, "away from the hunter");
});

test("a prop holds still and quiet at a sonar further off", async () => {
  const obs = { ...settledProp(1, []), sounds: [pulse(PANIC_RADIUS + 5)] };
  const intent = await decideWithRoll(new ScriptedPolicy(DIFFICULTY), obs, 0);
  assert.equal(intent.kind, "hideAs");
  assert.equal(intent.act, undefined, "no honk with a hunter sounding close by");
});
