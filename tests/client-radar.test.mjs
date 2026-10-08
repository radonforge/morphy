import assert from "node:assert/strict";
import { test } from "node:test";
import {
  arrowRotation,
  minimapBlips,
  minimapPlan,
  stepAge,
  trackMotion,
  worldToMinimap,
} from "../packages/client/src/game/radar.ts";
import { buildMap } from "../packages/server/src/maps/index.ts";
import {
  MINIMAP_MOVE_MIN_DIST,
  MINIMAP_MOVE_WINDOW_MS,
  MINIMAP_RADIUS,
} from "../packages/shared/src/index.ts";

const ORIGIN = { x: 0, z: 0 };
const NOW = 10_000;

/** A track for a player that last stepped `msAgo` before {@link NOW}, or never. */
function track(x, z, msAgo) {
  return { x, z, steppedAt: msAgo === null ? null : NOW - msAgo };
}

function blipIds(players, role, tracks) {
  return minimapBlips(
    Object.entries(players),
    "me",
    role,
    ORIGIN,
    new Map(Object.entries(tracks)),
    NOW,
  )
    .map((blip) => blip.id)
    .sort();
}

test("a first sample and a jitter are not steps", () => {
  const first = trackMotion(undefined, 1, 1, 0);
  assert.equal(first.steppedAt, null);
  const jitter = trackMotion(first, 1 + MINIMAP_MOVE_MIN_DIST / 2, 1, 100);
  assert.equal(jitter.steppedAt, null);
  assert.equal(jitter.x, 1);
});

test("moving past the minimum distance is a step, re-anchored where it landed", () => {
  const stepped = trackMotion(track(0, 0, null), MINIMAP_MOVE_MIN_DIST * 2, 0, 500);
  assert.deepEqual(stepped, { x: MINIMAP_MOVE_MIN_DIST * 2, z: 0, steppedAt: 500 });
});

test("a respawn teleport re-anchors without counting as a step", () => {
  const moved = trackMotion(track(0, 0, null), 40, 0, 500);
  assert.deepEqual(moved, { x: 40, z: 0, steppedAt: null });
});

test("a step counts for the move window and not after it", () => {
  assert.equal(stepAge(track(0, 0, 100), NOW), 100);
  assert.equal(stepAge(track(0, 0, MINIMAP_MOVE_WINDOW_MS + 1), NOW), null);
  assert.equal(stepAge(track(0, 0, null), NOW), null);
  assert.equal(stepAge(undefined, NOW), null);
});

test("a prop sees a hunter only while it moves within the radius", () => {
  const near = MINIMAP_RADIUS / 2;
  const players = {
    me: { x: 0, z: 0, role: "prop", alive: true },
    runner: { x: near, z: 0, role: "hunter", alive: true },
    ambusher: { x: 0, z: near, role: "hunter", alive: true },
    far: { x: MINIMAP_RADIUS + 1, z: 0, role: "hunter", alive: true },
    dead: { x: -near, z: 0, role: "hunter", alive: false },
  };
  const tracks = {
    runner: track(near, 0, 50),
    ambusher: track(0, near, MINIMAP_MOVE_WINDOW_MS * 2),
    far: track(MINIMAP_RADIUS + 1, 0, 50),
    dead: track(-near, 0, 50),
  };
  assert.deepEqual(blipIds(players, "prop", tracks), ["runner"]);
});

test("a hunter sees its teammates within the radius, still or moving", () => {
  const players = {
    me: { x: 0, z: 0, role: "hunter", alive: true },
    still: { x: 5, z: 5, role: "hunter", alive: true },
    moving: { x: -5, z: 5, role: "hunter", alive: true },
    far: { x: 0, z: -(MINIMAP_RADIUS + 1), role: "hunter", alive: true },
  };
  const tracks = { moving: track(-5, 5, 10) };
  const blips = minimapBlips(
    Object.entries(players),
    "me",
    "hunter",
    ORIGIN,
    new Map(Object.entries(tracks)),
    NOW,
  );
  assert.deepEqual(blips.map(({ id, stepAgeMs }) => [id, stepAgeMs]).sort(), [
    ["moving", 10],
    ["still", null],
  ]);
});

test("nobody ever sees a prop, moving or not", () => {
  const players = {
    me: { x: 0, z: 0, role: "prop", alive: true },
    mover: { x: 3, z: 0, role: "prop", alive: true },
  };
  const tracks = { mover: track(3, 0, 10) };
  assert.deepEqual(blipIds(players, "prop", tracks), []);
  assert.deepEqual(
    blipIds({ ...players, me: { ...players.me, role: "hunter" } }, "hunter", tracks),
    [],
  );
});

test("the minimap is north-up: -Z is up, +X is right", () => {
  const center = { x: 10, z: 10 };
  assert.deepEqual(worldToMinimap(center, 10, 0, 2), { x: 0, y: -20 });
  assert.deepEqual(worldToMinimap(center, 15, 10, 2), { x: 10, y: 0 });
});

test("the self arrow points up facing north and right facing east", () => {
  assert.equal(arrowRotation(0), -0);
  const east = -Math.PI / 2;
  assert.ok(Math.abs(-Math.sin(east) - 1) < 1e-9, "yaw -pi/2 looks down +X");
  assert.equal(arrowRotation(east), Math.PI / 2);
});

test("the station plan is its floor cells under its walls, without the ground slab", () => {
  const map = buildMap("station", 1);
  const plan = minimapPlan(map);
  const floor = plan.filter((rect) => rect.kind === "floor");
  const blocks = plan.filter((rect) => rect.kind === "block");
  assert.equal(floor.length, map.ceiling.length);
  assert.ok(blocks.length > 0);
  assert.ok(blocks.every((rect) => rect.w < map.bounds.max.x - map.bounds.min.x));
  assert.ok(plan.indexOf(blocks[0]) > plan.indexOf(floor.at(-1)), "walls paint over the floor");
});

test("the North District plan is open ground, its grass and its building lots, no lamp poles", () => {
  const map = buildMap("urban", 1);
  const plan = minimapPlan(map);
  assert.equal(plan[0].kind, "floor");
  assert.equal(plan[0].w, map.bounds.max.x - map.bounds.min.x);
  assert.ok(plan.some((rect) => rect.kind === "grass"));
  const blocks = plan.filter((rect) => rect.kind === "block");
  assert.ok(blocks.length > 0);
  assert.ok(blocks.every((rect) => Math.max(rect.w, rect.d) >= 1));
  const poles = map.colliders.filter((c) => Math.max(c.size.x, c.size.z) < 1).length;
  assert.ok(poles > 0, "the map has lamp poles to leave off");
});
