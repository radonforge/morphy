import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { RUNTIME_MODEL_PATHS } from "../packages/client/runtimeAssets.ts";
import { ASSET_CARDS } from "../packages/shared/src/index.ts";
import { buildAssetCards } from "../tools/asset-cards/build.ts";

const PUBLIC_DIR = new URL("../packages/client/public/", import.meta.url).pathname;
const TOLERANCE = 0.01;

test("regenerating the cards in memory equals the committed file", async () => {
  const fresh = await buildAssetCards(PUBLIC_DIR);
  const committed = JSON.parse(
    await readFile(new URL("../packages/shared/src/assetCards.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(fresh, committed);
  assert.deepEqual(Object.keys(fresh), Object.keys(committed));
  assert.deepEqual(ASSET_CARDS, committed);
});

test("every allow-listed model except avatars and weapons has a card", () => {
  const expected = RUNTIME_MODEL_PATHS.filter(
    (model) => !model.startsWith("/models/pets/") && !model.startsWith("/models/blaster/"),
  );
  assert.ok(expected.length > 0);
  assert.deepEqual(Object.keys(ASSET_CARDS).sort(), expected);
  for (const model of expected) assert.equal(ASSET_CARDS[model].model, model);
});

test("reference cards match the measured values", () => {
  const near = (actual, expected, label) =>
    assert.ok(Math.abs(actual - expected) <= TOLERANCE, `${label}: ${actual} vs ${expected}`);
  const table = ASSET_CARDS["/models/space/station/table.glb"];
  near(table.size.x, 1.1, "table x");
  near(table.size.y, 0.4, "table y");
  near(table.size.z, 0.6, "table z");
  near(table.surfaces[0].y, 0.4, "table top y");
  near(table.surfaces[0].area, 0.64, "table top area");
  const chair = ASSET_CARDS["/models/space/station/chair.glb"];
  assert.ok(
    chair.surfaces.some((surface) => Math.abs(surface.y - 0.24) <= TOLERANCE),
    "chair seat at y = 0.24",
  );
  const barrel = ASSET_CARDS["/models/space/exterior/barrel.glb"];
  near(barrel.center.x, 2, "barrel centre x");
  near(barrel.center.z, 1.5, "barrel centre z");
});
