import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceMovement,
  clampToBounds,
  MAX_BODY_SPEED,
  MAX_FRAME_DISPLACEMENT,
  PLAYER_RADIUS,
  resolveColliders,
  STEP_HEIGHT,
} from "../packages/client/src/game/movement.ts";
import { buildMap } from "../packages/server/src/maps/index.ts";

const MAP_IDS = ["station", "mars", "urban"];
const BOUNDS = { min: { x: -50, y: 0, z: -50 }, max: { x: 50, y: 0, z: 50 } };
const WALL_Z = -4;
const WALL_HALF_THICKNESS = 0.15;

function body(overrides = {}) {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    heading: 0,
    jumpBufferMs: 0,
    jumpHeld: false,
    stepDistance: 0,
    ...overrides,
  };
}

/** Full forward input with the camera looking down -Z, so the body runs toward -Z. */
function running(overrides = {}) {
  return { forward: 1, strafe: 0, yaw: 0, run: true, jump: false, ...overrides };
}

function world(colliders = []) {
  return { colliders, bounds: BOUNDS, runMultiplier: MAX_BODY_SPEED / 5 };
}

/** A thin slab across the path, tall enough not to be a walkable step. */
const WALL = {
  x: 0,
  z: WALL_Z,
  cos: 1,
  sin: 0,
  hx: 6,
  hz: WALL_HALF_THICKNESS,
  yMin: 0,
  yMax: STEP_HEIGHT + 2,
};

/** One frame the way Scene.tsx spends it: integrate, then settle once. */
function frame(state, input, scene, seconds) {
  const result = advanceMovement(state, input, scene, seconds);
  resolveColliders(state, scene.colliders);
  clampToBounds(state, scene.bounds);
  return result;
}

test("no collider in any map is narrow enough for one frame to cross", () => {
  let thinnest = Infinity;
  let where = "";
  for (const mapId of MAP_IDS) {
    for (let seed = 0; seed < 50; seed++) {
      const map = buildMap(mapId, seed);
      for (const collider of map.colliders) {
        const half = Math.min(collider.size.x, collider.size.z) / 2;
        if (half < thinnest) {
          thinnest = half;
          where = `${mapId} collider ${collider.size.x}x${collider.size.z}`;
        }
      }
      for (const def of map.propCatalog) {
        for (const part of def.parts) {
          const half = Math.min(part.size.x, part.size.z) / 2;
          if (half < thinnest) {
            thinnest = half;
            where = `${mapId} prop ${def.id}`;
          }
        }
      }
    }
  }
  assert.ok(
    MAX_FRAME_DISPLACEMENT < 2 * (thinnest + PLAYER_RADIUS),
    `a frame moves ${MAX_FRAME_DISPLACEMENT} m but ${where} only blocks over ` +
      `${2 * (thinnest + PLAYER_RADIUS)} m, so a body can cross it untouched`,
  );
});

test("a wall stops a body running into it", () => {
  const state = body();
  const scene = world([WALL]);
  for (let i = 0; i < 120; i++) frame(state, running(), scene, 1 / 60);
  assert.ok(
    state.z > WALL_Z + WALL_HALF_THICKNESS,
    `expected the body to stay on the near side of the slab, got z=${state.z}`,
  );
});

test("a wall still stops a body arriving in one long frame", () => {
  const state = body({ z: -3, vz: -MAX_BODY_SPEED });
  frame(state, running(), world([WALL]), 0.25);
  assert.ok(
    state.z > WALL_Z + WALL_HALF_THICKNESS,
    `expected the body to stay on the near side of the slab, got z=${state.z}`,
  );
});

test("time hidden past the frame cap is discarded rather than simulated", () => {
  const hidden = body();
  advanceMovement(hidden, running(), world(), 30);
  const capped = body();
  advanceMovement(capped, running(), world(), MAX_FRAME_DISPLACEMENT / MAX_BODY_SPEED);
  assert.equal(hidden.z, capped.z);
  assert.ok(-hidden.z <= MAX_FRAME_DISPLACEMENT, `a 30 s hidden tab moved the body ${-hidden.z} m`);
});

test("frame rate shifts where a body starts, but the gap never accumulates", () => {
  const open = {
    colliders: [],
    bounds: { min: { x: -5000, y: 0, z: -5000 }, max: { x: 5000, y: 0, z: 5000 } },
    runMultiplier: MAX_BODY_SPEED / 5,
  };
  const travelled = (hz, seconds) => {
    const state = body();
    for (let i = 0; i < hz * seconds; i++) advanceMovement(state, running(), open, 1 / hz);
    return state.z;
  };
  const spreadOver = (seconds) => {
    const distances = [30, 60, 144].map((hz) => travelled(hz, seconds));
    return Math.max(...distances) - Math.min(...distances);
  };
  const short = spreadOver(1);
  assert.ok(short < 0.2, `frame rate changed the distance travelled by ${short} m`);
  assert.equal(spreadOver(30).toFixed(6), short.toFixed(6));
});

test("a body under an open sky leaves the ground when it jumps and lands once", () => {
  const state = body();
  const takeoff = advanceMovement(state, running({ jump: true }), world(), 1 / 60);
  assert.equal(takeoff.jumped, true);
  assert.ok(state.y > 0);

  let landings = 0;
  for (let i = 0; i < 120; i++) {
    const result = advanceMovement(state, running({ jump: false }), world(), 1 / 60);
    if (result.landingImpact > 0) landings++;
  }
  assert.equal(landings, 1);
  assert.equal(state.y, 0);
});

test("a ceiling caps a jump instead of letting the body enter the deck", () => {
  const deck = { x: 0, z: 0, cos: 1, sin: 0, hx: 6, hz: 6, yMin: 2.2, yMax: 2.6 };
  const scene = world([deck]);
  const standing = (overrides) => ({ ...running(), forward: 0, run: false, ...overrides });
  const state = body();
  advanceMovement(state, standing({ jump: true }), scene, 1 / 60);
  for (let i = 0; i < 60; i++) {
    advanceMovement(state, standing(), scene, 1 / 60);
    assert.ok(state.y < deck.yMin, `body reached y=${state.y}, into the deck at ${deck.yMin}`);
  }
});

test("the body is held inside the map bounds", () => {
  const state = body();
  const scene = world();
  for (let i = 0; i < 600; i++) frame(state, running(), scene, 1 / 60);
  assert.ok(state.z >= BOUNDS.min.z + PLAYER_RADIUS - 1e-6, `escaped to z=${state.z}`);
});
