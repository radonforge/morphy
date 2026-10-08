import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DECOY_RESERVE,
  ESCAPE_CLEAR_MS,
  ESCAPE_COMMIT_MAX_MS,
  ESCAPE_COMMIT_MIN_MS,
  FIRST_TAUNT_MAX_MS,
  FIRST_TAUNT_MIN_MS,
  HIDE_ALIGN_TOLERANCE_RAD,
  HIDE_MOVE_AWAY,
  HIDE_SAME_TYPE_RADIUS,
  HIDE_SEARCH_RADIUS,
  HIDE_TRAVEL_SHARE,
  HIDE_WALL_BACK_REACH,
  MAX_HIDE_REPICKS,
  POINT_BLANK_RADIUS,
  REHIDE_CALM_MAX_MS,
  TAUNT_DARING_CHANCE_MAX,
  TAUNT_DARING_CHANCE_MIN,
  TAUNT_GAP_MAX_MS,
} from "../packages/bot/src/config.ts";
import { BotDriver } from "../packages/bot/src/driver.ts";
import { pickHideSite, yawGap } from "../packages/bot/src/policy/hiding.ts";
import { ScriptedPolicy } from "../packages/bot/src/policy/scripted.ts";
import { Reflex } from "../packages/bot/src/reflex.ts";
import { Terrain } from "../packages/bot/src/terrain.ts";
import { objectHitboxes, overlapDepth } from "../packages/level/src/index.ts";
import { buildMap } from "../packages/server/src/maps/index.ts";
import {
  ASSET_CARDS,
  ASSET_TAGS,
  HIDE_DURATION_MS,
  LEVEL_OVERLAP_TOLERANCE,
  MOVE_SPEED,
  makeRng,
  RUN_MULTIPLIER_PROP,
  SONAR_RADIUS,
  TAUNT_COOLDOWN_MS,
  TAUNT_DARING_RADIUS,
  TAUNT_INTERVAL_MS,
} from "../packages/shared/src/index.ts";

const DIFFICULTY = 0.6;
const DECISION_MS = 500;
const TICK_MS = 50;
const SAFE_DISTANCE = 10;
const RIGHT_ON_TOP = 1;
const HALF = 0.5;

/** An open floor with a wall box off to the east, far enough that it hides nothing near the middle. */
const ARENA = {
  id: "props-arena",
  bounds: { min: { x: -30, y: 0, z: -30 }, max: { x: 30, y: 10, z: 30 } },
  spawnPoints: { props: [{ x: 0, y: 0, z: 0 }], hunters: [{ x: 25, y: 0, z: 25 }] },
  colliders: [{ position: { x: 20, y: 2, z: 0 }, size: { x: 2, y: 4, z: 12 } }],
  tiles: [],
  scenery: [],
  props: [],
  propCatalog: [],
};
/** Behind the wall box, out of sight of anything round the middle of the arena. */
const ROUND_THE_CORNER = { x: 25, z: 0 };

const terrain = new Terrain(ARENA);

function propPolicy() {
  const policy = new ScriptedPolicy(DIFFICULTY);
  policy.setTerrain(terrain);
  return policy;
}

/** A contact on the +x axis wearing no disguise: a hunter, looking at the prop unless told otherwise. */
const hunter = (id, distance, over = {}) => ({
  id,
  x: distance,
  z: 0,
  distance,
  hasLineOfSight: true,
  disguised: false,
  movedRecently: false,
  facingMe: true,
  ...over,
});

/** A disguise in sight, still or not: a fellow prop. */
const fellow = (id, distance) => ({
  id,
  x: distance,
  z: 0,
  distance,
  hasLineOfSight: true,
  disguised: true,
  movedRecently: true,
  facingMe: false,
  tellRecently: true,
});

/** A rustle out of sight: another prop's footsteps, since a hunter's are played to nobody. */
const rustle = (id, distance) => ({
  id,
  x: distance,
  z: 0,
  distance,
  hasLineOfSight: false,
  movedRecently: true,
  facingMe: false,
});

/** A sonar pulse heard `distance` metres off on +x. */
const pulse = (id, distance) => ({
  id,
  kind: "sonar",
  x: distance,
  z: 0,
  distance,
  hasLineOfSight: false,
  ageMs: 100,
});

/** A prop's view of the hunt at `phaseMs`, standing at the origin on the spot it hides on. */
const propView = (seq, phaseMs, entities = [], over = {}) => {
  const { self = {}, ...rest } = over;
  return {
    seq,
    visibility: "limited",
    phase: "hunting",
    phaseMs,
    pathBlocked: false,
    arrived: true,
    self: {
      role: "prop",
      alive: true,
      hp: 0,
      x: 0,
      z: 0,
      rot: 0,
      propType: "crate",
      canShootNow: false,
      canTauntNow: false,
      canSonarNow: false,
      canProbeNow: false,
      lastShotTargetId: null,
      forcedHonkMsAgo: null,
      decoysLeft: 3,
      canDecoyNow: true,
      ...self,
    },
    entities,
    sounds: [],
    map: { bounds: ARENA.bounds, doorways: [] },
    ...rest,
  };
};

/** Settle a prop on its spot: one decision to pick it, one standing on it. */
async function settled(policy) {
  await policy.decide(propView(1, 0, [], { arrived: false }));
  return policy.decide(propView(2, DECISION_MS));
}

/** Whether an intent has the prop on the move. */
const moving = (intent) => intent.kind === "moveTo" || intent.kind === "hideAs";

function pinRandom(t, value) {
  t.mock.method(Math, "random", () => value);
}

test("a prop holds still with a hunter aiming at it from a safe distance", async (t) => {
  pinRandom(t, HALF);
  const policy = propPolicy();
  await settled(policy);
  const intents = [];
  for (let k = 0; k < 12; k++) {
    intents.push(
      await policy.decide(propView(3 + k, (2 + k) * DECISION_MS, [hunter("h", SAFE_DISTANCE)])),
    );
  }
  assert.deepEqual([...new Set(intents.map((intent) => intent.kind))], ["idle"]);
});

test("a prop runs from a hunter aiming at it from point blank", async (t) => {
  pinRandom(t, HALF);
  const policy = propPolicy();
  await settled(policy);
  const intent = await policy.decide(propView(3, 2 * DECISION_MS, [hunter("h", RIGHT_ON_TOP)]));
  assert.equal(intent.kind, "moveTo");
  assert.equal(intent.run, true);
  assert.ok(intent.x < 0, `the run goes away from the hunter on +x, got x=${intent.x}`);
  assert.ok(POINT_BLANK_RADIUS > RIGHT_ON_TOP);
});

test("a prop does not run from a hunter that walks past without looking", async (t) => {
  pinRandom(t, HALF);
  const policy = propPolicy();
  await settled(policy);
  const intent = await policy.decide(
    propView(3, 2 * DECISION_MS, [hunter("h", POINT_BLANK_RADIUS, { facingMe: false })]),
  );
  assert.equal(intent.kind, "idle");
});

/**
 * A hunter that keeps the prop in sight while it closes in is after it, even
 * from further than point blank; holding still would only wait for the shot.
 */
test("a prop runs from a hunter that keeps it in sight while closing in", async (t) => {
  pinRandom(t, HALF);
  const policy = propPolicy();
  await settled(policy);
  const intents = [];
  for (let k = 0; k < 6; k++) {
    const distance = 9 - k;
    intents.push(
      await policy.decide(propView(3 + k, (2 + k) * DECISION_MS, [hunter("h", distance)])),
    );
  }
  assert.equal(intents[0].kind, "idle", "it does not bolt at the first sight of a hunter");
  assert.equal(intents.at(-1).kind, "moveTo", "it runs once the hunter is plainly after it");
});

test("a fellow prop in sight, moving or not, is no reason to stop hiding", async (t) => {
  pinRandom(t, HALF);
  const policy = propPolicy();
  await settled(policy);
  const intent = await policy.decide(propView(3, 2 * DECISION_MS, [fellow("p", RIGHT_ON_TOP)]));
  assert.equal(intent.kind, "hideAs");
});

test("a prop does not run from a rustle it cannot see", async (t) => {
  pinRandom(t, HALF);
  const policy = propPolicy();
  await settled(policy);
  const intent = await policy.decide(propView(3, 2 * DECISION_MS, [rustle("r", 2)]));
  assert.equal(intent.kind, "hideAs");
});

test("a prop does not run while the hunters are blind", async (t) => {
  pinRandom(t, HALF);
  const policy = propPolicy();
  const intent = await policy.decide(
    propView(1, 0, [hunter("h", RIGHT_ON_TOP)], { phase: "hiding", arrived: false }),
  );
  assert.equal(intent.kind, "hideAs");
  assert.equal(intent.act, undefined);
});

/**
 * The aimed-at-point-blank prop runs, loses the hunter round a corner, runs on
 * for its commitment and the clear time, stops, and hides again once nothing
 * has been on it for a while: one run and one stop, not a stutter.
 */
test("an escape commits, then the prop hides again after a calm", async (t) => {
  pinRandom(t, HALF);
  const policy = propPolicy();
  await settled(policy);
  const startAt = 2 * DECISION_MS;
  const first = await policy.decide(propView(3, startAt, [hunter("h", RIGHT_ON_TOP)]));
  assert.equal(first.kind, "moveTo");
  const intents = [first];
  const until = startAt + Math.max(ESCAPE_CLEAR_MS, ESCAPE_COMMIT_MIN_MS + ESCAPE_COMMIT_MAX_MS);
  let seq = 4;
  for (let now = startAt + DECISION_MS; now <= until + 2 * REHIDE_CALM_MAX_MS; now += DECISION_MS) {
    intents.push(await policy.decide(propView(seq++, now, [], { arrived: false })));
  }
  const commitment = (ESCAPE_COMMIT_MIN_MS + ESCAPE_COMMIT_MAX_MS) * HALF;
  const runFor = intents.findIndex((intent) => intent.kind !== "moveTo") * DECISION_MS;
  assert.ok(runFor >= commitment, `ran for ${runFor} ms, committed to ${commitment} ms`);
  assert.equal(intents.at(-1).kind, "hideAs", "it hides again once the calm is over");
  let switches = 0;
  for (let k = 1; k < intents.length; k++) {
    if (moving(intents[k]) !== moving(intents[k - 1])) switches++;
  }
  assert.ok(switches <= 2, `expected one run and one stop, got ${switches} switches`);
});

test("a hunter that drops out of sight round a corner keeps the prop running", async (t) => {
  pinRandom(t, 0);
  const policy = propPolicy();
  await settled(policy);
  const startAt = 2 * DECISION_MS;
  await policy.decide(propView(3, startAt, [hunter("h", RIGHT_ON_TOP)]));
  const afterCommit = startAt + ESCAPE_COMMIT_MIN_MS;
  const stillHunted = await policy.decide(
    propView(4, afterCommit, [hunter("h", 8, { facingMe: false })], { arrived: false }),
  );
  assert.equal(stillHunted.kind, "moveTo", "a hunter in sight close by keeps it going");
  const justLost = await policy.decide(
    propView(5, afterCommit + DECISION_MS, [], { arrived: false }),
  );
  assert.equal(justLost.kind, "moveTo", "one that just went out of sight is still coming");
  const clear = await policy.decide(
    propView(6, afterCommit + DECISION_MS + ESCAPE_CLEAR_MS + 1, [], { arrived: false }),
  );
  assert.equal(clear.kind, "idle");
});

test("a blocked escape is traded for another waypoint", async (t) => {
  pinRandom(t, HALF);
  const policy = propPolicy();
  await settled(policy);
  const first = await policy.decide(propView(3, 2 * DECISION_MS, [hunter("h", RIGHT_ON_TOP)]));
  const second = await policy.decide(
    propView(4, 3 * DECISION_MS, [hunter("h", RIGHT_ON_TOP)], {
      pathBlocked: true,
      arrived: false,
    }),
  );
  assert.equal(second.kind, "moveTo");
  assert.notDeepEqual({ x: second.x, z: second.z }, { x: first.x, z: first.z });
});

test("a prop boxed in with nowhere to run holds still", async (t) => {
  pinRandom(t, HALF);
  const walls = [
    { position: { x: 0, y: 2, z: 1.2 }, size: { x: 3.4, y: 4, z: 0.4 } },
    { position: { x: 0, y: 2, z: -1.2 }, size: { x: 3.4, y: 4, z: 0.4 } },
    { position: { x: 1.5, y: 2, z: 0 }, size: { x: 0.4, y: 4, z: 2.8 } },
    { position: { x: -1.5, y: 2, z: 0 }, size: { x: 0.4, y: 4, z: 2.8 } },
  ];
  const policy = new ScriptedPolicy(DIFFICULTY);
  policy.setTerrain(new Terrain({ ...ARENA, colliders: walls }));
  await settled(policy);
  const intent = await policy.decide(propView(3, 2 * DECISION_MS, [hunter("h", RIGHT_ON_TOP)]));
  assert.equal(intent.kind, "idle");
});

test("a prop breaking cover from its hiding spot drops a decoy there, once", async (t) => {
  pinRandom(t, HALF);
  const policy = propPolicy();
  await settled(policy);
  const breaks = await policy.decide(propView(3, 2 * DECISION_MS, [hunter("h", RIGHT_ON_TOP)]));
  const runs = await policy.decide(
    propView(4, 3 * DECISION_MS, [hunter("h", RIGHT_ON_TOP)], { arrived: false }),
  );
  assert.equal(breaks.act, "decoy", "the double stays on the spot the prop hid on");
  assert.equal(runs.act, undefined, "one decoy per break, not one per decision");
});

test("a prop drops no decoy it has not got, or that is cooling down", async (t) => {
  pinRandom(t, HALF);
  for (const self of [
    { decoysLeft: 0, canDecoyNow: false },
    { decoysLeft: 2, canDecoyNow: false },
  ]) {
    const policy = propPolicy();
    await settled(policy);
    const intent = await policy.decide(
      propView(3, 2 * DECISION_MS, [hunter("h", RIGHT_ON_TOP)], { self }),
    );
    assert.equal(intent.kind, "moveTo");
    assert.equal(intent.act, undefined, `with ${JSON.stringify(self)}`);
  }
});

/** A decoy dropped mid-run would stand on the way the prop is running, not where it hid. */
test("a prop already on the move drops no decoy", async (t) => {
  pinRandom(t, HALF);
  const policy = propPolicy();
  await policy.decide(propView(1, 0, [], { arrived: false }));
  const intent = await policy.decide(
    propView(2, DECISION_MS, [hunter("h", RIGHT_ON_TOP)], { arrived: false }),
  );
  assert.equal(intent.kind, "moveTo");
  assert.equal(intent.act, undefined);
});

test("a prop keeps its last decoy for a hunter at point blank", async (t) => {
  pinRandom(t, HALF);
  const last = { decoysLeft: DECOY_RESERVE };
  const spotted = propPolicy();
  await settled(spotted);
  const intents = [];
  for (let k = 0; k < 6; k++) {
    intents.push(
      await spotted.decide(
        propView(3 + k, (2 + k) * DECISION_MS, [hunter("h", 9 - k)], { self: last }),
      ),
    );
  }
  const run = intents.find((intent) => intent.kind === "moveTo");
  assert.ok(run, "the closing hunter makes it run");
  assert.equal(run.act, undefined, "spotted is not cornered: the reserve stays");
  const cornered = propPolicy();
  await settled(cornered);
  const bolt = await cornered.decide(
    propView(3, 2 * DECISION_MS, [hunter("h", RIGHT_ON_TOP)], { self: last }),
  );
  assert.equal(bolt.act, "decoy");
});

test("a prop runs from a sonar sounded right next to it", async (t) => {
  pinRandom(t, HALF);
  const policy = propPolicy();
  await settled(policy);
  const intent = await policy.decide(propView(3, 2 * DECISION_MS, [], { sounds: [pulse("p", 3)] }));
  assert.equal(intent.kind, "moveTo");
  assert.equal(intent.run, true);
  assert.ok(intent.x < 0, "away from the hunter");
});

/**
 * A pulse within its radius made the prop honk, so the hunter that sent it
 * knows roughly where it is: it walks to another spot, leaving a decoy where
 * the honk came from. With nothing on the map listing its shape, the new spot
 * is where it stands, so this only shows it moves on and leaves the double.
 */
test("a sonar that made the prop honk sends it elsewhere, leaving a decoy", async (t) => {
  pinRandom(t, HALF);
  const policy = propPolicy();
  await settled(policy);
  const drawn = { sounds: [pulse("p", SONAR_RADIUS - 1)], self: { forcedHonkMsAgo: 0 } };
  const intent = await policy.decide(propView(3, 2 * DECISION_MS, [], drawn));
  assert.equal(intent.kind, "hideAs");
  assert.equal(intent.act, "decoy");
  const after = await policy.decide(
    propView(4, 3 * DECISION_MS, [], { ...drawn, self: { forcedHonkMsAgo: DECISION_MS } }),
  );
  assert.equal(after.act, undefined, "one move per honk");
});

test("a prop holds still and quiet at a sonar further off", async (t) => {
  pinRandom(t, 0);
  const policy = propPolicy();
  await settled(policy);
  const intent = await policy.decide(
    propView(3, FIRST_TAUNT_MAX_MS, [], {
      sounds: [pulse("p", SONAR_RADIUS + 3)],
      self: { canTauntNow: true },
    }),
  );
  assert.equal(intent.kind, "hideAs");
  assert.equal(intent.act, undefined, "no honk with a hunter sounding close by");
});

test("a forced honk sends the prop to another spot", async (t) => {
  pinRandom(t, HALF);
  const policy = propPolicy();
  await settled(policy);
  const intent = await policy.decide(
    propView(3, 2 * DECISION_MS, [], { self: { forcedHonkMsAgo: 0 } }),
  );
  assert.equal(intent.kind, "hideAs");
  assert.equal(intent.act, "decoy");
});

/** Decide every `cadenceMs` of the hunt for `spanMs`, returning when each voluntary taunt was pressed. */
async function tauntTimes(cadenceMs, spanMs) {
  const policy = propPolicy();
  const times = [];
  let lastTaunt = Number.NEGATIVE_INFINITY;
  let seq = 0;
  for (let now = 0; now <= spanMs; now += cadenceMs) {
    const canTauntNow = now - lastTaunt >= TAUNT_COOLDOWN_MS;
    const intent = await policy.decide(
      propView(++seq, now, [], { arrived: seq > 1, self: { canTauntNow } }),
    );
    if (intent.act === "taunt") {
      times.push(now);
      lastTaunt = now;
    }
  }
  return times;
}

test("a hidden prop first taunts some seconds into the hunt, never at once", async (t) => {
  pinRandom(t, HALF);
  const times = await tauntTimes(DECISION_MS, FIRST_TAUNT_MAX_MS);
  const due = FIRST_TAUNT_MIN_MS + (FIRST_TAUNT_MAX_MS - FIRST_TAUNT_MIN_MS) * HALF;
  assert.equal(times.length, 1);
  assert.ok(times[0] >= due && times[0] < due + DECISION_MS, `first taunt at ${times[0]} ms`);
});

/**
 * The taunt clock is the hunt's: deciding four times as often must not make a
 * prop honk more often, which a per-decision chance did.
 */
test("how often a prop taunts does not depend on how often it decides", async (t) => {
  pinRandom(t, HALF);
  const spanMs = 90_000;
  const fast = await tauntTimes(250, spanMs);
  const slow = await tauntTimes(1_000, spanMs);
  assert.ok(fast.length >= 3, `expected a few taunts in ${spanMs} ms, got ${fast.length}`);
  assert.equal(fast.length, slow.length);
  for (let k = 0; k < fast.length; k++) {
    assert.ok(
      Math.abs(fast[k] - slow[k]) <= 1_000 * (k + 1),
      `taunt ${k}: ${fast[k]} vs ${slow[k]}`,
    );
  }
  for (let k = 1; k < fast.length; k++) {
    const gap = fast[k] - fast[k - 1];
    assert.ok(gap >= TAUNT_COOLDOWN_MS && gap <= TAUNT_COOLDOWN_MS + TAUNT_GAP_MAX_MS + 250);
    assert.ok(gap < TAUNT_INTERVAL_MS, "always ahead of the forced honk");
  }
});

test("a prop never taunts with a possible hunter in sight", async (t) => {
  pinRandom(t, 0);
  const policy = propPolicy();
  await settled(policy);
  const intent = await policy.decide(
    propView(3, FIRST_TAUNT_MAX_MS, [hunter("h", 15, { facingMe: false })], {
      self: { canTauntNow: true },
    }),
  );
  assert.equal(intent.kind, "idle", "it holds still in view");
  assert.equal(intent.act, undefined, "the honk would point straight at it");
});

test("a taunt due with a hunter known to be close is a dare, taken only sometimes", async (t) => {
  const chance =
    TAUNT_DARING_CHANCE_MIN + (TAUNT_DARING_CHANCE_MAX - TAUNT_DARING_CHANCE_MIN) * DIFFICULTY;
  for (const [roll, taken] of [
    [chance / 2, true],
    [(chance + 1) / 2, false],
  ]) {
    pinRandom(t, roll);
    const policy = propPolicy();
    await settled(policy);
    const seenAt = FIRST_TAUNT_MAX_MS - DECISION_MS;
    await policy.decide(
      propView(3, seenAt, [hunter("h", TAUNT_DARING_RADIUS - 2, { facingMe: false })]),
    );
    const intent = await policy.decide(
      propView(4, FIRST_TAUNT_MAX_MS, [], { self: { canTauntNow: true } }),
    );
    assert.equal(intent.act === "taunt", taken, `roll ${roll} against ${chance}`);
    t.mock.restoreAll();
  }
});

/** Bodies in a room, as the room's state lists them. */
const player = (id, x, z, over = {}) => ({
  id,
  name: id,
  x,
  y: 0,
  z,
  rot: 0,
  aim: 0,
  propRot: 0,
  role: "hunter",
  alive: true,
  hp: 100,
  kills: 0,
  propType: "",
  decoysLeft: 0,
  ready: true,
  ...over,
});

/**
 * A prop bot already hidden at the origin of the arena, then shown a hunter
 * aiming at it from `distance` on +x, ticked as the room ticks it. `move`
 * may relocate the hunter each tick. Returns how far the prop was from the
 * origin at every tick.
 */
async function faceHunter(t, distance, ticks, move = () => undefined) {
  t.mock.method(Math, "random", makeRng(1));
  const driver = new BotDriver({
    name: "Prey",
    difficulty: DIFFICULTY,
    readyAtPlayers: 2,
    policy: new ScriptedPolicy(DIFFICULTY),
    visibility: "limited",
    trace: null,
  });
  driver.setMap(ARENA);
  const self = player("bot:1", 0, 0, { role: "prop", propType: "crate", hp: 0, decoysLeft: 3 });
  const aimAtProp = -Math.PI / 2;
  const chaser = player("hunter:1", distance, 0, { rot: aimAtProp, aim: aimAtProp });
  let now = 1_000;
  const step = async (others) => {
    now += TICK_MS;
    const action = driver.tick({ phase: "hunting", winner: "", self, others, decoys: [] }, now);
    if (action.input) {
      self.x = action.input.x;
      self.z = action.input.z;
      self.rot = action.input.rot;
    }
    await new Promise((resolve) => setImmediate(resolve));
  };
  for (let k = 0; k < 40; k++) await step([]);
  const away = [];
  for (let k = 0; k < ticks; k++) {
    move(chaser, self, k);
    await step([chaser]);
    away.push(Math.hypot(self.x, self.z));
  }
  await driver.stop();
  return away;
}

/** How often a series of positions goes from standing to moving or back. */
function stopStarts(away) {
  let switches = 0;
  let wasMoving = false;
  for (let k = 1; k < away.length; k++) {
    const isMoving = Math.abs(away[k] - away[k - 1]) > 1e-3;
    if (isMoving !== wasMoving) switches++;
    wasMoving = isMoving;
  }
  return switches;
}

const FACE_TICKS = 120;

test("an aimed hunter at 10 m, at 1 m and round a corner draw three responses", async (t) => {
  const watched = await faceHunter(t, SAFE_DISTANCE, FACE_TICKS);
  t.mock.restoreAll();
  assert.ok(watched.at(-1) < 0.1, `held still under a distant aim, drifted ${watched.at(-1)} m`);

  const pointBlank = await faceHunter(t, RIGHT_ON_TOP, FACE_TICKS);
  t.mock.restoreAll();
  assert.ok(pointBlank[20] > 3, `ran at point blank, ${pointBlank[20].toFixed(1)} m in a second`);

  let lostAt = null;
  const cornered = await faceHunter(
    t,
    POINT_BLANK_RADIUS - HALF,
    FACE_TICKS,
    (hunterBody, prey, k) => {
      if (lostAt === null && Math.hypot(prey.x, prey.z) > 2) lostAt = k;
      if (lostAt === null) return;
      hunterBody.x = ROUND_THE_CORNER.x;
      hunterBody.z = ROUND_THE_CORNER.z;
    },
  );
  assert.ok(lostAt !== null, "the prop broke cover");
  const lostFor = ESCAPE_COMMIT_MIN_MS / TICK_MS;
  assert.ok(
    cornered[lostAt + lostFor] > cornered[lostAt] + 2,
    "it ran on after the hunter went out of sight",
  );
  assert.equal(cornered.at(-1), cornered.at(-2), "and stopped once nothing was on it");
  assert.ok(stopStarts(cornered) <= 2, `one run, one stop: ${stopStarts(cornered)} switches`);
});

test("a bot tells the honk it chose from one the room forced on it", () => {
  const reflex = new Reflex(DIFFICULTY, "limited");
  reflex.setMap(ARENA);
  const self = player("bot:1", 0, 0, { role: "prop", propType: "crate", hp: 0 });
  const world = { phase: "hunting", winner: "", self, others: [], decoys: [] };
  const pressedAt = 5_000;
  reflex.buildObservation(world, 1, pressedAt - TICK_MS);
  reflex.notePressed("taunt", pressedAt);
  reflex.hearOwnHonk(pressedAt);
  const chosen = reflex.buildObservation(world, 2, pressedAt + TICK_MS);
  assert.equal(chosen.self.forcedHonkMsAgo, null, "the honk it pressed for is no forced one");
  const forcedAt = pressedAt + TAUNT_INTERVAL_MS;
  reflex.hearOwnHonk(forcedAt);
  const forced = reflex.buildObservation(world, 3, forcedAt + TICK_MS);
  assert.equal(forced.self.forcedHonkMsAgo, TICK_MS);
});

const STATION = buildMap("station", 1);

/**
 * One prop bot dealt `type` and left alone through the whole hide on the
 * real station, the room's own loop minus the transport: where it ends up,
 * which way its disguise faces, and every tick's disguise turn while it was
 * still walking.
 */
async function hideOnStation(t, type, spawnIndex, seed, decoys = []) {
  t.mock.method(Math, "random", makeRng(seed));
  const driver = new BotDriver({
    name: "Hider",
    difficulty: DIFFICULTY,
    readyAtPlayers: 2,
    policy: new ScriptedPolicy(DIFFICULTY),
    visibility: "limited",
    trace: null,
  });
  driver.setMap(STATION);
  const spawn = STATION.spawnPoints.props[spawnIndex];
  const self = {
    id: "bot:1",
    name: "Hider",
    x: spawn.x,
    y: 0,
    z: spawn.z,
    rot: 0.3,
    aim: 0.3,
    propRot: 0,
    role: "prop",
    alive: true,
    hp: 0,
    kills: 0,
    propType: type,
    decoysLeft: 3,
    ready: true,
  };
  const turnsWhileWalking = [];
  let now = 1_000;
  for (let elapsed = 0; elapsed < HIDE_DURATION_MS; elapsed += TICK_MS) {
    now += TICK_MS;
    const action = driver.tick({ phase: "hiding", winner: "", self, others: [], decoys }, now);
    if (action.input) {
      const walked = Math.hypot(action.input.x - self.x, action.input.z - self.z) > 1e-6;
      if (walked) turnsWhileWalking.push(action.input.propRot);
      self.x = action.input.x;
      self.z = action.input.z;
      self.rot = action.input.rot;
      self.propRot = action.input.propRot;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  await driver.stop();
  const travelled = Math.hypot(self.x - spawn.x, self.z - spawn.z);
  return { self, travelled, turnsWhileWalking };
}

test("a prop keeps its hide spot while the path holds, re-picks when blocked, then gives up", async (t) => {
  pinRandom(t, HALF);
  const policy = new ScriptedPolicy(DIFFICULTY);
  policy.setTerrain(new Terrain(STATION));
  const spawn = STATION.spawnPoints.props[0];
  const hiding = (seq, pathBlocked) =>
    propView(seq, seq * DECISION_MS, [], {
      phase: "hiding",
      arrived: false,
      pathBlocked,
      self: { x: spawn.x, z: spawn.z, propType: "container" },
    });
  const first = await policy.decide(hiding(1, false));
  const held = await policy.decide(hiding(2, false));
  assert.deepEqual({ x: held.x, z: held.z }, { x: first.x, z: first.z });
  assert.notDeepEqual({ x: first.x, z: first.z }, { x: spawn.x, z: spawn.z });
  let last = held;
  for (let k = 0; k <= MAX_HIDE_REPICKS; k++) last = await policy.decide(hiding(3 + k, true));
  assert.deepEqual(
    { x: last.x, z: last.z },
    { x: spawn.x, z: spawn.z },
    "it hides where it stands",
  );
});

test("a hiding spot a decoy stands on is reported blocked, not reached", () => {
  const crate = {
    id: "crate",
    name: "Crate",
    parts: [
      {
        kind: "box",
        position: { x: 0, y: HALF, z: 0 },
        size: { x: 1, y: 1, z: 1 },
        color: "#ffffff",
      },
    ],
  };
  const reflex = new Reflex(DIFFICULTY, "limited");
  reflex.setMap({ ...ARENA, propCatalog: [crate] });
  reflex.syncPosition(0, 0, 0);
  const self = player("bot:1", 0, 0, { role: "prop", propType: "crate", hp: 0 });
  const spot = { x: 3, z: 0 };
  const decoy = { id: "decoy:1", ...spot, y: 0, rot: 0, propType: "crate" };
  const world = { phase: "hiding", winner: "", self, others: [], decoys: [decoy] };
  const intent = { kind: "hideAs", ...spot, yaw: Math.PI, seq: 1 };
  let now = 1_000;
  let blocked = false;
  let obs = null;
  for (let k = 0; k < 100; k++) {
    now += TICK_MS;
    const output = reflex.executeIntent(intent, world, TICK_MS / 1_000, now);
    Object.assign(self, output.input);
    obs = reflex.buildObservation(world, k, now);
    assert.equal(obs.arrived, false, "standing short of the spot is no arrival");
    blocked ||= obs.pathBlocked;
  }
  assert.ok(Math.hypot(obs.self.x - spot.x, obs.self.z - spot.z) > HALF, "the decoy kept it off");
  assert.ok(blocked, "the spot was reported blocked");
});

test("a prop whose hiding spot holds a decoy hides somewhere else", async (t) => {
  const type = "container";
  const { self: clear } = await hideOnStation(t, type, 0, 1);
  t.mock.restoreAll();
  const decoy = { id: "decoy:1", x: clear.x, y: 0, z: clear.z, rot: clear.propRot, propType: type };
  const { self } = await hideOnStation(t, type, 0, 1, [decoy]);
  assert.ok(
    Math.hypot(self.x - decoy.x, self.z - decoy.z) >= HIDE_MOVE_AWAY,
    "it gave up the spot instead of settling short of it",
  );
});

/** Disguise, prop spawn and seed that once picked a spot in a station doorway's clearance. */
const DOORWAY_PICKS = [
  ["computer-wide", 2, 5],
  ["computer-wide", 12, 6],
  ["bed-single", 8, 7],
  ["bed-single", 6, 8],
  ["computer-wide", 9, 8],
  ["computer", 0, 9],
  ["bed-double", 10, 9],
];

test("a prop never hides in a doorway's clearance", () => {
  const terrainOf = new Terrain(STATION);
  const context = { catalog: STATION.propCatalog, cards: ASSET_CARDS, tags: ASSET_TAGS };
  const maxPath = (HIDE_DURATION_MS / 1_000) * MOVE_SPEED * RUN_MULTIPLIER_PROP * HIDE_TRAVEL_SHARE;
  assert.ok(terrainOf.doorClearance.length > 0, "the station has doorways");
  for (const [type, spawnIndex, seed] of DOORWAY_PICKS) {
    const site = pickHideSite(
      terrainOf,
      {
        type,
        from: STATION.spawnPoints.props[spawnIndex],
        radius: HIDE_SEARCH_RADIUS,
        maxPath,
        threats: [],
        leaving: null,
      },
      makeRng(seed),
    );
    assert.ok(site, `a ${type} from spawn ${spawnIndex} found a spot`);
    const boxes = objectHitboxes({ id: type, type, ...site }, context);
    for (const zone of terrainOf.doorClearance) {
      for (const box of boxes) {
        assert.ok(
          overlapDepth(box, zone) <= LEVEL_OVERLAP_TOLERANCE,
          `the ${type} at ${site.x.toFixed(2)}, ${site.z.toFixed(2)} stands in a doorway`,
        );
      }
    }
  }
});

function ownKindNear(type, at) {
  return STATION.props.filter(
    (prop) =>
      prop.type === type &&
      Math.hypot(prop.position.x - at.x, prop.position.z - at.z) <= HIDE_SAME_TYPE_RADIUS,
  );
}

for (const [type, spawnIndex] of [
  ["container", 0],
  ["computer-system", 3],
]) {
  test(`a prop dealt a ${type} hides beside one, turned like it`, async (t) => {
    const terrainOf = new Terrain(STATION);
    const shape = terrainOf.shape(type);
    const { self, travelled } = await hideOnStation(t, type, spawnIndex, 1);
    assert.ok(travelled > 1, "it walked to a spot rather than hiding where it was dealt");
    const near = ownKindNear(type, self);
    assert.ok(near.length > 0, `no ${type} within ${HIDE_SAME_TYPE_RADIUS} m of where it hid`);
    const gaps = near.map((prop) => yawGap(prop.rotation, self.propRot, shape.symmetry));
    assert.ok(
      Math.min(...gaps) <= HIDE_ALIGN_TOLERANCE_RAD,
      `turned ${Math.min(...gaps).toFixed(2)} rad off the nearest ${type}`,
    );
    if (shape.mount !== "wall") return;
    const depth =
      Math.abs(Math.sin(shape.frontYaw)) < HALF ? shape.extent.halfZ : shape.extent.halfX;
    const back = self.propRot + shape.frontYaw + Math.PI;
    const probe = {
      x: self.x + Math.sin(back) * (depth + HIDE_WALL_BACK_REACH),
      z: self.z + Math.cos(back) * (depth + HIDE_WALL_BACK_REACH),
    };
    assert.ok(
      terrainOf.walls.some(
        (w) => probe.x >= w.minX && probe.x <= w.maxX && probe.z >= w.minZ && probe.z <= w.maxZ,
      ),
      "a wall-mounted disguise stands with its back to a wall",
    );
  });
}

test("a disguise keeps its turn while the prop walks, whichever way the path bends", async (t) => {
  const { turnsWhileWalking } = await hideOnStation(t, "container", 0, 1);
  assert.ok(turnsWhileWalking.length > 20, "the walk is long enough to bend");
  assert.deepEqual(
    [...new Set(turnsWhileWalking)],
    [0.3],
    "the disguise faces the way it was dealt until the prop has arrived",
  );
});
