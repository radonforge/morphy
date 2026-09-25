import assert from "node:assert/strict";
import { test } from "node:test";
import { canHitTarget, lineOfSightClear, normalize3 } from "../packages/bot/src/raycast.ts";

test("bot hit prediction accounts for an airborne target's Y offset", () => {
  const origin = { x: 0, y: 1.6, z: 0 };
  const bounds = { radius: 0.5, yMin: 0, yMax: 1.8 };
  const direction = normalize3({ x: 0, y: 2.9 - origin.y, z: 10 });
  assert.ok(direction);
  assert.equal(canHitTarget(origin, direction, 0, 2, 10, bounds, []), true);
});

test("bot hit prediction respects an occluding wall", () => {
  const origin = { x: 0, y: 1.6, z: 0 };
  const bounds = { radius: 0.5, yMin: 0, yMax: 1.8 };
  const direction = normalize3({ x: 0, y: 0.9 - origin.y, z: 10 });
  assert.ok(direction);
  const wall = { position: { x: 0, y: 2, z: 5 }, size: { x: 4, y: 4, z: 1 } };
  assert.equal(canHitTarget(origin, direction, 0, 0, 10, bounds, [wall]), false);
});

test("a confetti cloud on the sight line hides what is behind it", () => {
  const eye = { x: 0, y: 1.6, z: 0 };
  const target = { x: 0, y: 0.9, z: 10 };
  const cloud = { x: 0, y: 0.9, z: 5, radius: 2.5 };
  assert.equal(lineOfSightClear(eye, target, [], [cloud]), false);
});

test("sight passes a confetti cloud off to one side", () => {
  const eye = { x: 0, y: 1.6, z: 0 };
  const target = { x: 0, y: 0.9, z: 10 };
  const cloud = { x: 5, y: 0.9, z: 5, radius: 2.5 };
  assert.equal(lineOfSightClear(eye, target, [], [cloud]), true);
});
