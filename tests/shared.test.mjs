import assert from "node:assert/strict";
import { test } from "node:test";
import {
  colliderAabb,
  IntentValidationError,
  isWeaponId,
  MapValidationError,
  parseIntent,
  parseMapDefinition,
  rayAabb,
  withTimeout,
} from "../packages/shared/src/index.ts";

function validMap() {
  return {
    id: "test",
    bounds: { min: { x: -10, y: 0, z: -10 }, max: { x: 10, y: 10, z: 10 } },
    spawnPoints: { props: [{ x: 0, y: 0, z: 0 }] },
    colliders: [],
    tiles: [],
    scenery: [],
    props: [],
    propCatalog: [
      {
        id: "crate",
        name: "Crate",
        parts: [
          {
            kind: "box",
            position: { x: 0, y: 0.5, z: 0 },
            size: { x: 1, y: 1, z: 1 },
            color: "#fff",
          },
        ],
      },
    ],
  };
}

test("weapon ids reject inherited object properties", () => {
  assert.equal(isWeaponId("pistol"), true);
  assert.equal(isWeaponId("toString"), false);
  assert.equal(isWeaponId("constructor"), false);
});

test("map validation rejects non-finite values, empty spawns and duplicate ids", () => {
  const nonFinite = validMap();
  nonFinite.bounds.max.x = Number.NaN;
  assert.throws(() => parseMapDefinition(nonFinite), MapValidationError);

  const noSpawns = validMap();
  noSpawns.spawnPoints.props = [];
  assert.throws(() => parseMapDefinition(noSpawns), /must not be empty/);

  const duplicate = validMap();
  duplicate.propCatalog.push(structuredClone(duplicate.propCatalog[0]));
  assert.throws(() => parseMapDefinition(duplicate), /duplicate id/);
});

test("agent intent booleans are strict", () => {
  assert.deepEqual(parseIntent({ kind: "moveTo", seq: 1, x: 2, z: 3, run: true }), {
    kind: "moveTo",
    seq: 1,
    x: 2,
    z: 3,
    run: true,
  });
  assert.throws(
    () => parseIntent({ kind: "moveTo", seq: 1, x: 2, z: 3, run: "yes" }),
    IntentValidationError,
  );
});

test("timeout rejects and disposes values that resolve late", async () => {
  let resolveSource;
  let lateValue = null;
  const source = new Promise((resolve) => {
    resolveSource = resolve;
  });
  const result = withTimeout(source, 5, "resource", (value) => {
    lateValue = value;
  });
  await assert.rejects(result, /timed out/);
  resolveSource("room");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateValue, "room");
});

test("shared ray/AABB geometry returns the nearest intersection", () => {
  const collider = {
    position: { x: 0, y: 1, z: 5 },
    size: { x: 2, y: 2, z: 2 },
  };
  const { min, max } = colliderAabb(collider);
  assert.equal(rayAabb({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, min, max, 20), 4);
  assert.equal(rayAabb({ x: 3, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, min, max, 20), null);
});
