import assert from "node:assert/strict";
import { test } from "node:test";
import { buildObstacles } from "../packages/bot/src/collision.ts";
import {
  BOT_PROBE_INTERVAL_MAX_MS,
  BOT_PROBE_RETRY_MS,
  BOT_TELL_WINDOW_MS,
  HEARD_SOUND_MEMORY_MS,
} from "../packages/bot/src/config.ts";
import { Reflex } from "../packages/bot/src/reflex.ts";
import {
  makeRng,
  SONAR_HEARING_RADIUS,
  TAUNT_HEARING_RADIUS,
} from "../packages/shared/src/index.ts";

// A single wall standing between the bot at the origin and a contact further
// down the +x axis: it blocks line of sight without blocking the ground the
// snapped cell sits on.
const WALL = { position: { x: 5.2, y: 2, z: 0 }, size: { x: 0.4, y: 4, z: 12 } };

const MAP = {
  id: "sightline",
  bounds: { min: { x: -20, y: 0, z: -20 }, max: { x: 20, y: 10, z: 20 } },
  spawnPoints: { props: [{ x: 0, y: 0, z: 0 }] },
  colliders: [WALL],
  tiles: [],
  scenery: [],
  props: [],
  propCatalog: [],
};

/**
 * The hunter at the origin looks down the -x axis, at the open side: a hunter
 * sees only the cone it faces, and the wall stands behind it on +x.
 */
const FACING_OPEN_SIDE = -Math.PI / 2;

const contact = (x, z) => ({
  id: "target",
  name: "target",
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
});

const world = (other) => ({
  phase: "hunting",
  self: { ...contact(0, 0), id: "self", name: "self", role: "hunter", hp: 100, propType: "" },
  others: [other],
  decoys: [],
});

/** The one contact an observation holds, found without knowing its handle. */
function sole(obs) {
  assert.equal(obs.entities.length, 1, "expected exactly one contact");
  return obs.entities[0];
}

/** Observe twice so the mover registers as `movedRecently` on the second call. */
function observeMoving(reflex, from, to) {
  reflex.buildObservation(world(from), 1, 1_000);
  return reflex.buildObservation(world(to), 2, 1_200);
}

function ready(visibility, rng) {
  const reflex = new Reflex(0.6, visibility, rng);
  reflex.setMap(MAP);
  reflex.syncPosition(0, 0, FACING_OPEN_SIDE);
  return reflex;
}

test("a contact known only by sound reports a snapped position, not a point", () => {
  const obs = observeMoving(ready("limited"), contact(5.0, 1.0), contact(5.9, 1.9));
  const seen = sole(obs);
  assert.equal(seen.hasLineOfSight, false, "the wall blocks sight, so this is a sound contact");
  assert.equal(seen.x, 4, "x snaps to the cell it was heard in");
  assert.equal(seen.z, 0, "z snaps too");
  assert.notEqual(seen.x, 5.9);
  assert.equal(
    seen.distance,
    Math.hypot(seen.x, seen.z),
    "distance is derived from the reported position, so the observation stays self-consistent",
  );
});

test("a contact in line of sight keeps its exact position", () => {
  const reflex = ready("limited");
  const obs = observeMoving(reflex, contact(-5.0, 1.0), contact(-5.9, 1.9));
  const seen = sole(obs);
  assert.equal(seen.hasLineOfSight, true, "nothing stands on the -x side");
  assert.equal(seen.x, -5.9);
  assert.equal(seen.z, 1.9);
});

/**
 * Shape is a sighting, not a sense. Footsteps through a wall tell a player
 * nothing about what is making them, so a heard contact carries no `disguised`;
 * otherwise a bot would know a noise was a teammate's and walk away from it.
 */
test("a contact known only by sound reports no shape", () => {
  const obs = observeMoving(ready("limited"), contact(5.0, 1.0), contact(5.9, 1.9));
  const heard = sole(obs);
  assert.equal(heard.hasLineOfSight, false);
  assert.equal(heard.disguised, undefined, "the disguise a wall hides is not sensed");
});

test("a contact in line of sight reports whether it wears a disguise", () => {
  const obs = observeMoving(ready("limited"), contact(-5.0, 1.0), contact(-5.9, 1.9));
  const seen = sole(obs);
  assert.equal(seen.disguised, true, "a crate in plain sight reads as a disguise");

  const hunter = { ...contact(-5.9, 1.9), role: "hunter", propType: "" };
  const next = observeMoving(ready("limited"), { ...hunter, x: -5.0, z: 1.0 }, hunter);
  const character = sole(next);
  assert.equal(character.disguised, false, "a character with a weapon cannot be a prop");
});

test("full visibility keeps ground truth even without line of sight", () => {
  const reflex = ready("full");
  const obs = observeMoving(reflex, contact(5.0, 1.0), contact(5.9, 1.9));
  const seen = obs.entities.find((e) => e.id === "target");
  assert.ok(seen);
  assert.equal(seen.hasLineOfSight, false);
  assert.equal(seen.x, 5.9, "the measuring anchor is untouched");
  assert.equal(seen.z, 1.9);
  assert.equal(seen.disguised, true, "the anchor reads shape through the wall too");
});

/** Far enough past the wall to clear both the sight line and the hearing radius. */
const GONE = contact(16, 3);
const IN_PLAIN_SIGHT = contact(-3, 0);

test("a contact lost from sight and earshot is tracked to where it was, not where it is", () => {
  const reflex = ready("limited");
  const seen = world(IN_PLAIN_SIGHT);
  const handle = sole(reflex.buildObservation(seen, 1, 1_000)).id;
  reflex.executeIntent(
    { kind: "inspect", targetId: handle, run: false, seq: 1 },
    seen,
    0.05,
    1_050,
  );
  assert.deepEqual(
    reflex.pathGoal,
    { x: -3, z: 0 },
    "a contact in plain sight is approached directly",
  );

  const lost = world(GONE);
  assert.equal(
    reflex.buildObservation(lost, 2, 1_100).entities.length,
    0,
    "it is out of both senses",
  );
  reflex.executeIntent(
    { kind: "inspect", targetId: handle, run: false, seq: 1 },
    lost,
    0.05,
    1_150,
  );

  assert.deepEqual(
    reflex.pathGoal,
    { x: -3, z: 0 },
    "the bot still searches the last place it saw it",
  );
});

test("a hunter does not chase a target it has never sensed", () => {
  const reflex = ready("limited");
  const lost = world(GONE);
  assert.equal(reflex.buildObservation(lost, 1, 1_000).entities.length, 0);
  reflex.executeIntent({ kind: "shootTarget", targetId: "target", seq: 1 }, lost, 0.05, 1_050);

  assert.equal(reflex.pathGoal, null, "nothing was ever perceived, so there is nowhere to go");
});

test("full visibility still paths to ground truth", () => {
  const reflex = ready("full");
  const lost = world(GONE);
  reflex.executeIntent(
    { kind: "inspect", targetId: "target", run: false, seq: 1 },
    lost,
    0.05,
    1_050,
  );

  assert.deepEqual(reflex.pathGoal, { x: 16, z: 3 }, "the measuring anchor is untouched");
});

test("a contact that has not moved is never heard through the wall", () => {
  const reflex = ready("limited");
  const still = contact(5.9, 1.9);

  for (const [seq, at] of [1_000, 1_200, 1_700].entries()) {
    const obs = reflex.buildObservation(world(still), seq + 1, at);
    assert.deepEqual(obs.entities, [], `a motionless contact makes no noise at t=${at}`);
  }
});

test("a contact is forgotten when it leaves the room", () => {
  const reflex = ready("limited");
  const empty = { ...world(contact(5.0, 1.0)), others: [] };

  reflex.buildObservation(world(contact(5.0, 1.0)), 1, 1_000);
  reflex.buildObservation(world(contact(5.9, 1.9)), 2, 1_200);
  assert.equal(reflex.buildObservation(world(contact(5.9, 1.9)), 3, 1_300).entities.length, 1);

  reflex.buildObservation(empty, 4, 1_400);
  const back = reflex.buildObservation(world(contact(5.9, 1.9)), 5, 1_500);
  assert.deepEqual(back.entities, [], "a returning id is not measured against its previous life");
});

test("a limited contact is named by a handle, never by its session id", () => {
  const reflex = ready("limited");
  const first = sole(reflex.buildObservation(world(IN_PLAIN_SIGHT), 1, 1_000));
  const again = sole(reflex.buildObservation(world(IN_PLAIN_SIGHT), 2, 1_100));
  assert.notEqual(first.id, "target", "the session id stays inside the reflex");
  assert.equal(again.id, first.id, "the same contact keeps the same handle");
});

const decoyAt = (x, z, id = "d0") => ({ id, x, y: 0, z, propType: "crate" });

const withDecoys = (others, decoys) => ({ ...world(contact(0, 0)), others, decoys });

/** An observation record with the fields that only place it stripped off. */
function shapeOf(entity) {
  const { id, x, z, distance, ...rest } = entity;
  return { ...rest, handle: id.replace(/[0-9]+/g, "#") };
}

test("a decoy in sight is listed as a disguise standing still", () => {
  const obs = ready("limited").buildObservation(withDecoys([], [decoyAt(-5, 0)]), 1, 1_000);
  const seen = sole(obs);
  assert.notEqual(seen.id, "d0", "the decoy's room key stays inside the reflex");
  assert.equal(seen.hasLineOfSight, true);
  assert.equal(seen.disguised, true);
  assert.equal(seen.movedRecently, false);
  assert.equal(seen.facingMe, false);
});

test("a decoy reads exactly as a disguised player standing still", () => {
  const reflex = ready("limited");
  const still = contact(-5, 2);
  reflex.buildObservation(withDecoys([still], [decoyAt(-5, -2)]), 1, 1_000);
  const obs = reflex.buildObservation(withDecoys([still], [decoyAt(-5, -2)]), 2, 1_200);
  assert.equal(obs.entities.length, 2);
  const [a, b] = obs.entities;
  assert.deepEqual(shapeOf(a), shapeOf(b), "nothing but position tells the two apart");
});

test("a decoy behind a wall is never sensed", () => {
  const reflex = ready("limited");
  for (const [seq, at] of [1_000, 1_200, 1_700].entries()) {
    const obs = reflex.buildObservation(withDecoys([], [decoyAt(5.9, 1.9)]), seq + 1, at);
    assert.deepEqual(obs.entities, [], "a decoy makes no sound to be heard by");
  }
});

test("the full-vision anchor lists no decoys", () => {
  const obs = ready("full").buildObservation(withDecoys([], [decoyAt(-5, 0)]), 1, 1_000);
  assert.deepEqual(obs.entities, []);
});

test("where a disguise is looking is not sensed, where a hunter is looking is", () => {
  const aimedAtOrigin = Math.atan2(5, 0);
  const prop = { ...contact(-5, 0), aim: aimedAtOrigin };
  const propObs = ready("limited").buildObservation(world(prop), 1, 1_000);
  assert.equal(sole(propObs).facingMe, false, "a crate has no eyes a player can read");

  const hunter = { ...prop, role: "hunter", propType: "" };
  const hunterObs = ready("limited").buildObservation(world(hunter), 1, 1_000);
  assert.equal(sole(hunterObs).facingMe, true, "a character aiming at you is plain to see");
});

test("a hunter shoots a decoy it has in its sights", () => {
  const reflex = ready("limited");
  const scene = withDecoys([], [decoyAt(-5, 0)]);
  const handle = sole(reflex.buildObservation(scene, 1, 1_000)).id;
  const intent = { kind: "shootTarget", targetId: handle, seq: 1 };
  let shot = null;
  for (let tick = 1; tick <= 60 && !shot; tick++) {
    shot = reflex.executeIntent(intent, scene, 0.05, 1_000 + tick * 50).shoot;
  }
  assert.ok(shot, "the decoy is fired at like any disguise standing still");
  assert.ok(shot.dir.x < 0, "and the shot goes toward it");
});

test("a taunt from a disguise in sight is heard where it was", () => {
  const reflex = ready("limited");
  const honker = contact(-5.9, 1.9);
  reflex.buildObservation(world(honker), 1, 950);
  reflex.hear("taunt", -5.9, 1.9, 1_000);
  const [sound] = reflex.buildObservation(world(honker), 2, 1_100).sounds;
  assert.ok(sound);
  assert.equal(sound.hasLineOfSight, true);
  assert.deepEqual({ x: sound.x, z: sound.z }, { x: -5.9, z: 1.9 });
  assert.equal(sound.ageMs, 100);
});

test("a taunt behind a wall is heard only roughly", () => {
  const reflex = ready("limited");
  reflex.hear("taunt", 5.9, 1.9, 1_000);
  const [sound] = reflex.buildObservation(world(GONE), 1, 1_100).sounds;
  assert.ok(sound);
  assert.equal(sound.hasLineOfSight, false);
  assert.deepEqual({ x: sound.x, z: sound.z }, { x: 4, z: 0 }, "snapped, as footsteps are");
});

test("a taunt names where and what, never who", () => {
  const reflex = ready("limited");
  reflex.hear("taunt", -5.9, 1.9, 1_000);
  const [sound] = reflex.buildObservation(world(GONE), 1, 1_100).sounds;
  assert.deepEqual(Object.keys(sound).sort(), [
    "ageMs",
    "distance",
    "hasLineOfSight",
    "id",
    "kind",
    "x",
    "z",
  ]);
});

test("a taunt past hearing range is not heard", () => {
  const reflex = ready("limited");
  reflex.hear("taunt", TAUNT_HEARING_RADIUS + 1, 0, 1_000);
  assert.deepEqual(reflex.buildObservation(world(GONE), 1, 1_100).sounds, []);
});

test("a heard taunt is forgotten after a few seconds", () => {
  const reflex = ready("limited");
  reflex.hear("taunt", -5.9, 1.9, 1_000);
  const later = 1_000 + HEARD_SOUND_MEMORY_MS + 1;
  assert.deepEqual(reflex.buildObservation(world(GONE), 1, later).sounds, []);
});

test("a sonar pulse carries only as far as a player hears it", () => {
  const reflex = ready("limited");
  reflex.hear("sonar", -(SONAR_HEARING_RADIUS - 1), 0, 1_000);
  reflex.hear("sonar", SONAR_HEARING_RADIUS + 1, 0, 1_000);
  const sounds = reflex.buildObservation(world(GONE), 1, 1_100).sounds;
  assert.equal(sounds.length, 1);
  assert.equal(sounds[0].kind, "sonar");
});

test("a hunter perceives nothing while the props hide", () => {
  const reflex = ready("limited");
  reflex.hear("taunt", -5.9, 1.9, 1_000);
  const blind = { ...world(IN_PLAIN_SIGHT), phase: "hiding" };
  const obs = reflex.buildObservation(blind, 1, 1_100);
  assert.deepEqual(obs.entities, [], "a player hunter stares at a blindout card");
  assert.deepEqual(obs.sounds, []);
});

const CRATE = {
  id: "crate",
  name: "Crate",
  parts: [
    { kind: "box", position: { x: 0, y: 0.5, z: 0 }, size: { x: 1, y: 1, z: 1 }, color: "#000" },
  ],
};

/** The sightline map with one crate of scenery standing on the open -x side. */
function furnished(propAt) {
  const reflex = new Reflex(0.6, "limited");
  reflex.setMap({
    ...MAP,
    props: [{ type: "crate", position: { x: propAt.x, y: 0, z: propAt.z }, rotation: 0 }],
    propCatalog: [CRATE],
  });
  reflex.syncPosition(0, 0, FACING_OPEN_SIDE);
  return reflex;
}

test("a scene prop in sight reads exactly as a disguised player standing still", () => {
  const reflex = furnished({ x: -5, z: -2 });
  const still = contact(-5, 2);
  reflex.buildObservation(world(still), 1, 1_000);
  const obs = reflex.buildObservation(world(still), 2, 1_200);
  assert.equal(obs.entities.length, 2);
  const [a, b] = obs.entities;
  assert.deepEqual(shapeOf(a), shapeOf(b), "nothing but position tells the two apart");
});

test("decor nobody can wear, a parked car, is never shown as a disguise", () => {
  const reflex = new Reflex(0.6, "limited");
  reflex.setMap({
    ...MAP,
    props: [{ type: "car", position: { x: -5, y: 0, z: -2 }, rotation: 0 }],
    propCatalog: [{ ...CRATE, id: "car", decor: true }],
  });
  reflex.syncPosition(0, 0, FACING_OPEN_SIDE);
  assert.deepEqual(reflex.buildObservation(world(GONE), 1, 1_000).entities, []);
  const parked = buildObstacles({
    ...MAP,
    props: [{ type: "car", position: { x: -5, y: 0, z: -2 }, rotation: 0 }],
    propCatalog: [{ ...CRATE, id: "car", decor: true }],
  });
  assert.equal(parked.length, 1, "but a bot still walks round it");
});

test("a prop is shown no scenery, since it hunts nobody", () => {
  const reflex = furnished({ x: -5, z: -2 });
  const asProp = { ...world(GONE), self: { ...contact(0, 0), id: "self" } };
  assert.deepEqual(reflex.buildObservation(asProp, 1, 1_000).entities, []);
});

test("handles are dealt nearest first, whatever the contact is", () => {
  const reflex = furnished({ x: -3, z: 0 });
  const obs = reflex.buildObservation(world(contact(-9, 0)), 1, 1_000);
  assert.equal(obs.entities.length, 2);
  const numbers = obs.entities.map((e) => Number(e.id.replace(/\D+/g, "")));
  assert.ok(
    numbers[0] < numbers[1],
    "a handle's number follows distance, so it cannot single out the players",
  );
});

test("a disguise seen moving stays a suspect for a few seconds, then blends back in", () => {
  const reflex = ready("limited");
  observeMoving(reflex, contact(-5.0, 1.0), contact(-5.9, 1.9));
  const stopped = contact(-5.9, 1.9);
  const soon = sole(reflex.buildObservation(world(stopped), 3, 1_200 + BOT_TELL_WINDOW_MS / 2));
  assert.equal(soon.movedRecently, false);
  assert.equal(soon.tellRecently, true, "the crate that just moved is still the one to watch");
  const later = sole(reflex.buildObservation(world(stopped), 4, 1_200 + BOT_TELL_WINDOW_MS + 1));
  assert.equal(later.tellRecently, false);
});

test("a disguise seen changing shape is a suspect", () => {
  const reflex = ready("limited");
  const before = contact(-5, 0);
  reflex.buildObservation(world(before), 1, 1_000);
  const after = sole(reflex.buildObservation(world({ ...before, propType: "barrel" }), 2, 1_200));
  assert.equal(after.movedRecently, false);
  assert.equal(after.tellRecently, true);
});

test("a disguise seen spinning in place has moved", () => {
  const reflex = ready("limited");
  const before = { ...contact(-5, 0), propRot: 0 };
  reflex.buildObservation(world(before), 1, 1_000);
  const spun = sole(reflex.buildObservation(world({ ...before, propRot: Math.PI / 2 }), 2, 1_200));
  assert.equal(spun.movedRecently, true);
  assert.equal(spun.tellRecently, true);
});

test("a honk seen coming from a disguise makes it a suspect", () => {
  const reflex = ready("limited");
  const still = contact(-5, 0);
  assert.equal(sole(reflex.buildObservation(world(still), 1, 1_000)).tellRecently, false);
  reflex.hear("taunt", -5, 0, 1_100);
  assert.equal(sole(reflex.buildObservation(world(still), 2, 1_200)).tellRecently, true);
});

test("a disguise that stood still gives nothing away", () => {
  const reflex = ready("limited");
  const still = contact(-5, 0);
  reflex.buildObservation(world(still), 1, 1_000);
  assert.equal(sole(reflex.buildObservation(world(still), 2, 1_200)).tellRecently, false);
});

test("a hunt opens with no disguise seen moving, however far it walked to hide", () => {
  const reflex = ready("limited");
  reflex.buildObservation({ ...world(contact(-2, 0)), phase: "starting" }, 1, 1_000);
  reflex.forgetContacts();
  reflex.buildObservation({ ...world(contact(-6, 1)), phase: "hiding" }, 2, 5_000);
  const opened = sole(reflex.buildObservation(world(contact(-6, 1)), 3, 20_000));
  assert.equal(opened.movedRecently, false);
  assert.equal(opened.tellRecently, false);
});

test("a hunter's probe falls due only a probe interval after its last shot", () => {
  const reflex = ready("limited", makeRng(1));
  const scene = world(contact(-5, 0));
  const handle = sole(reflex.buildObservation(scene, 1, 1_000)).id;
  const intent = { kind: "shootTarget", targetId: handle, seq: 1 };
  let firedAt = null;
  for (let tick = 1; tick <= 60 && firedAt === null; tick++) {
    const now = 1_000 + tick * 50;
    if (reflex.executeIntent(intent, scene, 0.05, now).shoot) firedAt = now;
  }
  assert.ok(firedAt, "the bot fired");
  assert.equal(reflex.buildObservation(scene, 2, firedAt + 1).self.canProbeNow, false);
  const due = reflex.buildObservation(scene, 3, firedAt + BOT_PROBE_INTERVAL_MAX_MS);
  assert.equal(due.self.canProbeNow, true);
  assert.equal(due.self.lastShotTargetId, handle, "and it knows what it fired at");
});

/** An aim seed whose first shot at a crate this far off goes past it. */
const MISS_SEED = 2;
const MISS_RANGE = 12;

/** The hunter's state a probe retry after its first shot at a crate, fired as a probe or not. */
function afterFirstMiss(probe) {
  const reflex = ready("limited", makeRng(MISS_SEED));
  const scene = world(contact(-MISS_RANGE, 0));
  const handle = sole(reflex.buildObservation(scene, 1, 1_000)).id;
  const intent = { kind: "shootTarget", targetId: handle, probe, seq: 1 };
  for (let tick = 1; tick <= 60; tick++) {
    const now = 1_000 + tick * 50;
    if (reflex.executeIntent(intent, scene, 0.05, now).shoot) {
      return reflex.buildObservation(scene, 2, now + BOT_PROBE_RETRY_MS).self;
    }
  }
  assert.fail("the bot never fired");
}

test("a probe that went past what it tested falls due again sooner", () => {
  const self = afterFirstMiss(true);
  assert.equal(self.lastShotTargetId, null, "the seed's shot goes past the crate");
  assert.equal(self.canProbeNow, true);
});

test("a shot at a suspect that went past it leaves the probe cadence as it was", () => {
  const self = afterFirstMiss(false);
  assert.equal(self.lastShotTargetId, null, "the seed's shot goes past the crate");
  assert.equal(self.canProbeNow, false);
});
