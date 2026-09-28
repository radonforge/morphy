import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { RUNTIME_MODEL_PATHS } from "../packages/client/runtimeAssets.ts";
import { runtimePublicAssetPaths } from "../packages/client/viteRuntimeAssets.ts";
import { buildMap } from "../packages/server/src/maps/index.ts";

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;

function glbJson(bytes, model) {
  assert.equal(bytes.readUInt32LE(0), GLB_MAGIC, `${model}: invalid GLB magic`);
  assert.equal(bytes.readUInt32LE(4), 2, `${model}: unsupported GLB version`);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), GLB_JSON_CHUNK, `${model}: missing JSON chunk`);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
}

test("every allow-listed runtime model and its declared dependencies exist", async () => {
  assert.equal(new Set(RUNTIME_MODEL_PATHS).size, RUNTIME_MODEL_PATHS.length);
  let declaredDependencies = 0;
  for (const model of RUNTIME_MODEL_PATHS) {
    const bytes = await readFile(new URL(`../packages/client/public${model}`, import.meta.url));
    const json = glbJson(bytes, model);
    declaredDependencies += [...(json.buffers ?? []), ...(json.images ?? [])].filter(
      (entry) => typeof entry.uri === "string" && !entry.uri.startsWith("data:"),
    ).length;
  }
  assert.ok(declaredDependencies > 0, "fixture should exercise external GLB dependencies");
  const publicDir = new URL("../packages/client/public/", import.meta.url).pathname;
  const assets = await runtimePublicAssetPaths(publicDir);
  assert.ok(assets.length > RUNTIME_MODEL_PATHS.length);
});

test("every model a map emits is on the runtime allow-list", () => {
  const allowed = new Set(RUNTIME_MODEL_PATHS);
  for (const mapId of ["station", "urban"]) {
    for (let seed = 0; seed < 50; seed++) {
      const map = buildMap(mapId, seed);
      const models = new Map(
        map.propCatalog.map((definition) => [definition.id, definition.model]),
      );
      for (const model of [
        ...map.tiles.map((tile) => tile.model),
        ...map.scenery.map((piece) => piece.model),
        ...map.props.map((prop) => models.get(prop.type)).filter(Boolean),
      ]) {
        assert.ok(allowed.has(model), `${mapId}/${seed}: ${model} is not allow-listed`);
      }
    }
  }
});

test("no allow-listed runtime model is skinned", async () => {
  for (const model of RUNTIME_MODEL_PATHS) {
    const bytes = await readFile(new URL(`../packages/client/public${model}`, import.meta.url));
    const json = glbJson(bytes, model);
    assert.equal(
      json.skins?.length ?? 0,
      0,
      `${model}: skinned GLB. FittedModel clones with scene.clone(true), and SkinnedMesh.copy shares the source skeleton by reference, so the clone renders nowhere. Switch FittedModel to SkeletonUtils.clone() before shipping a skinned kit.`,
    );
  }
});
