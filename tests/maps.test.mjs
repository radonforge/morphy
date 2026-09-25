import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMap } from "../packages/server/src/maps/index.ts";
import { computePropBounds, parseMapDefinition } from "../packages/shared/src/index.ts";

const MAP_IDS = ["station", "mars", "urban"];

test("all map builders remain deterministic and valid across 1,000 seeds", () => {
  for (const mapId of MAP_IDS) {
    for (let seed = 0; seed < 1_000; seed++) {
      const map = buildMap(mapId, seed);
      parseMapDefinition(map);
      if (seed < 25) assert.deepEqual(buildMap(mapId, seed), map);
    }
  }
});

const ROAD_STRAIGHT = "/models/urban/roads/road-straight.glb";
const ROAD_CROSS = "/models/urban/roads/road-crossroad.glb";

test("urban straight roads run along their street (road-straight.glb runs along local X)", () => {
  for (let seed = 0; seed < 25; seed++) {
    const map = buildMap("urban", seed);
    const crossings = map.tiles.filter((tile) => tile.model === ROAD_CROSS);
    const columnXs = new Set(crossings.map((tile) => tile.position.x));
    const rowZs = new Set(crossings.map((tile) => tile.position.z));
    const straights = map.tiles.filter((tile) => tile.model === ROAD_STRAIGHT);
    assert.ok(straights.length > 0);
    for (const tile of straights) {
      const alongZ = columnXs.has(tile.position.x);
      assert.notEqual(alongZ, rowZs.has(tile.position.z), `seed ${seed}: tile on no single street`);
      const sin = Math.abs(Math.sin(tile.rotationY));
      assert.ok(Math.abs(sin - (alongZ ? 1 : 0)) < 1e-9, `seed ${seed}: road tile turned across`);
    }
  }
});

test("urban spawns stay clear of every static prop", () => {
  for (let seed = 0; seed < 1_000; seed++) {
    const map = buildMap("urban", seed);
    assert.equal(map.spawnPoints.props.length, 16);
    const definitions = new Map(map.propCatalog.map((definition) => [definition.id, definition]));
    for (const spawn of map.spawnPoints.props) {
      for (const prop of map.props) {
        const definition = definitions.get(prop.type);
        assert.ok(definition);
        const radius = computePropBounds(definition).radius;
        const distance = Math.hypot(spawn.x - prop.position.x, spawn.z - prop.position.z);
        assert.ok(distance >= 1.2 + radius + 0.3 - 1e-9, `seed ${seed} has an overlap`);
      }
    }
  }
});
