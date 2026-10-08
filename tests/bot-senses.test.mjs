import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GLANCE_ANGLE_MAX_RAD,
  GLANCE_INTERVAL_MIN_MS,
  GLANCE_TURN_RATE,
  HUNTER_VERTICAL_FOV_DEG,
  HUNTER_VIEW_HALF_ANGLE_RAD,
  REFERENCE_ASPECT,
  SIGHT_CELL_SIZE,
} from "../packages/bot/src/config.ts";
import { BotDriver } from "../packages/bot/src/driver.ts";
import { bodySamples, Glance, SightIndex, sightOf } from "../packages/bot/src/perception.ts";
import { Reflex } from "../packages/bot/src/reflex.ts";
import { FIELD_OF_VIEW_DEFAULT } from "../packages/client/src/game/prefs.ts";
import { SPACE_CATALOG } from "../packages/server/src/spaceCatalog.ts";
import {
  ASSET_CARDS,
  FOOTSTEP_HEARING_RADIUS,
  fittedExtent,
  MOVE_SPEED,
  makeRng,
  RUN_MULTIPLIER_PROP,
} from "../packages/shared/src/index.ts";

const TICK_MS = 50;
const TICK_S = TICK_MS / 1_000;
const FACING_NORTH = 0;
const FACING_EAST = Math.PI / 2;
const FACING_SOUTH = Math.PI;
const PROP_RUN_STEP = MOVE_SPEED * RUN_MULTIPLIER_PROP * TICK_S;

const box = (sx, sy, sz) => ({
  kind: "box",
  position: { x: 0, y: sy / 2, z: 0 },
  size: { x: sx, y: sy, z: sz },
  color: "#000",
});
const CRATE = { id: "crate", name: "Crate", parts: [box(1, 1, 1)] };
const BARREL = { id: "barrel", name: "Barrel", parts: [box(0.8, 1.2, 0.8)] };
const CABINET = { id: "cabinet", name: "Cabinet", parts: [box(2.4, 2.2, 0.6)] };
const PILLAR = { id: "pillar", name: "Pillar", parts: [box(0.3, 3, 0.3)] };
const CATALOG = [CRATE, BARREL, CABINET, PILLAR];

/** A wall across the hunter's view, 4 m ahead along +z, wide enough to hide anything behind it. */
const WALL_AHEAD = { position: { x: 0, y: 2, z: 4 }, size: { x: 12, y: 4, z: 0.4 } };

function arena({ props = [], colliders = [] } = {}) {
  return {
    id: "senses",
    bounds: { min: { x: -30, y: 0, z: -30 }, max: { x: 30, y: 10, z: 30 } },
    spawnPoints: { props: [{ x: 0, y: 0, z: 0 }] },
    colliders,
    tiles: [],
    scenery: [],
    props,
    propCatalog: CATALOG,
  };
}

const placed = (type, x, z, rotation = 0) => ({ type, position: { x, y: 0, z }, rotation });

const prop = (id, x, z, over = {}) => ({
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

const hunterAt = (x, z, rot, id = "self") =>
  prop(id, x, z, { role: "hunter", propType: "", hp: 100, rot, aim: rot });

/**
 * Run a real `BotDriver` against a scripted world and return every
 * observation its policy was handed. The policy answers with `intent` every
 * time: `idle` keeps the bot facing where it was put, a search (`patrol`,
 * `moveTo`) glances. `script(tick)` returns the other players and decoys that
 * tick and may turn the bot by calling `turn(rot)`.
 */
async function observe({ map, self, intent = { kind: "idle" }, ticks, script }) {
  const observations = [];
  const driver = new BotDriver({
    name: "Senses",
    difficulty: 0.6,
    readyAtPlayers: 2,
    policy: {
      name: "capture",
      decide: (obs) => {
        observations.push(obs);
        return { ...intent, seq: obs.seq };
      },
    },
    visibility: "limited",
    trace: null,
    rng: makeRng(1),
  });
  driver.setMap(map);
  const turn = (rot) => {
    self.rot = rot;
    self.aim = rot;
    driver.syncPosition(self.x, self.z, rot);
  };
  let now = 1_000;
  for (let tick = 0; tick < ticks; tick++) {
    now += TICK_MS;
    const { others, decoys = [] } = script(tick, turn);
    const action = driver.tick({ phase: "hunting", winner: "", self, others, decoys }, now);
    if (action.input) {
      self.x = action.input.x;
      self.z = action.input.z;
      self.rot = action.input.rot;
      self.aim = action.input.aim;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  await driver.stop();
  assert.ok(observations.length > 2, "the policy was asked to decide");
  return observations;
}

const seenIn = (observations) =>
  observations.flatMap((obs) => obs.entities.filter((e) => e.hasLineOfSight));
const heardIn = (observations) =>
  observations.flatMap((obs) => obs.entities.filter((e) => !e.hasLineOfSight));

test("a hunter's cone is the default field of view a player's camera opens at", () => {
  assert.equal(HUNTER_VERTICAL_FOV_DEG, FIELD_OF_VIEW_DEFAULT, "the same default as the client");
  const halfVertical = (FIELD_OF_VIEW_DEFAULT * Math.PI) / 360;
  const derived = Math.atan(Math.tan(halfVertical) * REFERENCE_ASPECT);
  assert.equal(HUNTER_VIEW_HALF_ANGLE_RAD, derived);
  const degrees = (2 * HUNTER_VIEW_HALF_ANGLE_RAD * 180) / Math.PI;
  assert.ok(degrees > 85 && degrees < 87, `about 86 degrees across, got ${degrees.toFixed(1)}`);
});

test("a disguise directly behind a hunter is not seen, one ahead of it is", async () => {
  const behind = await observe({
    map: arena(),
    self: hunterAt(0, 0, FACING_NORTH),
    ticks: 40,
    script: () => ({ others: [prop("crate", 0, -5)] }),
  });
  assert.deepEqual(seenIn(behind), [], "nothing behind a hunter is on its screen");
  assert.deepEqual(heardIn(behind), [], "and a disguise standing still makes no sound");

  const ahead = await observe({
    map: arena(),
    self: hunterAt(0, 0, FACING_NORTH),
    ticks: 40,
    script: () => ({ others: [prop("crate", 0, 5)] }),
  });
  assert.ok(seenIn(ahead).length > 0, "the same disguise in front of it is");
});

test("a still disguise spinning behind a wall is neither seen nor heard", async () => {
  const observations = await observe({
    map: arena({ colliders: [WALL_AHEAD] }),
    self: hunterAt(0, 0, FACING_NORTH),
    ticks: 60,
    script: (tick) => ({ others: [prop("crate", 0, 8, { propRot: tick * 0.4 })] }),
  });
  assert.deepEqual(seenIn(observations), [], "the wall hides it");
  assert.deepEqual(heardIn(observations), [], "a spin in place makes no sound");
});

test("a still disguise spinning right behind a hunter's back is not heard either", async () => {
  const observations = await observe({
    map: arena(),
    self: hunterAt(0, 0, FACING_NORTH),
    ticks: 60,
    script: (tick) => ({ others: [prop("crate", 0, -2, { propRot: tick * 0.4 })] }),
  });
  assert.deepEqual(
    observations.flatMap((obs) => obs.entities),
    [],
  );
});

test("motion out of sight and out of earshot is no tell once the mover is seen", async () => {
  const far = FOOTSTEP_HEARING_RADIUS + 8;
  let x = far;
  const observations = await observe({
    map: arena(),
    self: hunterAt(0, 0, FACING_NORTH),
    ticks: 40,
    script: (tick, turn) => {
      if (tick < 10) x += 0.1;
      if (tick === 11) turn(FACING_EAST);
      return { others: [prop("crate", x, 0)] };
    },
  });
  const seen = seenIn(observations);
  assert.ok(seen.length > 0, "once the hunter turns, the disguise is in sight");
  assert.ok(
    seen.every((e) => e.movedRecently === false && e.tellRecently === false),
    "it moved where nobody could see or hear it, so it gave nothing away",
  );
});

test("motion past the range of sight is no tell once the hunter closes in", () => {
  const reflex = new Reflex(0.6, "limited");
  reflex.setMap({
    ...arena(),
    bounds: { min: { x: -60, y: 0, z: -30 }, max: { x: 60, y: 10, z: 30 } },
  });
  reflex.syncPosition(0, 0, FACING_EAST);
  const world = (x) => ({
    phase: "hunting",
    self: hunterAt(0, 0, FACING_EAST),
    others: [prop("crate", x, 0)],
    decoys: [],
  });
  assert.deepEqual(reflex.buildObservation(world(40), 1, 1_000).entities, []);
  assert.deepEqual(reflex.buildObservation(world(41), 2, 1_200).entities, []);
  reflex.syncPosition(19, 0, FACING_EAST);
  const [first] = reflex.buildObservation(world(41), 3, 1_300).entities;
  assert.ok(first, "within range, the disguise is in sight");
  assert.equal(first.movedRecently, false);
  assert.equal(first.tellRecently, false, "the step it took out of range was never witnessed");
});

test("a prop running up behind a hunter is heard as a place, never seen or named", async () => {
  let z = -11;
  const observations = await observe({
    map: arena(),
    self: hunterAt(0, 0, FACING_NORTH),
    ticks: 60,
    script: (tick, turn) => {
      if (z < -1.5) z = Math.min(-1.5, z + PROP_RUN_STEP);
      if (tick === 45) turn(FACING_SOUTH);
      return { others: [prop("crate", 0, z)] };
    },
  });
  const heard = heardIn(observations);
  assert.ok(heard.length > 0, "its rustle carries to the hunter");
  for (const contact of heard) {
    assert.equal(contact.disguised, undefined, "footsteps say nothing about shape");
    assert.equal(contact.tellRecently, undefined);
    assert.equal(contact.x % 4, 0, "a rustle out of sight is placed only to a neighbourhood");
  }
  const seen = seenIn(observations);
  assert.ok(seen.length > 0, "turning round, the hunter sees it");
  const heardIds = new Set(heard.map((e) => e.id));
  assert.ok(
    seen.every((e) => !heardIds.has(e.id)),
    "the handle a sound was heard by does not name the disguise once seen",
  );
  assert.ok(
    seen.every((e) => e.tellRecently === false),
    "and the approach it only heard is no tell on what it then sees standing still",
  );
});

test("a rustle is a place: two steps of one prop are two spots, not one tracked player", async () => {
  let x = -10;
  const observations = await observe({
    map: arena({ colliders: [WALL_AHEAD] }),
    self: hunterAt(0, 0, FACING_SOUTH),
    ticks: 80,
    script: () => {
      x = Math.min(10, x + PROP_RUN_STEP / 2);
      return { others: [prop("crate", x, 6)] };
    },
  });
  const heard = heardIn(observations);
  const spots = new Set(heard.map((e) => `${e.x},${e.z}`));
  const ids = new Set(heard.map((e) => e.id));
  assert.ok(spots.size >= 2, "the mover crossed several neighbourhoods");
  assert.equal(ids.size, spots.size, "each neighbourhood is its own contact");
});

test("a hunter's footsteps are heard by nobody, a prop's by everybody in earshot", async () => {
  const walkerBehindTheWall = (walker) => {
    let x = -3;
    return observe({
      map: arena({ colliders: [WALL_AHEAD] }),
      self: prop("self", 0, 0),
      ticks: 40,
      script: () => {
        x += 0.15;
        return { others: [{ ...walker, x }] };
      },
    });
  };
  const hunter = await walkerBehindTheWall(hunterAt(-3, 7, FACING_EAST, "hunter"));
  assert.deepEqual(
    hunter.flatMap((obs) => obs.entities),
    [],
    "no client plays a hunter's footsteps, so a bot does not hear them either",
  );
  const mate = await walkerBehindTheWall(prop("mate", -3, 7));
  assert.ok(heardIn(mate).length > 0, "a prop walking behind the same wall rustles");
});

test("a disguise that rerolled behind a wall is no tell when it comes into sight", () => {
  const reflex = new Reflex(0.6, "limited");
  reflex.setMap(arena({ colliders: [WALL_AHEAD] }));
  reflex.syncPosition(0, 0, FACING_NORTH);
  const world = (propType) => ({
    phase: "hunting",
    self: hunterAt(0, 0, FACING_NORTH),
    others: [prop("crate", 0, 8, { propType })],
    decoys: [],
  });
  assert.deepEqual(reflex.buildObservation(world("crate"), 1, 1_000).entities, []);
  assert.deepEqual(reflex.buildObservation(world("barrel"), 2, 1_200).entities, []);
  reflex.syncPosition(7, 6, Math.atan2(0 - 7, 8 - 6));
  const after = reflex.buildObservation(world("barrel"), 3, 1_300).entities;
  assert.equal(after.length, 1, "past the wall's end, the barrel is in sight");
  assert.equal(after[0].tellRecently, false, "and it changed shape where nobody saw");
});

test("a cabinet hides a smaller disguise standing behind it", () => {
  const reflex = new Reflex(0.6, "limited");
  reflex.setMap(arena({ props: [placed("cabinet", 0, 5)] }));
  reflex.syncPosition(0, 0, FACING_NORTH);
  const obs = reflex.buildObservation(
    {
      phase: "hunting",
      self: hunterAt(0, 0, FACING_NORTH),
      others: [prop("crate", 0, 6.5)],
      decoys: [],
    },
    1,
    1_000,
  );
  assert.equal(obs.entities.length, 1, "only the cabinet is in sight");
  assert.equal(obs.entities[0].distance, 5, "and it is the cabinet, not the crate behind it");
});

test("the part of a disguise that shows past furniture is enough to see it, and aim at", () => {
  const reflex = new Reflex(0.6, "limited", makeRng(1));
  reflex.setMap(arena({ props: [placed("pillar", 0, 4)] }));
  reflex.syncPosition(0, 0, FACING_NORTH);
  const world = {
    phase: "hunting",
    self: hunterAt(0, 0, FACING_NORTH),
    others: [prop("crate", 0, 8)],
    decoys: [],
  };
  const obs = reflex.buildObservation(world, 1, 1_000);
  const crate = obs.entities.find((e) => e.distance === 8);
  assert.ok(crate, "a pillar narrower than the crate leaves its sides in sight");
  assert.equal(crate.hasLineOfSight, true);

  const sight = new SightIndex(arena({ props: [placed("pillar", 0, 4)] }));
  const viewer = { x: 0, y: 1.6, z: 0, heading: FACING_NORTH, halfAngle: null, range: 30 };
  const at = sightOf(sight, viewer, {
    x: 0,
    y: 0,
    z: 8,
    yaw: 0,
    extent: { halfX: 0.5, halfZ: 0.5, yMin: 0, yMax: 1 },
  });
  assert.ok(at && at.x !== 0, "the point seen, and aimed at, is off the pillar's line");
});

test("a piece of furniture never hides itself", () => {
  const reflex = new Reflex(0.6, "limited");
  reflex.setMap(arena({ props: [placed("cabinet", 0, 5)] }));
  reflex.syncPosition(0, 0, FACING_NORTH);
  const obs = reflex.buildObservation(
    { phase: "hunting", self: hunterAt(0, 0, FACING_NORTH), others: [], decoys: [] },
    1,
    1_000,
  );
  assert.equal(obs.entities.length, 1, "every sample of the cabinet lies inside its own boxes");
});

test("furniture turned with its placement blocks sight by its turned shape", () => {
  const view = { x: 0, y: 1.6, z: 0, heading: FACING_NORTH, halfAngle: null, range: 30 };
  const target = {
    x: 1.5,
    y: 0,
    z: 8,
    yaw: 0,
    extent: { halfX: 0.3, halfZ: 0.3, yMin: 0, yMax: 1 },
  };
  const along = new SightIndex(arena({ props: [placed("cabinet", 0, 5)] }));
  const turned = new SightIndex(arena({ props: [placed("cabinet", 0, 5, Math.PI / 2)] }));
  assert.equal(sightOf(along, view, target), null, "laid across the view, it covers the target");
  assert.ok(sightOf(turned, view, target), "turned end-on, the view passes beside it");
});

test("every point looked for on a disguise lies inside the model it renders as, however turned", () => {
  const viewer = { x: 0, y: 1.6, z: 0, heading: FACING_NORTH, halfAngle: null, range: 30 };
  const rng = makeRng(7);
  for (const def of SPACE_CATALOG) {
    const extent = fittedExtent(def, ASSET_CARDS);
    for (let i = 0; i < 20; i++) {
      const body = { x: 10 * rng() - 5, y: 0, z: 10 * rng() + 3, yaw: 2 * Math.PI * rng(), extent };
      for (const sample of bodySamples(viewer, body)) {
        const dx = sample.x - body.x;
        const dz = sample.z - body.z;
        const localX = dx * Math.cos(body.yaw) - dz * Math.sin(body.yaw);
        const localZ = dx * Math.sin(body.yaw) + dz * Math.cos(body.yaw);
        assert.ok(Math.abs(localX) <= extent.halfX + 1e-9, `${def.id} x`);
        assert.ok(Math.abs(localZ) <= extent.halfZ + 1e-9, `${def.id} z`);
        assert.ok(sample.y >= extent.yMin && sample.y <= extent.yMax, `${def.id} y`);
      }
    }
  }
});

test("a disguise whose whole model a container hides is not seen spinning, though its hitbox sticks out", () => {
  const spinBehind = (furniture) => {
    const reflex = new Reflex(0.6, "limited", makeRng(1));
    reflex.setMap({ ...arena({ props: furniture }), propCatalog: SPACE_CATALOG });
    reflex.syncPosition(0, 0, FACING_NORTH);
    const hidden = prop("hidden", 0, 6.5, { propType: "container-wide" });
    const world = {
      phase: "hunting",
      self: hunterAt(0, 0, FACING_NORTH),
      others: [hidden],
      decoys: [],
    };
    reflex.buildObservation(world, 1, 1_000);
    hidden.propRot = 0.21;
    return reflex.buildObservation(world, 2, 1_050).entities.find((e) => e.distance === 6.5);
  };
  const open = spinBehind([]);
  assert.equal(open?.tellRecently, true, "in the open the spin is seen");
  assert.equal(
    spinBehind([placed("container-tall", 0, 5)]),
    undefined,
    "behind the tall container nothing of the wide one shows",
  );
});

/**
 * A hunter walking about, glancing aside now and then, among a still player,
 * a decoy and a piece of furniture of one shape. Each drifts in and out of
 * sight as the hunter turns; none of them ever moves, so none may ever be a
 * suspect, and all three must read the same.
 */
test("still players, decoys and furniture are never a suspect, in sight or after a gap", async (t) => {
  t.mock.method(Math, "random", makeRng(5));
  const map = arena({ props: [placed("crate", 6, 6)] });
  const decoy = { id: "d1", x: -6, y: 0, z: 6, rot: 0, propType: "crate" };
  const observations = await observe({
    map,
    self: hunterAt(0, 0, FACING_NORTH),
    intent: { kind: "patrol" },
    ticks: 600,
    script: () => ({ others: [prop("crate", 6, -6)], decoys: [decoy] }),
  });
  const kindAt = (e) => (e.z > 0 ? (e.x > 0 ? "scenery" : "decoy") : "player");
  const sightings = { player: 0, decoy: 0, scenery: 0 };
  const gaps = { player: 0, decoy: 0, scenery: 0 };
  let previous = new Set();
  for (const obs of observations) {
    const now = new Set();
    for (const e of obs.entities) {
      assert.equal(e.hasLineOfSight, true, "nothing here moves, so nothing is ever heard");
      assert.equal(e.tellRecently, false, `a still ${kindAt(e)} gave nothing away`);
      assert.equal(e.movedRecently, false);
      sightings[kindAt(e)] += 1;
      now.add(kindAt(e));
    }
    for (const kind of now) if (!previous.has(kind) && sightings[kind] > 1) gaps[kind] += 1;
    previous = now;
  }
  for (const kind of Object.keys(sightings)) {
    assert.ok(sightings[kind] >= 3, `the ${kind} was in sight (${sightings[kind]} times)`);
    assert.ok(gaps[kind] >= 1, `and was seen again after dropping out of sight`);
  }
});

/** Whether a point lies inside a placed part of furniture, tested in the part's own frame. */
function insidePart(map, point) {
  const catalog = new Map(map.propCatalog.map((def) => [def.id, def]));
  return map.props.some((placedProp) => {
    const cos = Math.cos(placedProp.rotation);
    const sin = Math.sin(placedProp.rotation);
    return catalog.get(placedProp.type).parts.some((part) => {
      const cx = placedProp.position.x + part.position.x * cos + part.position.z * sin;
      const cz = placedProp.position.z - part.position.x * sin + part.position.z * cos;
      const dx = point.x - cx;
      const dz = point.z - cz;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      const bottom = placedProp.position.y + part.position.y - part.size.y / 2;
      return (
        Math.abs(lx) <= part.size.x / 2 &&
        Math.abs(lz) <= part.size.z / 2 &&
        point.y >= bottom &&
        point.y <= bottom + part.size.y
      );
    });
  });
}

/**
 * The grid walk against the slow truth: furniture scattered at random angles
 * and sightlines of every length and direction, a quarter of them starting or
 * ending exactly on a grid line, each checked by stepping along it a few
 * millimetres at a time.
 */
test("a sightline is blocked exactly when some furniture stands on it, wherever it runs", () => {
  const rng = makeRng(3);
  const span = (lo, hi) => lo + (hi - lo) * rng();
  const props = Array.from({ length: 40 }, () =>
    placed(
      ["crate", "barrel", "cabinet", "pillar"][Math.floor(rng() * 4)],
      span(-20, 20),
      span(-20, 20),
      span(-Math.PI, Math.PI),
    ),
  );
  const map = arena({ props });
  const sight = new SightIndex(map);
  const onGrid = (v) => Math.round(v / SIGHT_CELL_SIZE) * SIGHT_CELL_SIZE;
  let blocked = 0;
  for (let n = 0; n < 400; n++) {
    const from = { x: span(-25, 25), y: span(0.2, 2.5), z: span(-25, 25) };
    const to = { x: span(-25, 25), y: span(0.2, 2.5), z: span(-25, 25) };
    if (n % 4 === 0) {
      from.x = onGrid(from.x);
      to.z = onGrid(to.z);
    }
    const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const steps = Math.ceil(length / 0.002);
    let truth = false;
    for (let k = 0; k < steps && !truth; k++) {
      const t = k / steps;
      truth = insidePart(map, {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: from.z + (to.z - from.z) * t,
      });
    }
    if (truth) blocked += 1;
    assert.equal(sight.clear(from, to), !truth, `sightline ${n} from ${JSON.stringify(from)}`);
  }
  assert.ok(blocked > 50 && blocked < 350, `a fair mix of blocked and clear lines (${blocked})`);
});

test("a contact walking up behind a hunter does not wake it, one walking into view does", async () => {
  const calls = [];
  const driver = new BotDriver({
    name: "Wake",
    difficulty: 0.6,
    readyAtPlayers: 2,
    policy: {
      name: "counter",
      decide: (obs) => {
        calls.push(obs.seq);
        return { kind: "idle", seq: obs.seq };
      },
    },
    visibility: "limited",
    trace: null,
  });
  driver.setMap(arena());
  driver.syncPosition(0, 0, FACING_NORTH);
  const self = hunterAt(0, 0, FACING_NORTH);
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const kick = (others, now) =>
    driver.maybeKickDecide({ phase: "hunting", self, others, decoys: [] }, now);
  try {
    kick([], 1_000);
    await settle();
    const baseline = calls.length;
    kick([prop("crate", 0, -3)], 1_001);
    await settle();
    assert.equal(calls.length, baseline, "a disguise behind the hunter is nothing it noticed");
    kick([prop("crate", 0, 3)], 1_002);
    await settle();
    assert.equal(calls.length, baseline + 1, "the same disguise in front of it is");
  } finally {
    await driver.stop();
  }
});

test("a honk from a disguise behind a hunter is heard roughly and pins nothing", () => {
  const reflex = new Reflex(0.6, "limited");
  reflex.setMap(arena());
  reflex.syncPosition(0, 0, FACING_NORTH);
  const world = {
    phase: "hunting",
    self: hunterAt(0, 0, FACING_NORTH),
    others: [prop("crate", 1.3, -5.3)],
    decoys: [],
  };
  assert.deepEqual(reflex.buildObservation(world, 1, 1_000).entities, []);
  reflex.hear("taunt", 1.3, -5.3, 1_050);
  const [sound] = reflex.buildObservation(world, 2, 1_100).sounds;
  assert.equal(sound.hasLineOfSight, false, "the honker is behind it");
  assert.deepEqual({ x: sound.x, z: sound.z }, { x: 0, z: -4 }, "placed only to a neighbourhood");
  reflex.syncPosition(0, 0, FACING_SOUTH);
  const [seen] = reflex.buildObservation(world, 3, 1_200).entities;
  assert.equal(seen.tellRecently, false, "turning round, it cannot tell which object honked");
});

test("a glance turns the view at a bounded rate and no more often than its interval", () => {
  const glance = new Glance();
  const rng = makeRng(7);
  let previous = 0;
  let turnsAway = 0;
  let wasAhead = true;
  const duration = 20_000;
  for (let now = 0; now <= duration; now += TICK_MS) {
    const offset = glance.update(now, TICK_S, rng);
    assert.ok(Math.abs(offset - previous) <= GLANCE_TURN_RATE * TICK_S + 1e-9);
    assert.ok(Math.abs(offset) <= GLANCE_ANGLE_MAX_RAD + 1e-9);
    if (wasAhead && offset !== 0) turnsAway += 1;
    wasAhead = offset === 0;
    previous = offset;
  }
  assert.ok(turnsAway >= 2, "it does look around");
  assert.ok(turnsAway <= duration / GLANCE_INTERVAL_MIN_MS + 1, `at most once an interval`);
});

test("a searching hunter glances round to what is beside it, an idle one does not", async (t) => {
  t.mock.method(Math, "random", makeRng(11));
  const beside = () => ({ others: [prop("crate", 5, 0)] });
  const searching = await observe({
    map: arena(),
    self: hunterAt(0, 0, FACING_NORTH),
    intent: { kind: "moveTo", x: 0, z: 0, run: false },
    ticks: 200,
    script: beside,
  });
  assert.ok(seenIn(searching).length > 0, "a glance brings the crate on its right into view");

  const idle = await observe({
    map: arena(),
    self: hunterAt(0, 0, FACING_NORTH),
    ticks: 200,
    script: (_, turn) => {
      turn(FACING_NORTH);
      return beside();
    },
  });
  assert.deepEqual(seenIn(idle), [], "staring ahead, it never would have");
});
