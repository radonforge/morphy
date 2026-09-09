import assert from "node:assert/strict";
import { test } from "node:test";
import { BotDriver } from "../packages/bot/src/driver.ts";
import { ScriptedPolicy } from "../packages/bot/src/policy/scripted.ts";
import { buildMap } from "../packages/server/src/maps/index.ts";

const DIFFICULTY = 0.6;
const TICK_MS = 50;
const TICKS = 400;
const MIN_TRAVEL = 15;
const MIN_DECISIONS = 10;

const hunter = (id, spawn) => ({
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
});

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
