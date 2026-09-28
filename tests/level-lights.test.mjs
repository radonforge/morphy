import assert from "node:assert/strict";
import { test } from "node:test";
import { pickDeckLights } from "../packages/level/src/lights.ts";
import { buildMap } from "../packages/server/src/maps/index.ts";

const ROOM_COUNT = 14;
const SEEDS = [1, 7, 42];

function roomLights(map) {
  return pickDeckLights(map, ROOM_COUNT).filter((light) => light.kind === "room");
}

test("the station gets the asked number of room lights and one corridor light per hunter spawn", () => {
  for (const seed of SEEDS) {
    const map = buildMap("station", seed);
    const lights = pickDeckLights(map, ROOM_COUNT);
    assert.equal(lights.filter((light) => light.kind === "room").length, ROOM_COUNT);
    assert.deepEqual(
      lights.filter((light) => light.kind === "corridor").map(({ x, z }) => ({ x, z })),
      map.spawnPoints.hunters.map(({ x, z }) => ({ x, z })),
    );
  }
});

test("room lights hang clear of every wall", () => {
  const clearance = 2.9;
  for (const seed of SEEDS) {
    const map = buildMap("station", seed);
    const walls = map.colliders.filter((c) => c.position.y + c.size.y / 2 > 0);
    for (const light of roomLights(map)) {
      for (const wall of walls) {
        const dx = Math.max(Math.abs(light.x - wall.position.x) - wall.size.x / 2, 0);
        const dz = Math.max(Math.abs(light.z - wall.position.z) - wall.size.z / 2, 0);
        assert.ok(Math.hypot(dx, dz) >= clearance, `seed ${seed}: light at ${light.x},${light.z}`);
      }
    }
  }
});

test("the same layout always hangs the same lights", () => {
  const map = buildMap("station", 7);
  assert.deepEqual(pickDeckLights(map, ROOM_COUNT), pickDeckLights(map, ROOM_COUNT));
});

test("a map with no furniture gets its corridor lights only", () => {
  const map = { ...buildMap("station", 1), props: [] };
  assert.ok(pickDeckLights(map, ROOM_COUNT).every((light) => light.kind === "corridor"));
});
