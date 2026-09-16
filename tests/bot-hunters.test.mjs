import assert from "node:assert/strict";
import { test } from "node:test";
import { BotDriver } from "../packages/bot/src/driver.ts";
import { ScriptedPolicy } from "../packages/bot/src/policy/scripted.ts";
import { buildMap } from "../packages/server/src/maps/index.ts";
import { MOVE_SPEED, RUN_MULTIPLIER_PROP } from "../packages/shared/src/index.ts";

const DIFFICULTY = 0.6;
const TICK_MS = 50;
const TICKS = 400;
const MIN_TRAVEL = 15;
const MIN_DECISIONS = 10;

const CHASE_WARMUP_TICKS = 40;
const CHASE_TICKS = 160;
const CHASE_START_GAP = 8;
const PROP_RUN_SPEED = MOVE_SPEED * RUN_MULTIPLIER_PROP;

const FLEE_TICKS = 200;
const FLEE_SETTLE_TICKS = 40;
const FLEE_GAP = 3;
const MIN_FLEE_TRAVEL = 20;

/**
 * An open arena, long enough to hold a chase at a prop's top speed. The question
 * is what pace the two sides move at, so nothing is put between them: a lost
 * target here would be a geometry result, not a pace one.
 */
const ARENA = {
  id: "arena",
  bounds: { min: { x: -10, y: 0, z: -20 }, max: { x: 150, y: 10, z: 20 } },
  spawnPoints: { props: [{ x: 0, y: 0, z: 0 }] },
  colliders: [],
  tiles: [],
  scenery: [],
  props: [],
  propCatalog: [],
};

const body = (id, spawn, over = {}) => ({
  id,
  name: id,
  x: spawn.x,
  y: spawn.y,
  z: spawn.z,
  rot: 0,
  aim: 0,
  role: "hunter",
  alive: true,
  hp: 100,
  kills: 0,
  propType: "",
  ready: true,
  ...over,
});

const hunter = (id, spawn) => body(id, spawn);

/** The real policy, with every (observation, intent) pair kept for inspection. */
function recordingPolicy(log) {
  const policy = new ScriptedPolicy(DIFFICULTY);
  return {
    name: policy.name,
    async decide(obs, signal) {
      const intent = await policy.decide(obs, signal);
      log.push({ obs, intent });
      return intent;
    },
  };
}

function driverFor(name, map, log) {
  const driver = new BotDriver({
    name,
    difficulty: DIFFICULTY,
    readyAtPlayers: 2,
    policy: recordingPolicy(log),
    visibility: "limited",
    trace: null,
  });
  driver.setMap(map);
  return driver;
}

/**
 * Two hunter bots dropped on the same spot of a real map and run against each
 * other for twenty seconds, motor output fed back as the other's position —
 * the same loop `MorphyRoom` runs, minus the transport.
 *
 * They start glued because that is the worst case: it used to be a permanent
 * state. Each read the other as the nearest contact that had not yet resolved
 * into a prop, so both spent the round walking into each other and staring.
 *
 * Hearing one another through a wall and going to look is *not* the defect —
 * a player does that too, and a bot that skipped a noise would be reading the
 * room, so the pair may legitimately walk the same corridor for a few seconds.
 * What must never happen is targeting a contact it can see is a teammate, and
 * what the pack cost was is distance: glued hunters stopped covering ground.
 */
test("two hunter bots left alone never target each other on sight", async () => {
  const map = buildMap("station", 7);
  const spawn = map.spawnPoints.props[0];
  const bodies = [hunter("bot:1", spawn), hunter("bot:2", spawn)];
  const log = [];
  const drivers = [driverFor("Alpha", map, log), driverFor("Beta", map, log)];
  const travelled = [0, 0];

  let now = 1_000;
  for (let tick = 0; tick < TICKS; tick++) {
    now += TICK_MS;
    for (const [index, driver] of drivers.entries()) {
      const self = bodies[index];
      const world = {
        phase: "hunting",
        winner: "",
        self,
        others: bodies.filter((_, other) => other !== index),
        decoys: [],
      };
      const action = driver.tick(world, now);
      if (!action.input) continue;
      travelled[index] += Math.hypot(action.input.x - self.x, action.input.z - self.z);
      self.x = action.input.x;
      self.z = action.input.z;
      self.rot = action.input.rot;
      self.aim = action.input.aim;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  await Promise.all(drivers.map((driver) => driver.stop()));

  for (const driver of drivers) {
    assert.ok(
      driver.decideSeq >= MIN_DECISIONS,
      `the policy actually ran (${driver.decideSeq} decisions, expected >= ${MIN_DECISIONS})`,
    );
  }

  const onSight = log.filter(({ obs, intent }) => {
    if (intent.kind !== "inspect" && intent.kind !== "shootTarget") return false;
    const target = obs.entities.find((e) => e.id === intent.targetId);
    return target?.disguised === false;
  });
  assert.deepEqual(onSight, [], "no decision targeted a contact seen to wear no disguise");

  for (const [index, distance] of travelled.entries()) {
    assert.ok(
      distance > MIN_TRAVEL,
      `bot ${index + 1} kept moving (travelled ${distance.toFixed(1)}m, expected > ${MIN_TRAVEL}m)`,
    );
  }
});

/**
 * A hunter closing on a disguise that runs. The two motions used to move at
 * different speeds: `inspect` walked at `MOVE_SPEED` while a panicking prop ran
 * at `MOVE_SPEED * RUN_MULTIPLIER_PROP`, so the gap opened at 2.5 m/s for as
 * long as the prop kept going — and a fleeing prop is never `shootable`, so
 * `inspect` is the only path a hunter has to it.
 *
 * The quarry is a bare body rather than a second policy because the claim under
 * test is about a prop at *top* speed. A real prop slows to a walk the moment it
 * breaks contact, which is the case that was never broken.
 *
 * Measured from the end of a warm-up rather than from the start: the hunter
 * spends its first second on the bootstrap patrol and one shot at a contact it
 * has not yet seen move, and losing ground before the chase begins is not what
 * this is about.
 */
test("a hunter closes on a disguise running at a prop's top speed", async () => {
  const log = [];
  const driver = driverFor("Alpha", ARENA, log);
  const self = body("bot:1", { x: 0, y: 0, z: 0 });
  const quarry = body(
    "bot:2",
    { x: CHASE_START_GAP, y: 0, z: 0 },
    {
      role: "prop",
      propType: "crate",
    },
  );

  let now = 1_000;
  const chase = async (ticks) => {
    for (let tick = 0; tick < ticks; tick++) {
      now += TICK_MS;
      const world = { phase: "hunting", winner: "", self, others: [quarry], decoys: [] };
      const action = driver.tick(world, now);
      if (action.input) {
        self.x = action.input.x;
        self.z = action.input.z;
        self.rot = action.input.rot;
        self.aim = action.input.aim;
      }
      quarry.x += PROP_RUN_SPEED * (TICK_MS / 1000);
      await new Promise((resolve) => setImmediate(resolve));
    }
    return Math.hypot(quarry.x - self.x, quarry.z - self.z);
  };

  const engaged = await chase(CHASE_WARMUP_TICKS);
  const finished = await chase(CHASE_TICKS);

  await driver.stop();

  const running = log.filter(({ intent }) => intent.kind === "inspect" && intent.run === true);
  assert.ok(running.length > 0, "the hunter decided to run the disguise down, not walk after it");

  assert.ok(
    finished < engaged,
    `the hunter gained ground on a running prop (gap ${finished.toFixed(1)}m, was ${engaged.toFixed(1)}m)`,
  );
});

/**
 * A prop running from a hunter that keeps pace three metres behind. Driver-level
 * rather than policy-level because the failure needs all three parts: the policy
 * re-issues the escape point it already sent, the driver reads the repeat as no
 * change and leaves the reflex alone, and the reflex is parked on a goal it has
 * reached. Each part is defensible on its own; together they stopped the prop
 * dead at its first escape point with the hunter still on it.
 *
 * The hunter looks sideways so the deliberate freeze branch — hold still when a
 * hunter is looking straight at you — never fires and the prop has no reason to
 * stand still other than the defect.
 */
test("a prop under chase keeps fleeing past its first escape point", async () => {
  const driver = driverFor("Prey", ARENA, []);
  const self = body("bot:1", ARENA.spawnPoints.props[0], { role: "prop", propType: "barrel" });
  const chaser = body("hunter:1", ARENA.spawnPoints.props[0], { rot: Math.PI / 2 });

  let now = 1_000;
  let settledAt = null;
  for (let tick = 0; tick < FLEE_TICKS; tick++) {
    now += TICK_MS;
    chaser.x = self.x - FLEE_GAP;
    chaser.z = self.z;
    const action = driver.tick(
      { phase: "hunting", winner: "", self, others: [chaser], decoys: [] },
      now,
    );
    if (action.input) {
      self.x = action.input.x;
      self.z = action.input.z;
      self.rot = action.input.rot;
    }
    if (tick === FLEE_SETTLE_TICKS) settledAt = { x: self.x, z: self.z };
    await new Promise((resolve) => setImmediate(resolve));
  }
  await driver.stop();

  const after = Math.hypot(self.x - settledAt.x, self.z - settledAt.z);
  assert.ok(
    after > MIN_FLEE_TRAVEL,
    `expected the prop to keep running after reaching its first escape point, ` +
      `got ${after.toFixed(1)}m in the ${FLEE_TICKS - FLEE_SETTLE_TICKS} ticks that followed`,
  );
});
