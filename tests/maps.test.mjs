import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMap } from "../packages/server/src/maps/index.ts";
import {
  colliderAabb,
  computePropBounds,
  MAX_PLAYERS,
  parseMapDefinition,
} from "../packages/shared/src/index.ts";

const MAP_IDS = ["station", "urban"];

test("all map builders remain deterministic and valid across 1,000 seeds", () => {
  for (const mapId of MAP_IDS) {
    for (let seed = 0; seed < 1_000; seed++) {
      const map = buildMap(mapId, seed);
      parseMapDefinition(map);
      if (seed < 25) assert.deepEqual(buildMap(mapId, seed), map);
    }
  }
});

test("the station's furniture and spawns stay put whatever the seed", () => {
  const { tiles: _tiles, ...base } = buildMap("station", 0);
  for (let seed = 1; seed < 100; seed++) {
    const { tiles: _seeded, ...map } = buildMap("station", seed);
    assert.deepEqual(map, base, `seed ${seed}`);
  }
});

test("North District does not vary with the seed", () => {
  const base = buildMap("urban", 0);
  for (let seed = 1; seed < 25; seed++)
    assert.deepEqual(buildMap("urban", seed), base, `seed ${seed}`);
});

const HUNTER_BODY_RADIUS = 0.4;
const LOBBY_CLUSTER = 4;
const HUNTER_RELEASE_MIN_DISTANCE = 40;

test("hunter spawns stand clear of every static prop and every wall", () => {
  for (const mapId of MAP_IDS) {
    for (let seed = 0; seed < 100; seed++) {
      const map = buildMap(mapId, seed);
      const radii = new Map(map.propCatalog.map((d) => [d.id, computePropBounds(d).radius]));
      const walls = map.colliders.filter((box) => box.position.y > 0).map(colliderAabb);
      for (const spawn of map.spawnPoints.hunters) {
        for (const prop of map.props) {
          const gap = Math.hypot(prop.position.x - spawn.x, prop.position.z - spawn.z);
          assert.ok(gap > radii.get(prop.type) + HUNTER_BODY_RADIUS, `${mapId}/${seed}: on a prop`);
        }
        for (const { min, max } of walls) {
          const dx = Math.max(min.x - spawn.x, 0, spawn.x - max.x);
          const dz = Math.max(min.z - spawn.z, 0, spawn.z - max.z);
          assert.ok(Math.hypot(dx, dz) > HUNTER_BODY_RADIUS, `${mapId}/${seed}: inside a wall`);
        }
      }
    }
  }
});

test("some hunter spawn is always far from where the props gather", () => {
  for (const mapId of MAP_IDS) {
    for (let seed = 0; seed < 100; seed++) {
      const map = buildMap(mapId, seed);
      const cluster = map.spawnPoints.props.slice(0, LOBBY_CLUSTER);
      const furthest = Math.max(
        ...map.spawnPoints.hunters.map((spawn) =>
          Math.min(...cluster.map((c) => Math.hypot(c.x - spawn.x, c.z - spawn.z))),
        ),
      );
      assert.ok(furthest >= HUNTER_RELEASE_MIN_DISTANCE, `${mapId}/${seed}: ${furthest}m`);
    }
  }
});

test("North District deals every player a prop spawn clear of the static props", () => {
  const map = buildMap("urban", 0);
  assert.ok(map.spawnPoints.props.length >= MAX_PLAYERS);
  const radii = new Map(map.propCatalog.map((d) => [d.id, computePropBounds(d).radius]));
  for (const spawn of map.spawnPoints.props) {
    for (const prop of map.props) {
      const gap = Math.hypot(spawn.x - prop.position.x, spawn.z - prop.position.z);
      assert.ok(gap > radii.get(prop.type) + HUNTER_BODY_RADIUS, `spawn ${spawn.x},${spawn.z}`);
    }
  }
});
