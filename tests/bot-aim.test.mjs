import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aimSpread,
  fireChance,
  lateralSpeed,
  reactionDelayMs,
  VelocityEstimate,
} from "../packages/bot/src/aim.ts";
import {
  AIM_FIRE_ERROR_RAD,
  BOT_EYE_HEIGHT,
  BOT_FIRE_COOLDOWN_MS,
  lerp,
  REACTION_FLOOR_FRACTION,
  REACTION_MS_MAX,
  REACTION_MS_MIN,
} from "../packages/bot/src/config.ts";
import { canHitTarget } from "../packages/bot/src/raycast.ts";
import { Reflex } from "../packages/bot/src/reflex.ts";
import {
  MOVE_SPEED,
  makeRng,
  RUN_MULTIPLIER_PROP,
  UNTRANSFORMED_PROP_HEIGHT,
  UNTRANSFORMED_PROP_RADIUS,
} from "../packages/shared/src/index.ts";

const DIFFICULTY = 0.6;
const TICK_MS = 50;
const TICK_S = TICK_MS / 1_000;
const START_MS = 1_000;
const TRIALS = 40;
const RANGE = 10;
const PROP_RUN_SPEED = MOVE_SPEED * RUN_MULTIPLIER_PROP;
const RUN_FROM_X = -10;
const STILL_TICKS = 60;
const DRAWS = 2_000;
/** A crosshair three trigger widths off fires on fewer than this share of ticks. */
const FAR_OFF_FIRE_CHANCE_MAX = 0.05;
/** How close the drawn reaction times average to the difficulty's mean, as a share of it. */
const REACTION_MEAN_TOLERANCE = 0.05;
/** The hit rate on a crate standing still at {@link RANGE}, at the default difficulty. */
const STILL_HIT_RATE_MIN = 0.75;
/** How much less often a runner is hit than a crate standing still, at the least. */
const RUNNER_HIT_RATE_GAP_MIN = 0.3;
const REACTION_MEAN_MS = lerp(REACTION_MS_MAX, REACTION_MS_MIN, DIFFICULTY);
const BOUNDS = { radius: UNTRANSFORMED_PROP_RADIUS, yMin: 0, yMax: UNTRANSFORMED_PROP_HEIGHT };

const ARENA = {
  id: "aim-arena",
  bounds: { min: { x: -30, y: 0, z: -30 }, max: { x: 30, y: 10, z: 30 } },
  spawnPoints: { props: [{ x: 0, y: 0, z: 0 }] },
  colliders: [],
  tiles: [],
  scenery: [],
  props: [],
  propCatalog: [],
};

const body = (id, x, z, over = {}) => ({
  id,
  name: id,
  x,
  y: 0,
  z,
  rot: 0,
  aim: 0,
  propRot: 0,
  role: "prop",
  alive: true,
  hp: 0,
  kills: 0,
  propType: "crate",
  ready: true,
  ...over,
});

const world = (target) => ({
  phase: "hunting",
  self: body("self", 0, 0, { role: "hunter", hp: 100, propType: "" }),
  others: [target],
  decoys: [],
});

const intent = { kind: "shootTarget", targetId: "target", seq: 1 };

/**
 * Hold a hunter on a target for `ticks` ticks, the target standing where
 * `at(tick)` puts it, and score every shot as the server would: against where
 * the target stands on the tick it was fired.
 */
function engage(seed, ticks, at) {
  const reflex = new Reflex(DIFFICULTY, "full", makeRng(seed));
  reflex.setMap(ARENA);
  reflex.syncPosition(0, 0, 0);
  const shots = [];
  for (let tick = 0; tick < ticks; tick++) {
    const { x, z } = at(tick);
    const now = START_MS + tick * TICK_MS;
    const { shoot } = reflex.executeIntent(intent, world(body("target", x, z)), TICK_S, now);
    if (!shoot) continue;
    const origin = { x: reflex.x, y: BOT_EYE_HEIGHT, z: reflex.z };
    shots.push({
      at: now,
      dir: shoot.dir,
      hit: canHitTarget(origin, shoot.dir, x, 0, z, BOUNDS, []),
    });
  }
  return shots;
}

const runner = (tick) => ({ x: RUN_FROM_X + PROP_RUN_SPEED * tick * TICK_S, z: RANGE });
const runnerTicks = Math.ceil((2 * -RUN_FROM_X) / (PROP_RUN_SPEED * TICK_S));
const stillAt = () => ({ x: 0, z: RANGE });

function hitRate(shots) {
  return shots.filter((shot) => shot.hit).length / shots.length;
}

function trials(ticks, at) {
  const shots = [];
  for (let seed = 1; seed <= TRIALS; seed++) shots.push(...engage(seed, ticks, at));
  return shots;
}

test("the trigger is certain on target and grows reluctant as the aim strays", () => {
  assert.equal(fireChance(0), 1);
  const errors = [0.5, 1, 2, 3].map((k) => k * AIM_FIRE_ERROR_RAD);
  const chances = errors.map(fireChance);
  for (let i = 1; i < chances.length; i++) assert.ok(chances[i] < chances[i - 1]);
  assert.ok(
    chances.at(-1) < FAR_OFF_FIRE_CHANCE_MAX,
    "a crosshair far off the target almost never fires",
  );
});

test("a shot is harder the faster the target crosses, the further it is, and the faster the hunter moves", () => {
  const still = { lateralSpeed: 0, distance: RANGE, selfSpeed: 0 };
  const base = aimSpread(still, DIFFICULTY);
  assert.ok(aimSpread({ ...still, lateralSpeed: PROP_RUN_SPEED }, DIFFICULTY) > base);
  assert.ok(aimSpread({ ...still, distance: 2 * RANGE }, DIFFICULTY) > base);
  assert.ok(aimSpread({ ...still, selfSpeed: MOVE_SPEED }, DIFFICULTY) > base);
  assert.ok(aimSpread(still, 1) < base, "a harder bot aims tighter");
  assert.ok(aimSpread(still, 0) > base, "a weaker bot aims looser");
});

test("only the speed across the line of sight counts, not toward or away", () => {
  assert.equal(lateralSpeed(0, 5, 0, 10), 0);
  assert.equal(lateralSpeed(5, 0, 0, 10), 5);
  assert.ok(Math.abs(lateralSpeed(3, 4, 0, 10) - 3) < 1e-9);
});

test("a reaction time varies per draw around the difficulty's mean, never under its floor", () => {
  const rng = makeRng(7);
  const draws = Array.from({ length: DRAWS }, () => reactionDelayMs(DIFFICULTY, rng));
  const floor = REACTION_MEAN_MS * REACTION_FLOOR_FRACTION;
  assert.ok(draws.every((ms) => ms >= floor));
  assert.ok(new Set(draws).size > DRAWS / 2, "the draws differ");
  const mean = draws.reduce((sum, ms) => sum + ms, 0) / DRAWS;
  assert.ok(Math.abs(mean - REACTION_MEAN_MS) < REACTION_MEAN_MS * REACTION_MEAN_TOLERANCE);
});

test("a velocity is read off successive sightings", () => {
  const estimate = new VelocityEstimate();
  for (let tick = 0; tick < 20; tick++) {
    estimate.observe(PROP_RUN_SPEED * tick * TICK_S, 0, START_MS + tick * TICK_MS);
  }
  assert.ok(Math.abs(estimate.vx - PROP_RUN_SPEED) < 1e-6);
  assert.ok(Math.abs(estimate.vz) < 1e-9);
});

/**
 * The point of the change: a prop running across a hunter's view is fired at,
 * and is a harder shot than one standing still, so the hunter sometimes misses
 * it and pays for the miss as a player would.
 */
test("a hunter fires at a prop running across its view, and misses it more than one standing still", () => {
  const atRunner = trials(runnerTicks, runner);
  const atStill = trials(STILL_TICKS, stillAt);
  assert.ok(atRunner.length >= TRIALS, "the runner is fired at");
  const runnerHits = hitRate(atRunner);
  const stillHits = hitRate(atStill);
  assert.ok(
    runnerHits > 0 && runnerHits < 1,
    `some shots at a runner hit, some miss (${runnerHits})`,
  );
  assert.ok(
    stillHits > STILL_HIT_RATE_MIN,
    `a still prop at ${RANGE} m is usually hit (${stillHits})`,
  );
  assert.ok(
    runnerHits < stillHits - RUNNER_HIT_RATE_GAP_MIN,
    `a runner is the much harder shot (${runnerHits} vs ${stillHits})`,
  );
});

test("a new target is fired at only after a reaction time drawn for it", () => {
  const firsts = [];
  for (let seed = 1; seed <= TRIALS; seed++) {
    const [first] = engage(seed, STILL_TICKS, stillAt);
    assert.ok(first, "a still target in the open is fired at");
    firsts.push(first.at - START_MS);
  }
  assert.ok(firsts.every((ms) => ms >= REACTION_MEAN_MS * REACTION_FLOOR_FRACTION));
  assert.ok(new Set(firsts).size > 1, "the reaction differs from one acquisition to the next");
});

/**
 * Tracking a runner keeps the aim a little off it all the time. The old gate
 * re-armed the reaction time whenever the error passed 4 degrees, which is
 * why a hunter tracking a runner never fired at all.
 */
test("tracking a runner never re-arms the reaction time", () => {
  const gaps = [];
  for (let seed = 1; seed <= TRIALS; seed++) {
    const shots = engage(seed, runnerTicks, runner);
    for (let i = 1; i < shots.length; i++) gaps.push(shots[i].at - shots[i - 1].at);
  }
  assert.ok(gaps.length > 0, "a runner tracked across the view is fired at more than once");
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  assert.ok(median < BOT_FIRE_COOLDOWN_MS + REACTION_MEAN_MS * REACTION_FLOOR_FRACTION);
});

test("the same seed aims the same shots", () => {
  assert.deepEqual(engage(3, runnerTicks, runner), engage(3, runnerTicks, runner));
});
