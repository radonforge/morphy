import assert from "node:assert/strict";
import { test } from "node:test";
import { falloff, stereoPan } from "../packages/client/src/game/spatialAudio.ts";

const facingNorth = { x: 0, z: 0, forwardX: 0, forwardZ: -1 };
const facingEast = { x: 0, z: 0, forwardX: 1, forwardZ: 0 };

test("a sound to the right of the view plays in the right ear", () => {
  assert.equal(stereoPan(facingNorth, 5, 0), 1);
  assert.equal(stereoPan(facingNorth, -5, 0), -1);
});

test("a sound dead ahead or behind plays centred", () => {
  assert.equal(stereoPan(facingNorth, 0, -5), 0);
  assert.equal(Math.abs(stereoPan(facingNorth, 0, 5)), 0);
});

test("turning the view turns the sound with it", () => {
  assert.equal(stereoPan(facingEast, 0, 5), 1, "facing +x, +z is on the right");
  assert.equal(stereoPan(facingEast, 0, -5), -1);
});

test("a sound on top of the listener plays centred", () => {
  assert.equal(stereoPan(facingNorth, 0, 0), 0);
});

test("a sound fades to silence at its radius", () => {
  assert.equal(falloff(facingNorth, 0, 0, 40), 1);
  assert.equal(falloff(facingNorth, 20, 0, 40), 0.5);
  assert.equal(falloff(facingNorth, 40, 0, 40), 0);
  assert.equal(falloff(facingNorth, 60, 0, 40), 0);
});
