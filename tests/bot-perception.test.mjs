import assert from "node:assert/strict";
import { test } from "node:test";
import { Reflex } from "../packages/bot/src/reflex.ts";

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

/** Observe twice so the mover registers as `movedRecently` on the second call. */
function observeMoving(reflex, from, to) {
  reflex.buildObservation(world(from), 1, 1_000);
  return reflex.buildObservation(world(to), 2, 1_200);
}

function ready(visibility) {
  const reflex = new Reflex(0.6, visibility);
  reflex.setMap(MAP);
  reflex.syncPosition(0, 0, 0);
  return reflex;
}

test("a contact known only by sound reports a snapped position, not a point", () => {
  const obs = observeMoving(ready("limited"), contact(5.0, 1.0), contact(5.9, 1.9));
  const seen = obs.entities.find((e) => e.id === "target");
  assert.ok(seen, "a mover within earshot is sensed");
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
  const seen = obs.entities.find((e) => e.id === "target");
  assert.ok(seen);
  assert.equal(seen.hasLineOfSight, true, "nothing stands on the -x side");
  assert.equal(seen.x, -5.9);
  assert.equal(seen.z, 1.9);
});

/**
 * Shape is a sighting, not a sense. Footsteps through a wall tell a player
 * nothing about what is making them, so a heard contact carries no `disguised`
 * — otherwise a bot would know a noise was a teammate's and walk away from it.
 */
test("a contact known only by sound reports no shape", () => {
  const obs = observeMoving(ready("limited"), contact(5.0, 1.0), contact(5.9, 1.9));
  const heard = obs.entities.find((e) => e.id === "target");
  assert.ok(heard);
  assert.equal(heard.hasLineOfSight, false);
  assert.equal(heard.disguised, undefined, "the disguise a wall hides is not sensed");
});

test("a contact in line of sight reports whether it wears a disguise", () => {
  const obs = observeMoving(ready("limited"), contact(-5.0, 1.0), contact(-5.9, 1.9));
  const seen = obs.entities.find((e) => e.id === "target");
  assert.ok(seen);
  assert.equal(seen.disguised, true, "a crate in plain sight reads as a disguise");

  const hunter = { ...contact(-5.9, 1.9), role: "hunter", propType: "" };
  const next = observeMoving(ready("limited"), { ...hunter, x: -5.0, z: 1.0 }, hunter);
  const character = next.entities.find((e) => e.id === "target");
  assert.ok(character);
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
const IN_PLAIN_SIGHT = contact(3, 0);

test("a contact lost from sight and earshot is tracked to where it was, not where it is", () => {
  const reflex = ready("limited");
  const seen = world(IN_PLAIN_SIGHT);
  reflex.buildObservation(seen, 1, 1_000);
  reflex.executeIntent(
    { kind: "inspect", targetId: "target", run: false, seq: 1 },
    seen,
    0.05,
    1_050,
  );
  assert.deepEqual(
    reflex.pathGoal,
    { x: 3, z: 0 },
    "a contact in plain sight is approached directly",
  );

  const lost = world(GONE);
  assert.equal(
    reflex.buildObservation(lost, 2, 1_100).entities.length,
    0,
    "it is out of both senses",
  );
  reflex.executeIntent(
    { kind: "inspect", targetId: "target", run: false, seq: 1 },
    lost,
    0.05,
    1_150,
  );

  assert.deepEqual(
    reflex.pathGoal,
    { x: 3, z: 0 },
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
