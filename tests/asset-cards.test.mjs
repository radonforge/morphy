import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { RUNTIME_MODEL_PATHS } from "../packages/client/runtimeAssets.ts";
import { ASSET_CARDS } from "../packages/shared/src/index.ts";
import { buildAssetCards } from "../tools/asset-cards/build.ts";
import { extractAssetCard } from "../tools/asset-cards/extract.ts";

const PUBLIC_DIR = new URL("../packages/client/public/", import.meta.url).pathname;
const TOLERANCE = 0.01;

test("regenerating the cards in memory equals the committed file", async () => {
  const fresh = await buildAssetCards(PUBLIC_DIR);
  const committed = JSON.parse(
    await readFile(new URL("../packages/shared/src/assetCards.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(fresh, committed);
  assert.deepEqual(Object.keys(fresh), Object.keys(committed));
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

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const STRIDE_BYTES = 24;

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(body.length, 0);
  head.writeUInt32LE(type, 4);
  return Buffer.concat([head, body]);
}

function syntheticGlb() {
  const padding = [9, 9, 9];
  const corner = (x, z) => [x, 0, z, ...padding];
  const bin = Buffer.from(
    new Float32Array([
      ...corner(0, 0),
      ...corner(0, 2),
      ...corner(2, 0),
      ...corner(2, 0),
      ...corner(0, 2),
      ...corner(2, 2),
    ]).buffer,
  );
  const gltf = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], translation: [0, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 6,
        type: "VEC3",
        min: [0, 0, 0],
        max: [2, 0, 2],
      },
    ],
    bufferViews: [{ buffer: 0, byteLength: bin.length, byteStride: STRIDE_BYTES }],
    buffers: [{ byteLength: bin.length }],
  };
  const text = JSON.stringify(gltf);
  const json = Buffer.from(text.padEnd(Math.ceil(text.length / 4) * 4));
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  return Buffer.concat([header, chunk(GLB_JSON_CHUNK, json), chunk(GLB_BIN_CHUNK, bin)]);
}

test("a rotated node, an index-less primitive and an interleaved stride yield the right card", () => {
  const card = extractAssetCard(syntheticGlb(), "/models/synthetic.glb");
  assert.deepEqual(card, {
    model: "/models/synthetic.glb",
    size: { x: 2, y: 0, z: 2 },
    center: { x: 1, y: 1, z: -1 },
    minY: 1,
    surfaces: [{ y: 1, area: 4 }],
  });
});
